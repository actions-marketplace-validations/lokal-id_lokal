import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, jsonSchema, Output, stepCountIs, streamText, tool, wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import * as ai6 from 'ai-v6';
import { MockLanguageModelV3 } from 'ai-v6/test';
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { samaranMiddleware } from '../src/ai-sdk.ts';

const TICKET = 'Nama: Budi Santoso, NIK 3201011508950001, HP 0812-3456-7890. Minta refund.';
const SECRETS = ['Budi Santoso', '3201011508950001', '3456-7890'];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const finish = (unified: 'stop' | 'tool-calls' = 'stop') => ({ unified, raw: unified });

/** Everything the provider was sent, as one string. */
const sent = (calls: LanguageModelV4CallOptions[]) => JSON.stringify(calls.map((c) => c.prompt));

function stream(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}

test('AI SDK: the model sees placeholders, the app gets real values back', async () => {
  const counts: unknown[] = [];
  const mock = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: 'Refund untuk [NAME_1] ([PHONE_1]) diproses.' }],
      finishReason: finish(),
      usage,
      warnings: [],
    },
  });
  const model = wrapLanguageModel({ model: mock, middleware: samaranMiddleware({ onMask: (c) => counts.push(c) }) });
  const { text } = await generateText({ model, system: 'Kamu agen CS.', prompt: TICKET });

  for (const s of SECRETS) assert.ok(!sent(mock.doGenerateCalls).includes(s), `${s} reached the provider`);
  assert.match(sent(mock.doGenerateCalls), /\[NAME_1\].*\[NIK_1\].*\[PHONE_1\]/);
  assert.equal(text, 'Refund untuk Budi Santoso (0812-3456-7890) diproses.');
  assert.deepEqual(counts, [{ NAME: 1, NIK: 1, PHONE: 1 }], 'counts only, never values');
});

test('AI SDK: streamed placeholders split across chunks are restored whole', async () => {
  const mock = new MockLanguageModelV4({
    doStream: {
      stream: stream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: '0' },
        { type: 'text-delta', id: '0', delta: 'Halo [NA' },
        { type: 'text-delta', id: '0', delta: 'ME_1], NIK [NIK_' },
        { type: 'text-delta', id: '0', delta: '1] sudah dicek. [' },
        { type: 'text-delta', id: '0', delta: 'PHONE_1' },
        { type: 'text-end', id: '0' },
        { type: 'finish', finishReason: finish(), usage },
      ]),
    },
  });
  const model = wrapLanguageModel({ model: mock, middleware: samaranMiddleware() });
  const result = streamText({ model, prompt: TICKET });
  const chunks: string[] = [];
  for await (const c of result.textStream) chunks.push(c);

  assert.equal(chunks.join(''), 'Halo Budi Santoso, NIK 3201011508950001 sudah dicek. [PHONE_1');
  assert.ok(!chunks.some((c) => /\[N|ME_1\]/.test(c)), 'no chunk shows a piece of a placeholder');
  for (const s of SECRETS) assert.ok(!sent(mock.doStreamCalls).includes(s));
});

test('AI SDK: tools run on real values, their results are masked on the next step', async () => {
  const lookups: unknown[] = [];
  let step = 0;
  const mock = new MockLanguageModelV4({
    doGenerate: async () => {
      step++;
      if (step === 1) {
        return {
          content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'cariPelanggan', input: '{"nik":"[NIK_1]"}' }],
          finishReason: finish('tool-calls'),
          usage,
          warnings: [],
        };
      }
      return { content: [{ type: 'text', text: 'Alamat [NAME_1]: [ADDRESS_1]' }], finishReason: finish(), usage, warnings: [] };
    },
  });
  const model = wrapLanguageModel({ model: mock, middleware: samaranMiddleware() });
  const { text } = await generateText({
    model,
    prompt: TICKET,
    stopWhen: stepCountIs(3),
    tools: {
      cariPelanggan: tool({
        inputSchema: jsonSchema<{ nik: string }>({ type: 'object', properties: { nik: { type: 'string' } }, required: ['nik'] }),
        execute: async ({ nik }) => {
          lookups.push(nik);
          return { nama: 'Budi Santoso', alamat: 'Jl. Mawar No. 5 RT 03/RW 07, Cibinong', nik: 3201011508950001 };
        },
      }),
    },
  });

  assert.deepEqual(lookups, ['3201011508950001'], 'the tool got the real NIK');
  const second = sent(mock.doGenerateCalls.slice(1));
  for (const s of [...SECRETS, 'Mawar']) assert.ok(!second.includes(s), `${s} reached the provider on step 2`);
  assert.match(second, /\[NIK_1\]/, 'the same NIK keeps its placeholder across steps, even stored as a number');
  assert.equal(text, 'Alamat Budi Santoso: Jl. Mawar No. 5 RT 03/RW 07, Cibinong');
});

