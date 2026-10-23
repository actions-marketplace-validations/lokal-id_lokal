// Samaran for the Vercel AI SDK: a language model middleware that masks Indonesian personal data in the prompt and
// restores it in the answer, streamed or not, including tool call inputs. It runs in-process, so it works where the
// Samaran Proxy cannot run (serverless and edge functions) and with every provider the AI SDK supports:
//
//   import { generateText, wrapLanguageModel } from 'ai';
//   import { samaranMiddleware } from '@lokal-id/core/ai-sdk';
//
//   const model = wrapLanguageModel({ model: openai('gpt-5'), middleware: samaranMiddleware() });
//
// Each call gets its own vault. Masking the whole prompt in order gives a conversation the same placeholders on every
// turn, so the model sees [NAME_1] for the same person throughout, and tools receive real values. Reasoning is left as
// the model wrote it: providers sign it, and the model only ever saw placeholders in it anyway. Files and images are
// sent as they are; only their file names are masked.
import type {
  JSONValue,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4Message,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { Samaran, type PiiType, type SamaranOptions } from './samaran/index.ts';

export interface SamaranMiddlewareOptions extends Omit<SamaranOptions, 'mode'> {
  /** "v4" (default) for AI SDK 7, "v3" for AI SDK 6. */
  specificationVersion?: 'v3' | 'v4';
  /** Called on each model call with how many values of each type were masked. Counts only, so it is safe to log. */
  onMask?: (counts: Partial<Record<PiiType, number>>) => void;
}

/**
 * What `wrapLanguageModel` takes. Typed loosely on purpose: each AI SDK version brings its own copy of the provider
 * types, and an app's copy rarely matches ours exactly.
 */
export interface SamaranLanguageModelMiddleware<V extends 'v3' | 'v4' = 'v4'> {
  readonly specificationVersion: V;
  wrapGenerate: (options: any) => PromiseLike<any>;
  wrapStream: (options: any) => PromiseLike<any>;
}

const PLACEHOLDER = /\[([A-Z_]+_\d+)\]/g;
// The end of a text that could be the start of a placeholder: "[", "[NI", "[NIK_", "[NIK_1".
const PARTIAL_PLACEHOLDER = /\[[A-Z_]{0,24}(?:\d{0,6})?$/;

type Json = JSONValue;

/** A masked number ("nik": 3201011508950001) leaves a bare placeholder in JSON text: makes it a string. */
function quoteBarePlaceholders(json: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i]!;
    if (inString) {
      out += c;
      if (c === '\\') out += json[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else {
      // Outside a string, "[" followed by capitals is never JSON: it can only be a placeholder.
      const bare = c === '[' ? /^\[[A-Z_]+_\d+\]/.exec(json.slice(i, i + 40)) : null;
      out += bare ? `"${bare[0]}"` : c;
      if (bare) i += bare[0].length - 1;
    }
  }
  return out;
}

class Masker {
  readonly samaran: Samaran;
  readonly counts: Partial<Record<PiiType, number>> = {};

  constructor(options: SamaranOptions) {
    this.samaran = new Samaran({ ...options, mode: 'placeholder' });
  }

  text(s: string): string {
    const { text, matches } = this.samaran.mask(s);
    for (const m of matches) this.counts[m.type] = (this.counts[m.type] ?? 0) + 1;
    return text;
  }

  /**
   * Masks a tool input or result as one JSON text, so keys give the values their meaning ("nama": "Budi Santoso").
   * Value by value only if that would not parse back.
   */
  json<T>(value: T): T {
    if (typeof value === 'string') return this.text(value) as T;
    if (value === null || typeof value !== 'object') return value;
    const masked = quoteBarePlaceholders(this.text(JSON.stringify(value, null, 2)));
    try {
      return JSON.parse(masked) as T;
    } catch {
      return this.each(value as Json) as T;
    }
  }

  private each(value: Json): Json {
    if (typeof value === 'string') return this.text(value);
    if (typeof value === 'number') {
      const s = String(value);
      const masked = this.text(s);
      return masked === s ? value : masked;
    }
    if (Array.isArray(value)) return value.map((v) => this.each(v));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v === undefined ? v : this.each(v)])) as Json;
    }
    return value;
  }

  prompt(messages: LanguageModelV4Message[]): LanguageModelV4Message[] {
    return messages.map((message) => {
      if (message.role === 'system') return { ...message, content: this.text(message.content) };
      const content = message.content.map((part) => {
        switch (part.type) {
          case 'text':
            return { ...part, text: this.text(part.text) };
          case 'file':
            return part.filename ? { ...part, filename: this.text(part.filename) } : part;
          case 'tool-call':
            return { ...part, input: this.json(part.input) };
          case 'tool-result':
            return { ...part, output: this.toolOutput(part.output) };
          case 'tool-approval-response':
            return part.reason ? { ...part, reason: this.text(part.reason) } : part;
          default:
            // Reasoning (signed by the provider) and provider-specific parts.
            return part;
        }
      });
      return { ...message, content } as LanguageModelV4Message;
    });
  }

  private toolOutput<T extends { type: string }>(output: T): T {
    const o = output as { type: string; value?: unknown; reason?: string };
    switch (o.type) {
      case 'text':
      case 'error-text':
        return { ...output, value: this.text(o.value as string) };
      case 'json':
      case 'error-json':
        return { ...output, value: this.json(o.value) };
      case 'execution-denied':
        return o.reason ? { ...output, reason: this.text(o.reason) } : output;
      case 'content':
        return {
          ...output,
          value: (o.value as Array<{ type: string; text?: string }>).map((p) =>
            p.type === 'text' && typeof p.text === 'string' ? { ...p, text: this.text(p.text) } : p,
          ),
        };
      default:
        return output;
    }
  }
}

