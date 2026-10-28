// Samaran Proxy: an OpenAI- and Anthropic-compatible endpoint that masks Indonesian personal data on the way to the
// model and restores it on the way back. Point an app's base URL at it and every call is covered, without changes to
// the app:
//
//   npx @lokal-id/mcp proxy                      # http://127.0.0.1:8787
//   OpenAI(base_url="http://127.0.0.1:8787/v1")  # Chat Completions, Responses, Embeddings
//   Anthropic(base_url="http://127.0.0.1:8787")  # Messages
//
// Each request gets its own vault. Masking the whole request in order gives a conversation the same placeholders on
// every turn, so the model sees [NAME_1] for the same person throughout. Responses are unmasked, streamed or not,
// including tool call arguments, so the app works with real values. Thinking and reasoning blocks are left alone:
// they are signed, and the model only ever saw placeholders in them anyway.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PII_TYPES, Samaran, type CustomRule, type PiiType } from '@lokal-id/core';
import { loadConfig, type SamaranConfig } from './files.ts';

export interface ProxyOptions {
  /** Default 127.0.0.1: the proxy sees real personal data, so it is not exposed to the network unless asked. */
  host?: string;
  port?: number;
  /** Upstream for everything except Anthropic's API. OpenAI by default; any OpenAI-compatible API works. */
  openai?: string;
  anthropic?: string;
  /** Types the model may see, such as FINANCIAL for a credit simulation. */
  exclude?: PiiType[];
  /** A team's own rules, and values never masked: from .samaran.json in the folder the proxy starts in. */
  custom?: CustomRule[];
  allow?: string[];
  /** Forward requests whose body cannot be masked (file uploads) instead of refusing them. */
  allowUnmasked?: boolean;
  /** One line per request, without content. Default: stderr. */
  log?: (line: string) => void;
}

const MAX_BODY_BYTES = 50 * 1024 * 1024;
// Values that must reach the API untouched: identifiers, model names, signatures.
const SKIP_KEYS = new Set([
  'model', 'role', 'type', 'id', 'object', 'tool_call_id', 'call_id', 'tool_use_id', 'item_id', 'previous_response_id',
  'signature', 'encrypted_content', 'media_type', 'mime_type', 'file_id', 'detail', 'cache_control', 'stop_reason',
  'finish_reason', 'status', 'service_tier', 'system_fingerprint', 'reasoning_effort',
]);
// Signed or opaque content: thinking blocks (Anthropic) and reasoning items (OpenAI Responses).
const OPAQUE_TYPES = new Set(['thinking', 'redacted_thinking', 'reasoning']);
const PLACEHOLDER = /\[([A-Z_]+_\d+)\]/g;
// The end of a text that could be the start of a placeholder: "[", "[NI", "[NIK_", "[NIK_1".
const PARTIAL_PLACEHOLDER = /\[[A-Z_]{0,24}(?:\d{0,6})?$/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Image, audio, and file data: base64 or data URLs. Masking a digit run inside one would corrupt it. */
function isBinaryText(s: string): boolean {
  return s.startsWith('data:') || (s.length >= 200 && !/\s/.test(s.slice(0, 200)) && /^[A-Za-z0-9+/=_-]+$/.test(s.slice(0, 200)));
}

/** Masks every text value in a request body, in document order. */
function maskJson(value: Json, samaran: Samaran, counts: Map<PiiType, number>): Json {
  if (typeof value === 'string') {
    if (isBinaryText(value)) return value;
    const { text, matches } = samaran.mask(value);
    for (const m of matches) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    return text;
  }
  if (Array.isArray(value)) return value.map((v) => maskJson(v, samaran, counts));
  if (value && typeof value === 'object') {
    if (typeof value.type === 'string' && OPAQUE_TYPES.has(value.type)) return value;
    const out: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) out[k] = SKIP_KEYS.has(k) ? v : maskJson(v, samaran, counts);
    return out;
  }
  return value;
}

class Unmasker {
  private readonly vault: Map<string, string>;
  private readonly held = new Map<string, string>();

  constructor(samaran: Samaran) {
    this.vault = new Map(samaran.exportVault());
  }

