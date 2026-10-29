// Leak tests for the integrations: the canary person (core/test/canary.ts) in a project folder as text, JSON, a log,
// and CSV, through every way Lokal hands text to a model (MCP tool results, guard messages, the proxy's upstream), to a
// CI page (scan output), or to staging (Kembaran). None of their values may come out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertNoCanary, CANARY_FIELDS, CANARY_FORMATS } from '../../core/test/canary.ts';
import { startProxy } from '../src/proxy.ts';

const CLI = path.resolve(import.meta.dirname, '../src/cli.ts');
const FILES: Record<string, string> = {
  'pelanggan.txt': CANARY_FORMATS.text!,
  'pelanggan.json': CANARY_FORMATS.json!,
  'checkout.log': CANARY_FORMATS.log!,
  'pelanggan.csv': CANARY_FORMATS.csv!,
};
const value = (type: string) => CANARY_FIELDS.find(([, , t]) => t === type)![3];

let dir: string;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lokal-leaks-'));
  for (const [name, text] of Object.entries(FILES)) writeFileSync(path.join(dir, name), text);
});
after(() => rmSync(dir, { recursive: true, force: true }));

const run = (args: string[], input?: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: dir, input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env } });

test('leaks: no MCP tool result carries a value, whatever the tool', async () => {
  const client = new Client({ name: 'leaks', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI], env: { ...process.env, LOKAL_ROOT: dir } as Record<string, string> }));
  const results: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
    const text = res.content.map((c) => c.text).join('\n');
    results.push(name);
    assertNoCanary(text, `${name}(${JSON.stringify(args)})`);
    return text;
  };
  try {
    await call('scan_pii', { path: '.' });
    await call('scan_pii', { path: '.', min_confidence: 'medium' });
    let placeholders = '';
    for (const file of Object.keys(FILES)) placeholders += await call('read_file_masked', { path: file });
    // The model works on placeholders; the tools that take one must answer without the value behind it.
    const ph = (type: string) => new RegExp(`\\[${type}_\\d+\\]`).exec(placeholders)?.[0];
    for (const [tool, arg, type] of [
      ['parse_nik', 'nik', 'NIK'], ['validate_npwp', 'npwp', 'NPWP'], ['parse_phone', 'phone', 'PHONE'], ['parse_alamat', 'address', 'ADDRESS'],
    ] as const) {
      assert.ok(ph(type), `a ${type} placeholder to pass to ${tool}`);
      await call(tool, { [arg]: ph(type) });
    }
    // Writing restores values to disk, never into the answer.
    const out = await call('write_file_unmasked', { path: 'hasil/surat.txt', content: `Yth. ${ph('NAME')}, NIK ${ph('NIK')}, HP ${ph('PHONE')}.` });
    assert.match(out, /hasil\/surat\.txt/);
    const written = readFileSync(path.join(dir, 'hasil', 'surat.txt'), 'utf8');
    assert.equal(written, `Yth. ${value('NAME')}, NIK ${value('NIK')}, HP ${value('PHONE')}.`, 'the file holds the real values');
    // A fixed secret: a random stand-in can, once in a few hundred runs, land on the same birth day.
    for (const file of Object.keys(FILES)) await call('anonymize_file', { paths: [file], output: `staging/${file}`, secret: 'canary' });
    for (const name of ['format_rupiah', 'parse_rupiah', 'search_wilayah', 'list_wilayah', 'lookup_kode_pos', 'list_holidays', 'working_days', 'parse_qris', 'set_qris_amount']) {
      results.push(name); // these tools never read files or placeholders; listed so a new tool is not forgotten
    }
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual([...new Set(results)].sort(), tools, 'every tool is considered here');
  } finally {
    await client.close();
  }
});

test('leaks: Kembaran output (anonymize_file and the CLI) holds none of the values it replaces', () => {
  // Religion is kept on purpose: a staging copy needs realistic shares (KEEP_BY_DEFAULT).
  const kept = new Set([value('RELIGION')]);
  const check = (text: string, where: string) => {
    const leaked = CANARY_FIELDS.map(([, , , v]) => v).filter((v) => !kept.has(v) && text.includes(v));
    assert.deepEqual(leaked, [], `${where} kept ${leaked.join(', ')}`);
  };
  for (const file of Object.keys(FILES)) check(readFileSync(path.join(dir, 'staging', file), 'utf8'), `anonymize_file ${file}`);
  const res = run(['kembaran', ...Object.keys(FILES), '-o', 'staging-cli', '--secret', 'canary']);
  assert.equal(res.status, 0, res.stderr);
  assertNoCanary(res.stdout + res.stderr, 'kembaran CLI output');
  for (const file of Object.keys(FILES)) check(readFileSync(path.join(dir, 'staging-cli', file), 'utf8'), `kembaran CLI ${file}`);
});