test('AI SDK: streamed tool input is restored as valid JSON', async () => {
  const quoted = 'Budi "Bud" Santoso';
  const mock = new MockLanguageModelV4({
    doStream: {
      stream: stream([
        { type: 'tool-input-start', id: 't1', toolName: 'kirim' },
        { type: 'tool-input-delta', id: 't1', delta: '{"nama":"[NAM' },
        { type: 'tool-input-delta', id: 't1', delta: 'E_1]"}' },
        { type: 'tool-input-end', id: 't1' },
        { type: 'tool-call', toolCallId: 't1', toolName: 'kirim', input: '{"nama":"[NAME_1]"}' },
        { type: 'finish', finishReason: finish('tool-calls'), usage },
      ]),
    },
  });
  const model = wrapLanguageModel({ model: mock, middleware: samaranMiddleware() });
  const deltas: string[] = [];
  const inputs: unknown[] = [];
  const result = streamText({
    model,
    prompt: `Kirim ke nama: ${quoted}`,
    tools: { kirim: tool({ inputSchema: jsonSchema<{ nama: string }>({ type: 'object', properties: { nama: { type: 'string' } } }) }) },
  });
  for await (const part of result.fullStream) {
    if (part.type === 'tool-input-delta') deltas.push(part.delta);
    if (part.type === 'tool-call') inputs.push(part.input);
  }
  assert.ok(!sent(mock.doStreamCalls).includes('Santoso'));
  assert.deepEqual(JSON.parse(deltas.join('')), { nama: quoted });
  assert.deepEqual(inputs, [{ nama: quoted }]);
});

test('AI SDK: exclude and allow pass through, reasoning stays as the model wrote it', async () => {
  const mock = new MockLanguageModelV4({
    doGenerate: {
      content: [
        { type: 'reasoning', text: 'User [NAME_1] earns a lot.' },
        { type: 'text', text: 'Oke [NAME_1].' },
      ],
      finishReason: finish(),
      usage,
      warnings: [],
    },
  });
  const model = wrapLanguageModel({
    model: mock,
    middleware: samaranMiddleware({ exclude: ['FINANCIAL'], allow: ['0800-1-500-888'] }),
  });
  const { text, reasoningText } = await generateText({
    model,
    prompt: 'Nama: Budi Santoso, gaji: Rp15.000.000. Hubungi CS 0800-1-500-888.',
  });
  const prompt = sent(mock.doGenerateCalls);
  assert.ok(prompt.includes('Rp15.000.000') && prompt.includes('0800-1-500-888'));
  assert.ok(!prompt.includes('Budi'));
  assert.equal(text, 'Oke Budi Santoso.');
  assert.equal(reasoningText, 'User [NAME_1] earns a lot.');
});

test('AI SDK: structured output gets JSON-escaped values', async () => {
  const mock = new MockLanguageModelV4({
    doGenerate: { content: [{ type: 'text', text: '{"nama":"[NAME_1]"}' }], finishReason: finish(), usage, warnings: [] },
  });
  const model = wrapLanguageModel({ model: mock, middleware: samaranMiddleware() });
  const { output } = await generateText({
    model,
    prompt: 'Nama: Budi "Bud" Santoso',
    output: Output.object({ schema: jsonSchema<{ nama: string }>({ type: 'object', properties: { nama: { type: 'string' } } }) }),
  });
  assert.equal(mock.doGenerateCalls[0]?.responseFormat?.type, 'json');
  assert.deepEqual(output, { nama: 'Budi "Bud" Santoso' });
});

test('AI SDK 6: the same middleware with specificationVersion v3', async () => {
  const mock = new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text', text: 'Halo [NAME_1].' }],
      finishReason: finish(),
      usage,
      warnings: [],
    },
  });
  const model = ai6.wrapLanguageModel({ model: mock, middleware: samaranMiddleware({ specificationVersion: 'v3' }) });
  const { text } = await ai6.generateText({ model, prompt: TICKET });
  for (const s of SECRETS) assert.ok(!JSON.stringify(mock.doGenerateCalls).includes(s));
  assert.equal(text, 'Halo Budi Santoso.');
});
