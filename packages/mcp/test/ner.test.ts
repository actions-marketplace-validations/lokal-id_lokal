import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PiiMatch } from '@lokal-id/core';
import { loadConfig } from '../src/files.ts';
import { NerNames } from '../src/ner.ts';
import { startProxy } from '../src/proxy.ts';

// A stand-in for the model: every occurrence of these names, as the model would find them.
const PEOPLE = ['rianto surya', 'minan minanto'];
let calls = 0;
const fake = {
  async find(text: string): Promise<PiiMatch[]> {
    calls++;
    return PEOPLE.flatMap((name) =>
      [...text.matchAll(new RegExp(name, 'g'))].map((m) => ({
        type: 'NAME' as const, start: m.index, end: m.index + name.length, value: name, confidence: 'medium' as const,
      })),
    );
  },
};

test('NerNames: hasil disimpan per teks, model dimuat sekali', async () => {
  let loads = 0;
  const ner = new NerNames(async () => {
    loads++;
    return fake;
  });
  calls = 0;
  const text = 'saya di chat sama rianto surya tadi pagi';
  assert.deepEqual((await ner.find(text))?.map((m) => m.value), ['rianto surya']);
  await ner.find(text);
  assert.equal(loads, 1);
  assert.equal(calls, 1);
  assert.equal(ner.problem, undefined);
});

test('NerNames: cache tidak menyimpan teks atau nama, dan clear() melupakan semuanya', async () => {
  const ner = new NerNames(async () => fake);
  calls = 0;
  const text = 'NIK 3201011508950001, saya di chat sama rianto surya tadi pagi';
  const first = await ner.find(text);
  const again = await ner.find(text);
  assert.deepEqual(again, first, 'from the cache, the same matches');
  assert.equal(calls, 1);
  // What the cache holds, keys and values: no part of the text, no name.
  const held = JSON.stringify([...(ner as unknown as { cache: Map<string, unknown> }).cache]);
  for (const secret of ['rianto', 'surya', '3201011508950001', 'saya di chat']) assert.ok(!held.includes(secret), `${secret} held`);
  ner.clear();
  assert.equal(ner.size, 0);
  await ner.find(text);
  assert.equal(calls, 2, 'after clear() the text is read again');
});

test('NerNames: tanpa paket @lokal-id/ner, aturan tetap jalan dan masalahnya dilaporkan', async () => {
  const ner = new NerNames(async () => {
    throw new Error("Cannot find package '@lokal-id/ner' imported from cli.js");
  });
  const write = process.stderr.write;
  process.stderr.write = () => true;
  try {
    assert.equal(await ner.find('sama rianto surya'), undefined);
  } finally {
    process.stderr.write = write;
  }
  assert.match(ner.problem ?? '', /not installed.*-p @lokal-id\/ner/);
});

test('.samaran.json: "ner" harus true atau false', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-ner-'));
  try {
    writeFileSync(path.join(dir, '.samaran.json'), '{ "ner": true }');
    assert.equal(loadConfig(dir).ner, true);
    writeFileSync(path.join(dir, '.samaran.json'), '{ "ner": false }');
    assert.equal(loadConfig(dir).ner, undefined);
    writeFileSync(path.join(dir, '.samaran.json'), '{ "ner": "yes" }');
    assert.throws(() => loadConfig(dir), /"ner" must be true or false/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('proxy: nama dari model ikut disamarkan, juga di argumen tool dan saat dikembalikan', async () => {
  const received: string[] = [];
  const upstream: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'Sudah saya kabari [NAME_1].' } }] }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  const up = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const proxy = await startProxy({ port: 0, openai: up, ner: fake, log: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${(proxy.address() as AddressInfo).port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'm',
        messages: [
          { role: 'user', content: 'tolong kabari rianto surya, terus ada yang ngeliat minan minanto ga ya' },
          { role: 'assistant', tool_calls: [{ id: 't1', type: 'function', function: { name: 'kirim', arguments: '{"catatan":"titip ke rianto surya"}' } }] },
        ],
      }),
    });
    const sent = received[0]!;
    for (const name of PEOPLE) assert.ok(!sent.includes(name), `${name} leaked`);
    assert.match(sent, /kabari \[NAME_1\], terus ada yang ngeliat \[NAME_2\] ga ya/);
    assert.match(sent, /titip ke \[NAME_1\]/);
    const answer = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    assert.equal(answer.choices[0]!.message.content, 'Sudah saya kabari rianto surya.');
  } finally {
    proxy.close();
    upstream.close();
  }
});