  /** Restores placeholders; `json` escapes the values for text inside a JSON string (tool call arguments). */
  text(s: string, json = false): string {
    if (!this.vault.size) return s;
    return s.replace(PLACEHOLDER, (whole) => {
      const value = this.vault.get(whole);
      if (value === undefined) return whole;
      return json ? JSON.stringify(value).slice(1, -1) : value;
    });
  }

  /** A streamed piece of text: holds back an unfinished placeholder until the next piece of the same stream. */
  delta(key: string, s: string, json = false): string {
    const combined = (this.held.get(key) ?? '') + s;
    if (!this.vault.size) return combined;
    const tail = PARTIAL_PLACEHOLDER.exec(combined);
    this.held.set(key, tail ? tail[0] : '');
    return this.text(tail ? combined.slice(0, tail.index) : combined, json);
  }

  /** What is still held for a stream, at its end. */
  flush(key: string, json = false): string {
    const rest = this.held.get(key) ?? '';
    this.held.delete(key);
    return this.text(rest, json);
  }

  /** Unmasks a whole response object, leaving thinking and reasoning as the model wrote them. */
  json(value: Json, key?: string): Json {
    if (typeof value === 'string') return this.text(value, key === 'arguments' || key === 'partial_json');
    if (Array.isArray(value)) return value.map((v) => this.json(v));
    if (value && typeof value === 'object') {
      if (typeof value.type === 'string' && OPAQUE_TYPES.has(value.type)) return value;
      const out: { [k: string]: Json } = {};
      for (const [k, v] of Object.entries(value)) out[k] = SKIP_KEYS.has(k) ? v : this.json(v, k);
      return out;
    }
    return value;
  }
}

type Event = { event?: string; data: string };

/**
 * Rewrites one server-sent event of a streamed response. Returns the events to send in its place: usually the same
 * one with its text unmasked, plus, at the end of a text block, an extra delta with text that was held back.
 */
function rewriteEvent(ev: Event, un: Unmasker): Event[] {
  if (ev.data === '[DONE]') return [ev];
  let data: { [key: string]: Json };
  try {
    data = JSON.parse(ev.data);
  } catch {
    return [ev];
  }
  const out = (d: unknown, event = ev.event): Event => ({ event, data: JSON.stringify(d) });
  const type = typeof data.type === 'string' ? data.type : undefined;

  // Anthropic Messages.
  if (type === 'content_block_delta') {
    const index = data.index as number;
    const delta = data.delta as { type: string; text?: string; partial_json?: string };
    if (delta.type === 'text_delta' && typeof delta.text === 'string') delta.text = un.delta(`a${index}`, delta.text);
    else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      delta.partial_json = un.delta(`j${index}`, delta.partial_json, true);
    }
    return [out(data)];
  }
  if (type === 'content_block_stop') {
    const index = data.index as number;
    const extra: Event[] = [];
    const text = un.flush(`a${index}`);
    if (text) extra.push(out({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } }, 'content_block_delta'));
    const json = un.flush(`j${index}`, true);
    if (json) {
      extra.push(out({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json } }, 'content_block_delta'));
    }
    return [...extra, out(data)];
  }
  if (type === 'content_block_start' || type === 'message_start') return [out(un.json(data))];

  // OpenAI Responses.
  if (type === 'response.output_text.delta' || type === 'response.function_call_arguments.delta') {
    const args = type === 'response.function_call_arguments.delta';
    const key = `r${data.item_id}:${data.output_index}:${data.content_index ?? ''}:${args ? 'f' : 't'}`;
    data.delta = un.delta(key, String(data.delta ?? ''), args);
    return [out(data)];
  }
  if (type === 'response.output_text.done' || type === 'response.function_call_arguments.done') {
    const args = type === 'response.function_call_arguments.done';
    const key = `r${data.item_id}:${data.output_index}:${data.content_index ?? ''}:${args ? 'f' : 't'}`;
    const rest = un.flush(key, args);
    const extra = rest
      ? [out({ ...data, type: args ? 'response.function_call_arguments.delta' : 'response.output_text.delta', delta: rest }, ev.event?.replace(/\.done$/, '.delta'))]
      : [];
    return [...extra, out(un.json(data))];
  }
  if (type?.startsWith('response.')) return [out(un.json(data))];

  // OpenAI Chat Completions (and the many APIs compatible with it).
  if (Array.isArray(data.choices)) {
    for (const c of data.choices as Array<{ index?: number; delta?: { [k: string]: Json }; finish_reason?: string | null }>) {
      const i = c.index ?? 0;
      const delta = c.delta;
      if (delta) {
        if (typeof delta.content === 'string') delta.content = un.delta(`c${i}`, delta.content);
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls as Array<{ index?: number; function?: { arguments?: string } }>) {
            if (typeof call.function?.arguments === 'string') {
              call.function.arguments = un.delta(`c${i}t${call.index ?? 0}`, call.function.arguments, true);
            }
          }
        }
      }
      if (c.finish_reason) {
        const rest = un.flush(`c${i}`);
        if (rest) {
          c.delta ??= {};
          c.delta.content = rest + (typeof c.delta.content === 'string' ? c.delta.content : '');
        }
      }
    }
    return [out(data)];
  }
  return [out(un.json(data))];
}

