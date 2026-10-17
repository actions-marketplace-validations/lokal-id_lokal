import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startProxy } from '../src/proxy.ts';

// A fake model API that records what it receives and answers with placeholders, the way a model would.
const SECRETS = ['Budi Santoso', '3201011508950001', '0812-3456-7890'];
const PROMPT = 'Nama: Budi Santoso, NIK 3201011508950001, HP 0812-3456-7890. Gaji 8 juta. Cek datanya ya.';
// Looks like image data and contains a digit run that is a valid NIK: it must arrive untouched.
const IMAGE = `data:image/png;base64,iVBORw0KGgo3201011508950001${'A'.repeat(300)}`;

let received: Array<{ path: string; headers: IncomingMessage['headers']; body: string }> = [];
let upstream: Server;
let proxy: Server;
let excluding: Server;
let base: string;
const logs: string[] = [];

function sse(res: ServerResponse, events: Array<{ event?: string; data: unknown }>): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) {
    res.write(`${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`);
  }
  res.end();
}

const chunk = (delta: unknown, finish: string | null = null) => ({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] });

function answer(req: IncomingMessage, res: ServerResponse, body: string): void {
  const path = req.url ?? '';
  const json = body ? JSON.parse(body) : {};
  if (path.endsWith('/chat/completions') && !json.stream) {
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req_1' });
    res.end(JSON.stringify({
      id: 'chatcmpl_1',
      object: 'chat.completion',
      model: json.model,
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: 'Baik, data [NAME_1] dengan NIK [NIK_1] sudah dicek. [UNKNOWN_9] tetap.',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'simpan', arguments: '{"nama":"[NAME_1]","hp":"[PHONE_1]"}' } }],
        },
      }],
    }));
  } else if (path.endsWith('/chat/completions')) {
    sse(res, [
      { data: chunk({ role: 'assistant', content: 'Halo [NA' }) },
      { data: chunk({ content: 'ME_1], NIK [' }) },
      { data: chunk({ content: 'NIK_1' }) },
      { data: chunk({ content: '] ok [' }) },
      { data: chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'simpan', arguments: '{"nik":"[NI' } }] }) },
      { data: chunk({ tool_calls: [{ index: 0, function: { arguments: 'K_1]"}' } }] }) },
      { data: chunk({}, 'stop') },
      { data: '[DONE]' },
    ]);
  } else if (path === '/v1/messages') {
    sse(res, [
      { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } } },
      { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'NIK-nya [NIK_1]' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      { event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Pak [NAME' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '_1], HP [PHONE_1' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '] [' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
  } else if (path === '/v1/responses') {
    const item = { item_id: 'msg_1', output_index: 0, content_index: 0 };
    sse(res, [
      { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', ...item, delta: 'NIK [NI' } },
      { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', ...item, delta: 'K_1] milik [NAME_' } },
      { event: 'response.output_text.done', data: { type: 'response.output_text.done', ...item, text: 'NIK [NIK_1] milik [NAME_1]' } },
      { event: 'response.completed', data: { type: 'response.completed', response: { id: 'resp_1', output: [{ type: 'message', content: [{ type: 'output_text', text: 'NIK [NIK_1] milik [NAME_1]' }] }] } } },
    ]);
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-test' }], path }));
  }
}

before(async () => {
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body });
      answer(req, res, body);
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const up = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  proxy = await startProxy({ port: 0, openai: up, anthropic: up, log: (l) => logs.push(l) });
  base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  // An OpenAI-compatible API whose base URL already ends in /v1 (OpenRouter, Groq, Ollama).
  excluding = await startProxy({ port: 0, openai: `${up}/api/v1`, exclude: ['FINANCIAL'], log: () => {} });
});

after(() => {
  for (const s of [proxy, excluding, upstream]) s?.close();
});

const post = (path: string, body: unknown, url = base) =>
  fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test' }, body: JSON.stringify(body) });

async function streamText(res: Response): Promise<Array<{ event?: string; data: string }>> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      return { event, data };
    });
}

test('proxy: Chat Completions dikirim tersamar, jawaban dan argumen tool kembali asli', async () => {
  received = [];
  const res = await post('/v1/chat/completions', {
    model: 'gpt-test',
    messages: [
      { role: 'system', content: 'Kamu asisten CS dealer.' },
      { role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: IMAGE } }] },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'cari', arguments: '{"nik":"3201011508950001"}' } }] },
      { role: 'tool', tool_call_id: 'call_0', content: 'Pelanggan: Budi Santoso, HP 0812-3456-7890' },
    ],
  });
  assert.equal(res.status, 200);
  const sent = received[0]!;
  assert.equal(sent.path, '/v1/chat/completions');
  assert.equal(sent.headers.authorization, 'Bearer sk-test', 'the API key passes through');
  for (const s of SECRETS) assert.ok(!sent.body.replace(IMAGE, '').includes(s), `${s} reached the model`);
  const body = JSON.parse(sent.body);
  assert.match(body.messages[1].content[0].text, /^Nama: \[NAME_1\], NIK \[NIK_1\], HP \[PHONE_1\]/);
  assert.equal(body.messages[1].content[1].image_url.url, IMAGE, 'image data is left alone');
  assert.equal(body.messages[2].tool_calls[0].function.arguments, '{"nik":"[NIK_1]"}');
  assert.equal(body.messages[3].content, 'Pelanggan: [NAME_1], HP [PHONE_1]', 'same person, same placeholder across messages');
  assert.equal(body.model, 'gpt-test');

  assert.equal(res.headers.get('x-samaran-masked'), 'NAME=2,NIK=2,PHONE=2,FINANCIAL=1');
  assert.equal(res.headers.get('x-request-id'), 'req_1');
  const reply = await res.json();
  const message = reply.choices[0].message;
  assert.equal(message.content, 'Baik, data Budi Santoso dengan NIK 3201011508950001 sudah dicek. [UNKNOWN_9] tetap.');
  assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), { nama: 'Budi Santoso', hp: '0812-3456-7890' });
  assert.match(logs.at(-1)!, /POST \/v1\/chat\/completions → 200 \d+ ms masked NAME=2,NIK=2,PHONE=2,FINANCIAL=1/);
  assert.ok(!logs.join('\n').includes('3201011508950001'), 'the log has no values');
});