class Unmasker {
  private readonly vault: Map<string, string>;
  private readonly held = new Map<string, string>();

  constructor(samaran: Samaran) {
    this.vault = new Map(samaran.exportVault());
  }

  /** Restores placeholders; `json` escapes the values for text inside a JSON string (tool inputs, JSON output). */
  text(s: string, json = false): string {
    if (!this.vault.size) return s;
    return s.replace(PLACEHOLDER, (whole) => {
      const value = this.vault.get(whole);
      if (value === undefined) return whole;
      return json ? JSON.stringify(value).slice(1, -1) : value;
    });
  }

  value<T>(v: T): T {
    if (typeof v === 'string') return this.text(v) as T;
    if (Array.isArray(v)) return v.map((x) => this.value(x)) as T;
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.value(x)])) as T;
    }
    return v;
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

  /** Streams that never got their end part. */
  pending(): string[] {
    return [...this.held.entries()].filter(([, s]) => s).map(([key]) => key);
  }

  content(part: LanguageModelV4Content, jsonText: boolean): LanguageModelV4Content {
    switch (part.type) {
      case 'text':
        return { ...part, text: this.text(part.text, jsonText) };
      case 'tool-call':
        return { ...part, input: this.text(part.input, true) };
      case 'tool-result':
        return { ...part, result: this.value(part.result) };
      default:
        return part;
    }
  }
}

function mask(params: LanguageModelV4CallOptions, options: SamaranMiddlewareOptions) {
  const { specificationVersion: _version, onMask, ...samaranOptions } = options;
  const masker = new Masker(samaranOptions);
  const masked = { ...params, prompt: masker.prompt(params.prompt) };
  onMask?.(masker.counts);
  // With a JSON response format, the text is JSON: restored values must be escaped like any JSON string.
  return { masked, unmasker: new Unmasker(masker.samaran), jsonText: params.responseFormat?.type === 'json' };
}

function unmaskStream(unmasker: Unmasker, jsonText: boolean) {
  return new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
    transform(part, controller) {
      switch (part.type) {
        case 'text-delta':
          controller.enqueue({ ...part, delta: unmasker.delta(`t${part.id}`, part.delta, jsonText) });
          return;
        case 'text-end': {
          const rest = unmasker.flush(`t${part.id}`, jsonText);
          if (rest) controller.enqueue({ type: 'text-delta', id: part.id, delta: rest });
          controller.enqueue(part);
          return;
        }
        case 'tool-input-delta':
          controller.enqueue({ ...part, delta: unmasker.delta(`j${part.id}`, part.delta, true) });
          return;
        case 'tool-input-end': {
          const rest = unmasker.flush(`j${part.id}`, true);
          if (rest) controller.enqueue({ type: 'tool-input-delta', id: part.id, delta: rest });
          controller.enqueue(part);
          return;
        }
        case 'finish':
          for (const key of unmasker.pending()) {
            const id = key.slice(1);
            const json = key.startsWith('j');
            const delta = unmasker.flush(key, json || jsonText);
            controller.enqueue(json ? { type: 'tool-input-delta', id, delta } : { type: 'text-delta', id, delta });
          }
          controller.enqueue(part);
          return;
        case 'tool-call':
        case 'tool-result':
          controller.enqueue(unmasker.content(part, jsonText) as LanguageModelV4StreamPart);
          return;
        default:
          controller.enqueue(part);
      }
    },
  });
}

/**
 * Masks Indonesian personal data before a prompt reaches the model, and restores it in the model's answer.
 *
 *   const model = wrapLanguageModel({ model: openai('gpt-5'), middleware: samaranMiddleware() });
 *   const { text } = await generateText({ model, prompt: 'Ringkas tiket ini: ...' });
 *
 * Options are the same as `Samaran`'s: `exclude: ['FINANCIAL']` lets the model see amounts, `allow` keeps values such
 * as your own hotline. For AI SDK 6, pass `specificationVersion: 'v3'`.
 */
export function samaranMiddleware(options: SamaranMiddlewareOptions & { specificationVersion: 'v3' }): SamaranLanguageModelMiddleware<'v3'>;
export function samaranMiddleware(options?: SamaranMiddlewareOptions & { specificationVersion?: 'v4' }): SamaranLanguageModelMiddleware<'v4'>;
export function samaranMiddleware(options: SamaranMiddlewareOptions = {}): SamaranLanguageModelMiddleware<'v3' | 'v4'> {
  const middleware = {
    specificationVersion: 'v4',
    async wrapGenerate({ params, model }) {
      const { masked, unmasker, jsonText } = mask(params, options);
      const result = await model.doGenerate(masked);
      return { ...result, content: result.content.map((part) => unmasker.content(part, jsonText)) };
    },
    async wrapStream({ params, model }) {
      const { masked, unmasker, jsonText } = mask(params, options);
      const result = await model.doStream(masked);
      return { ...result, stream: result.stream.pipeThrough(unmaskStream(unmasker, jsonText)) };
    },
  } satisfies LanguageModelV4Middleware;
  // AI SDK 6 calls the same hooks with the same prompt and stream shapes; only the version tag differs.
  return { ...middleware, specificationVersion: options.specificationVersion ?? 'v4' };
}