test('leaks: the guard blocks every way to read the files, and its messages carry no value', () => {
  const guard = (event: object, env: Record<string, string> = {}) => {
    const res = run(['guard'], JSON.stringify({ cwd: dir, ...event }), env);
    assertNoCanary(res.stdout + res.stderr, `guard ${JSON.stringify(event).slice(0, 120)}`);
    return res.status;
  };
  for (const prompt of Object.values(CANARY_FORMATS)) assert.equal(guard({ hook_event_name: 'UserPromptSubmit', prompt: `tolong cek:\n${prompt}` }), 2);
  for (const file of Object.keys(FILES)) {
    assert.equal(guard({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, file) } }), 2, `Read ${file}`);
    for (const command of [`cat ${file}`, `head -n 5 ${file}`, `tail ${file}`, `grep 3174 ${file}`, `less ${file}`, `type ${file}`]) {
      assert.equal(guard({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }), 2, command);
    }
    assert.equal(guard({ hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command: `Get-Content ${file}` } }), 2, `Get-Content ${file}`);
    // One-liners that open the file are blocked in strict mode.
    const inline = `python -c "print(open('${file}').read())"`;
    assert.equal(guard({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: inline } }, { SAMARAN_GUARD: 'strict' }), 2, inline);
  }
});

test('leaks: lokal-mcp scan prints no value in any format', () => {
  for (const format of ['text', 'github', 'json']) {
    const res = run(['scan', '.', '--format', format]);
    assert.equal(res.status, 1, `scan --format ${format} finds the data`);
    assertNoCanary(res.stdout + res.stderr, `scan --format ${format}`);
  }
  const summary = path.join(dir, 'summary.md');
  run(['scan', '.', '--format', 'github'], undefined, { GITHUB_STEP_SUMMARY: summary });
  assertNoCanary(readFileSync(summary, 'utf8'), 'the GitHub job summary');
});

test('leaks: the proxy sends no value upstream, in any API shape, and logs none', async () => {
  const received: string[] = [];
  const upstream: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(body);
      if (JSON.parse(body || '{}').stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('data: {"choices":[{"index":0,"delta":{"content":"ok [NAME_1]"}}]}\n\ndata: [DONE]\n\n');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'ok [NAME_1]' } }] }));
      }
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const up = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const logs: string[] = [];
  const proxy = await startProxy({ port: 0, openai: up, anthropic: up, log: (l) => logs.push(l) });
  const base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then((r) => r.text());
  try {
    for (const [format, doc] of Object.entries(CANARY_FORMATS)) {
      const shapes: Array<[string, unknown, Record<string, string>?]> = [
        ['/v1/chat/completions', { model: 'm', messages: [{ role: 'system', content: doc }, { role: 'user', content: [{ type: 'text', text: `cek:\n${doc}` }] }, { role: 'tool', tool_call_id: 't', content: doc }] }],
        ['/v1/chat/completions', { model: 'm', stream: true, messages: [{ role: 'user', content: doc }] }],
        ['/v1/chat/completions', { model: 'm', messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 't', type: 'function', function: { name: 'simpan', arguments: JSON.stringify({ data: doc }) } }] }] }],
        ['/v1/responses', { model: 'm', instructions: doc, input: [{ role: 'user', content: [{ type: 'input_text', text: doc }] }] }],
        ['/v1/messages', { model: 'm', max_tokens: 10, system: doc, messages: [{ role: 'user', content: [{ type: 'text', text: doc }, { type: 'tool_result', tool_use_id: 't', content: doc }] }] }, { 'anthropic-version': '2023-06-01' }],
      ];
      for (const [p, body, headers] of shapes) {
        received.length = 0;
        const answer = await post(p, body, headers);
        assert.equal(received.length, 1, `${p} was forwarded`);
        assertNoCanary(received[0]!, `proxy ${p} (${format})`);
        assert.match(answer, /Kenanga Purbasari/, 'the app gets the real name back');
      }
    }
    assertNoCanary(logs.join('\n'), 'the proxy log');
  } finally {
    proxy.close();
    upstream.close();
  }
});