test('proxy: streaming dengan placeholder yang terpotong di antara potongan', async () => {
  const res = await post('/v1/chat/completions', { model: 'gpt-test', stream: true, messages: [{ role: 'user', content: PROMPT }] });
  const events = await streamText(res);
  assert.equal(events.at(-1)!.data, '[DONE]');
  const chunks = events.slice(0, -1).map((e) => JSON.parse(e.data));
  const text = chunks.map((c) => c.choices[0].delta.content ?? '').join('');
  assert.equal(text, 'Halo Budi Santoso, NIK 3201011508950001 ok [', 'the dangling "[" comes out at the end');
  const args = chunks.flatMap((c) => c.choices[0].delta.tool_calls ?? []).map((t) => t.function.arguments).join('');
  assert.deepEqual(JSON.parse(args), { nik: '3201011508950001' });
});

test('proxy: Anthropic Messages, thinking dibiarkan apa adanya', async () => {
  received = [];
  const thinking = { type: 'thinking', thinking: 'NIK 3201011508950001 perlu dicek', signature: 'sig-abc' };
  const res = await post('/v1/messages', {
    model: 'claude-test',
    system: [{ type: 'text', text: 'Data pelanggan: Budi Santoso' }],
    messages: [
      { role: 'user', content: PROMPT },
      { role: 'assistant', content: [thinking, { type: 'tool_use', id: 'tu_1', name: 'cari', input: { nik: '3201011508950001' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'HP 0812-3456-7890' }] },
    ],
    stream: true,
  });
  const body = JSON.parse(received[0]!.body);
  assert.equal(body.system[0].text, 'Data pelanggan: [NAME_1]');
  assert.deepEqual(body.messages[1].content[0], thinking, 'signed thinking must not change');
  assert.deepEqual(body.messages[1].content[1].input, { nik: '[NIK_1]' });
  assert.equal(body.messages[2].content[0].content, 'HP [PHONE_1]');

  const events = await streamText(res);
  const deltas = events.filter((e) => e.event === 'content_block_delta').map((e) => JSON.parse(e.data));
  assert.equal(deltas.filter((d) => d.index === 0).map((d) => d.delta.thinking).join(''), 'NIK-nya [NIK_1]');
  assert.equal(deltas.filter((d) => d.index === 1).map((d) => d.delta.text).join(''), 'Pak Budi Santoso, HP 0812-3456-7890 [');
  // The "[" held back at the end comes out before its block's stop event.
  const order = events.map((e) => e.event);
  assert.ok(order.lastIndexOf('content_block_delta') < order.lastIndexOf('content_block_stop'));
});

test('proxy: OpenAI Responses API', async () => {
  const res = await post('/v1/responses', { model: 'gpt-test', input: PROMPT, stream: true });
  const events = (await streamText(res)).map((e) => ({ event: e.event, data: JSON.parse(e.data) }));
  const text = events.filter((e) => e.data.type === 'response.output_text.delta').map((e) => e.data.delta).join('');
  assert.equal(text, 'NIK 3201011508950001 milik [NAME_');
  assert.equal(events.find((e) => e.data.type === 'response.output_text.done')!.data.text, 'NIK 3201011508950001 milik Budi Santoso');
  assert.equal(events.at(-1)!.data.response.output[0].content[0].text, 'NIK 3201011508950001 milik Budi Santoso');
});

test('proxy: unggahan berkas ditolak, request tanpa body diteruskan, exclude, dan base URL /v1', async () => {
  received = [];
  const form = new FormData();
  form.append('file', new Blob(['nama,nik\nBudi Santoso,3201011508950001\n']), 'pelanggan.csv');
  const upload = await fetch(`${base}/v1/files`, { method: 'POST', body: form });
  assert.equal(upload.status, 415);
  assert.match((await upload.json()).error.message, /only masks JSON/);
  assert.equal(received.length, 0, 'nothing was forwarded');

  const models = await fetch(`${base}/v1/models`, { headers: { authorization: 'Bearer sk-test' } });
  assert.equal((await models.json()).data[0].id, 'gpt-test');
  // A client's connectivity probe outside /v1/ is answered here, so its API key goes nowhere.
  received = [];
  const probe = await fetch(`${base}/api/hello`, { method: 'HEAD', headers: { authorization: 'Bearer sk-ant-oat' } });
  assert.equal(probe.status, 404);
  assert.equal(received.length, 0);
  const anthropicModels = await fetch(`${base}/v1/models`, { headers: { 'anthropic-version': '2023-06-01' } });
  assert.equal((await anthropicModels.json()).path, '/v1/models', 'routed by its anthropic-version header');

  received = [];
  await post('/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: PROMPT }] }, `http://127.0.0.1:${(excluding.address() as AddressInfo).port}`);
  assert.equal(received[0]!.path, '/api/v1/chat/completions');
  assert.match(received[0]!.body, /Gaji 8 juta/, 'FINANCIAL is excluded');
  assert.ok(!received[0]!.body.includes('3201011508950001'));
});