function serialize(ev: Event): string {
  return `${ev.event ? `event: ${ev.event}\n` : ''}${ev.data
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n')}\n\n`;
}

/** Parses server-sent events out of a growing buffer; returns the complete ones and what remains. */
function takeEvents(buffer: string): { events: Array<Event | { raw: string }>; rest: string } {
  const events: Array<Event | { raw: string }> = [];
  let rest = buffer.replace(/\r\n/g, '\n');
  for (let end = rest.indexOf('\n\n'); end >= 0; end = rest.indexOf('\n\n')) {
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    const data: string[] = [];
    let event: string | undefined;
    let other = false;
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line) other = true;
    }
    // Comments, ids, and retry fields pass through as they are.
    events.push(data.length && !other ? { event, data: data.join('\n') } : { raw: `${block}\n\n` });
  }
  return { events, rest };
}

const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'accept-encoding', 'proxy-connection',
  'upgrade', 'te', 'trailer',
]);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fail(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { type: 'samaran_proxy_error', message } }));
}

const summary = (counts: Map<PiiType, number>) => [...counts].map(([t, n]) => `${t}=${n}`).join(',');

/** Starts the proxy and resolves once it listens. */
export function startProxy(options: ProxyOptions = {}): Promise<Server> {
  const openai = (options.openai ?? 'https://api.openai.com').replace(/\/+$/, '');
  const anthropic = (options.anthropic ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  const server = createServer(async (req, res) => {
    const started = Date.now();
    const url = req.url ?? '/';
    const path = url.split('?')[0]!;
    // Only API calls are forwarded: anything else (a client's connectivity probe, a browser) would carry an API key
    // to an upstream it was not meant for.
    if (!path.startsWith('/v1/')) return fail(res, 404, `Samaran Proxy forwards /v1/ API calls only, not ${path}.`);
    const toAnthropic = /^\/v1\/(messages|complete)\b/.test(path) || req.headers['anthropic-version'] !== undefined;
    const upstream = toAnthropic ? anthropic : openai;
    // An upstream base URL may end in /v1 already (OpenRouter, Groq, Ollama): do not repeat it.
    const target = upstream.endsWith('/v1') && url.startsWith('/v1/') ? `${upstream}${url.slice(3)}` : `${upstream}${url}`;
    const samaran = new Samaran({ exclude: options.exclude, custom: options.custom, allow: options.allow });
    const counts = new Map<PiiType, number>();
    try {
      const raw = await readBody(req);
      const contentType = String(req.headers['content-type'] ?? '');
      let body: Blob | string | undefined = raw.length ? new Blob([new Uint8Array(raw)]) : undefined;
      if (raw.length) {
        if (req.headers['content-encoding']) return fail(res, 415, 'Samaran Proxy cannot mask a compressed request body; send it uncompressed.');
        if (contentType.includes('json')) {
          body = JSON.stringify(maskJson(JSON.parse(raw.toString('utf8')) as Json, samaran, counts));
        } else if (!options.allowUnmasked) {
          return fail(
            res,
            415,
            `Samaran Proxy only masks JSON requests; this one is ${contentType || 'not JSON'} (a file upload?), so it was not sent. Start the proxy with --allow-unmasked to forward such requests as they are.`,
          );
        }
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP.has(k) && typeof v === 'string') headers[k] = v;
      }
      const response = await fetch(target, { method: req.method, headers, body });
      const un = new Unmasker(samaran);
      const out: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        if (!HOP_BY_HOP.has(k) && k !== 'content-encoding') out[k] = v;
      });
      if (counts.size) out['x-samaran-masked'] = summary(counts);

      const type = response.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream') && response.body) {
        res.writeHead(response.status, out);
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk as Uint8Array, { stream: true });
          const { events, rest } = takeEvents(buffer);
          buffer = rest;
          for (const e of events) res.write('raw' in e ? e.raw : rewriteEvent(e, un).map(serialize).join(''));
        }
        if (buffer.trim()) res.write(buffer);
        res.end();
      } else {
        const text = await response.text();
        let payload = text;
        if (type.includes('json')) {
          try {
            payload = JSON.stringify(un.json(JSON.parse(text) as Json));
          } catch {
            payload = un.text(text);
          }
        }
        res.writeHead(response.status, out);
        res.end(payload);
      }
      log(`${req.method} ${path} → ${response.status} ${Date.now() - started} ms${counts.size ? ` masked ${summary(counts)}` : ''}`);
    } catch (e) {
      log(`${req.method} ${path} failed: ${(e as Error).message}`);
      if (!res.headersSent) fail(res, 502, `Samaran Proxy: ${(e as Error).message}`);
      else res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8787, options.host ?? '127.0.0.1', () => resolve(server));
  });
}

