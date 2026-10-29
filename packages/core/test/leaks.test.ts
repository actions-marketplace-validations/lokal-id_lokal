// Leak tests for the libraries: the canary person (canary.ts) in every format, through every way the core hands text
// to a model or to staging. None of their values may come out. The integrations are covered in packages/mcp/test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, streamText, wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { detectPii, maskPii, Samaran } from '../src/index.ts';
import { samaranMiddleware } from '../src/ai-sdk.ts';
import { Kembaran, KEEP_BY_DEFAULT } from '../src/kembaran.ts';
import { assertNoCanary, CANARY_FIELDS, CANARY_FORMATS, CANARY_NEEDLES } from './canary.ts';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const finish = { unified: 'stop' as const, raw: 'stop' };
const sent = (calls: LanguageModelV4CallOptions[]) => JSON.stringify(calls.map((c) => c.prompt));

test('canary: every value is found in every format, as its own type in the labelled form', () => {
  for (const [format, doc] of Object.entries(CANARY_FORMATS)) {
    const found = detectPii(doc);
    for (const [, , , value] of CANARY_FIELDS) {
      const at = doc.indexOf(format === 'json' ? JSON.stringify(value).slice(1, -1) : value);
      assert.ok(found.some((m) => m.start <= at && m.end >= at + value.length), `${format}: ${value} not found`);
    }
  }
  const text = detectPii(CANARY_FORMATS.text!);
  for (const [, , type, value] of CANARY_FIELDS) {
    assert.ok(text.some((m) => m.type === type && m.value.includes(value)), `${value} found as ${type}`);
  }
});

test('canary: Samaran and maskPii leave no value, and unmask gives the input back', () => {
  for (const [format, doc] of Object.entries(CANARY_FORMATS)) {
    const samaran = new Samaran();
    const { text } = samaran.mask(doc);
    assertNoCanary(text, `Samaran.mask (${format})`);
    assert.equal(samaran.unmask(text), doc, `unmask (${format})`);
    assertNoCanary(maskPii(doc).text, `maskPii (${format})`);
    // Partial masking keeps a few characters for people, never a whole value.
    assertNoCanary(new Samaran({ mode: 'partial' }).mask(doc).text, `partial mode (${format})`);
  }
});

test('canary: the AI SDK middleware sends no value to the provider, in generate and stream', async () => {
  for (const [format, doc] of Object.entries(CANARY_FORMATS)) {
    const reply = { type: 'text' as const, text: 'Data [NAME_1] dengan NIK [NIK_1] sudah dicek.' };
    const mock = new MockLanguageModelV4({ doGenerate: { content: [reply], finishReason: finish, usage, warnings: [] } });
    const model = wrapLanguageModel({ model: mock, middleware: samaranMiddleware() });
    const { text } = await generateText({ model, system: `Data pelanggan:\n${doc}`, prompt: `Cek ini ya:\n${doc}` });
    assertNoCanary(sent(mock.doGenerateCalls), `AI SDK generate (${format})`);
    assert.match(text, /Kenanga Purbasari/, 'the app gets the real name back');

    const streaming = new MockLanguageModelV4({
      doStream: {
        stream: new ReadableStream({
          start(c) {
            for (const p of [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: '0' }, { type: 'text-delta', id: '0', delta: 'ok' }, { type: 'text-end', id: '0' }, { type: 'finish', finishReason: finish, usage }]) c.enqueue(p as never);
            c.close();
          },
        }),
      },
    });
    const result = streamText({ model: wrapLanguageModel({ model: streaming, middleware: samaranMiddleware() }), prompt: doc });
    for await (const _ of result.textStream);
    assertNoCanary(sent(streaming.doStreamCalls), `AI SDK stream (${format})`);
  }
});

test('canary: Kembaran replaces every value it does not keep on purpose', () => {
  // Religion, gender, marital status, and nationality are kept by default: a staging copy needs realistic shares.
  const kept = new Set<string>(KEEP_BY_DEFAULT);
  const replaced = CANARY_NEEDLES.filter((n) => !CANARY_FIELDS.some(([, , type, value]) => kept.has(type) && (value === n || value.replace(/\D/g, '') === n)));
  for (const [format, doc] of Object.entries(CANARY_FORMATS)) {
    const { text } = new Kembaran({ secret: 'canary' }).text(doc);
    const leaked = replaced.filter((n) => text.includes(n));
    assert.deepEqual(leaked, [], `Kembaran (${format}) kept ${leaked.join(', ')}`);
  }
});