const USAGE = `Usage: lokal-mcp proxy [options]

  --port <n>          Port to listen on (default 8787, or LOKAL_PROXY_PORT)
  --host <addr>       Address to listen on (default 127.0.0.1)
  --openai <url>      OpenAI-compatible upstream (default https://api.openai.com, or LOKAL_PROXY_OPENAI)
  --anthropic <url>   Anthropic upstream (default https://api.anthropic.com, or LOKAL_PROXY_ANTHROPIC)
  --exclude <types>   Types the model may see, comma-separated, e.g. FINANCIAL,NAME
  --allow-unmasked    Forward requests that cannot be masked (file uploads) instead of refusing them

Point your app at it: OpenAI(base_url="http://127.0.0.1:8787/v1"), Anthropic(base_url="http://127.0.0.1:8787").
API keys pass through to the upstream; the proxy keeps nothing.`;

export async function runProxy(args: string[]): Promise<void> {
  const opt = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const exclude = (opt('exclude') ?? process.env.LOKAL_PROXY_EXCLUDE ?? '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  const unknown = exclude.filter((t) => !PII_TYPES.includes(t as PiiType));
  if (unknown.length) {
    process.stderr.write(`Unknown PII type ${unknown.join(', ')}. Valid types: ${PII_TYPES.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  let config: SamaranConfig;
  try {
    config = loadConfig(process.cwd());
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = 1;
    return;
  }
  const host = opt('host') ?? '127.0.0.1';
  const port = Number(opt('port') ?? process.env.LOKAL_PROXY_PORT ?? 8787);
  await startProxy({
    host,
    port,
    // Not OPENAI_BASE_URL: an app pointed at the proxy through it would make the proxy call itself.
    openai: opt('openai') ?? process.env.LOKAL_PROXY_OPENAI,
    anthropic: opt('anthropic') ?? process.env.LOKAL_PROXY_ANTHROPIC,
    exclude: exclude as PiiType[],
    custom: config.custom,
    allow: config.allow,
    allowUnmasked: args.includes('--allow-unmasked'),
  });
  process.stderr.write(`Samaran Proxy listening on http://${host}:${port}\n`);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    process.stderr.write('Warning: the proxy sees real personal data and is reachable from the network. Put it behind a firewall.\n');
  }
}
