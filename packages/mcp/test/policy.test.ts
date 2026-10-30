// Fase 2: what to do per type (.samaran.json "policy"), routing to a local model, the audit log, and the vault's TTL.
// Every value here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfig } from '../src/files.ts';
import { startProxy } from '../src/proxy.ts';

const CLI = path.resolve(import.meta.dirname, '../src/cli.ts');
const VALUES = ['Kenanga Purbasari', '3174015507880099', 'C7788120', '0813-7788-1290', 'hipertensi'];

function project(config: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-policy-'));
  writeFileSync(path.join(dir, '.samaran.json'), JSON.stringify(config));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

const noValues = (text: string, what: string) => {
  for (const v of VALUES) assert.ok(!text.includes(v), `${what} holds ${v}`);
};

test('policy: .samaran.json is checked as strictly as the rules', () => {
  const bad: Array<[unknown, RegExp]> = [
    [{ policy: { NOPE: 'mask' } }, /"NOPE" is neither a type/],
    [{ policy: { HEALTH: 'hide' } }, /policy\.HEALTH must be one of "mask", "allow", "block", "route"/],
    [{ custom: [{ label: 'MEMBER', fields: ['no_member'] }], policy: { MEMBER: 'allow' } }, /remove the rule from "custom" instead/],
    [{ policy: { HEALTH: 'route' } }, /needs a local endpoint/],
    [{ route: { openai: 'ftp://x' } }, /route\.openai must be an http\(s\) URL/],
    [{ audit: 3 }, /"audit" must be true or a file path/],
    [{ vaultTtlMinutes: 0 }, /must be a positive number/],
    [{ polcy: {} }, /unknown key "polcy"/],
  ];
  for (const [config, message] of bad) {
    const dir = project(config);
    assert.throws(() => loadConfig(dir), message, JSON.stringify(config));
    rmSync(dir, { recursive: true, force: true });
  }
  const dir = project({
    custom: [{ label: 'MEMBER', fields: ['no_member'] }],
    policy: { HEALTH: 'block', FINANCIAL: 'allow', PASSPORT: 'route', MEMBER: 'block' },
    route: { openai: 'http://127.0.0.1:11434/v1', model: 'llama3.2' },
    audit: true,
    vaultTtlMinutes: 30,
  });
  const config = loadConfig(dir);
  assert.equal(config.audit, path.join(dir, '.lokal', 'audit.jsonl'));
  assert.equal(config.route?.model, 'llama3.2');
  assert.equal(config.vaultTtlMinutes, 30);
  // The Python library loads the same file.
  const py = spawnSync('uv', ['run', '--project', path.resolve(import.meta.dirname, '../../../python'), 'python', '-c',
    `from lokal.files import load_config; print(len(load_config(${JSON.stringify(dir)})[0]))`], { encoding: 'utf8' });
  if (py.status !== null && !py.error) assert.equal(py.stdout.trim(), '1', py.stderr);
  rmSync(dir, { recursive: true, force: true });
});

test('proxy: policy blocks, routes to the local model, allows, and every request is in the audit log', async () => {
  const cloud: Array<{ body: string }> = [];
  const local: Array<{ body: string; headers: IncomingMessage['headers'] }> = [];
  const fake = (calls: Array<{ body: string; headers?: IncomingMessage['headers'] }>, reply: string) =>
    createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        calls.push({ body, headers: req.headers });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: reply } }] }));
      });
    });
  const up = fake(cloud, 'dari cloud');
  const lo = fake(local as Array<{ body: string; headers?: IncomingMessage['headers'] }>, 'dari model lokal');
  await new Promise<void>((r) => up.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => lo.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-policy-proxy-'));
  const audit = path.join(dir, 'audit.jsonl');
  const proxy: Server = await startProxy({
    port: 0,
    openai: `http://127.0.0.1:${(up.address() as AddressInfo).port}`,
    policy: { HEALTH: 'block', PASSPORT: 'route', FINANCIAL: 'allow' },
    route: { openai: `http://127.0.0.1:${(lo.address() as AddressInfo).port}/v1`, model: 'llama3.2' },
    audit,
    log: () => {},
  });
  const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const chat = (content: string, api = '/v1/chat/completions') =>
    fetch(`${url}${api}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-cloud-key', ...(api === '/v1/messages' ? { 'anthropic-version': '2023-06-01' } : {}) },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content }] }),
    });
  try {
    // block: refused here, nothing reaches the cloud.
    const blocked = await chat('Pasien Kenanga Purbasari didiagnosis hipertensi, tolong rangkum.');
    assert.equal(blocked.status, 403);
    assert.match(await blocked.text(), /policy does not let leave this machine \(HEALTH=1\)/);
    assert.equal(cloud.length, 0);

    // route: sent as it is to the local model, with its model name and without the cloud API key.
    const routed = await chat('Nama: Kenanga Purbasari, paspor C7788120. Isi formulir visanya.');
    assert.equal(routed.status, 200);
    assert.match(routed.headers.get('x-samaran-routed') ?? '', /PASSPORT=1/);
    assert.match(await routed.text(), /dari model lokal/);
    assert.equal(cloud.length, 0, 'a routed request never reaches the cloud');
    assert.equal(local.length, 1);
    assert.match(local[0]!.body, /C7788120/);
    assert.equal(JSON.parse(local[0]!.body).model, 'llama3.2');
    assert.equal(local[0]!.headers.authorization, undefined, 'the cloud key stays home');

    // allow: the model sees the salary; the NIK is still masked.
    const allowed = await chat('NIK 3174015507880099, gaji Rp8.500.000 per bulan. Hitung cicilan maksimalnya.');
    assert.equal(allowed.status, 200);
    assert.equal(cloud.length, 1);
    assert.match(cloud[0]!.body, /Rp8\.500\.000/);
    assert.ok(!cloud[0]!.body.includes('3174015507880099'));

    // route without a local endpoint for that API: refused, not sent to the cloud.
    const anthropic = await chat('Paspor saya C7788120, tolong cek.', '/v1/messages');
    assert.equal(anthropic.status, 403);
    assert.match(await anthropic.text(), /no local Anthropic-compatible endpoint/);
    assert.equal(cloud.length, 1);

    const lines = readFileSync(audit, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.action), ['blocked', 'routed', 'masked', 'refused']);
    assert.ok(lines.every((l) => l.source === 'proxy' && l.what.startsWith('/v1/') && l.ts));
    assert.equal(lines[0].counts.HEALTH, 1);
    assert.equal(lines[2].counts.NIK, 1);
    noValues(readFileSync(audit, 'utf8'), 'the audit log');
  } finally {
    proxy.close();
    up.close();
    lo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function server(dir: string, env: Record<string, string> = {}) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [CLI], env: { ...process.env, ...env, LOKAL_ROOT: dir } as Record<string, string> }),
  );
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: res.content[0]!.text, isError: res.isError };
  };
  return { call, close: () => client.close() };
}

test('MCP: the policy blocks a file, lets allowed types through, and the vault can be forgotten', async () => {
  const dir = project(
    { policy: { HEALTH: 'block', FINANCIAL: 'allow' }, audit: true },
    {
      'pasien.csv': 'nama,diagnosa\nKenanga Purbasari,hipertensi\n',
      'gaji.csv': 'nama,nik,gaji\nKenanga Purbasari,3174015507880099,8500000\n',
    },
  );
  const { call, close } = await server(dir);
  try {
    const refused = await call('read_file_masked', { path: 'pasien.csv' });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /policy in \.samaran\.json does not let reach the model, even masked \(HEALTH×1\)/);
    noValues(refused.text, 'the refusal');

    const read = await call('read_file_masked', { path: 'gaji.csv' });
    assert.match(read.text, /\[NAME_1\],\[NIK_1\],8500000/);
    const wrote = JSON.parse((await call('write_file_unmasked', { path: 'out.csv', content: '[NAME_1];[NIK_1]' })).text);
    assert.equal(wrote.restored, 2);

    const cleared = JSON.parse((await call('clear_vault', {})).text);
    assert.ok(cleared.forgot >= 2);
    const after = JSON.parse((await call('write_file_unmasked', { path: 'out2.csv', content: '[NAME_1]' })).text);
    assert.deepEqual(after.unknownPlaceholders, ['[NAME_1]']);
    assert.equal(readFileSync(path.join(dir, 'out2.csv'), 'utf8'), '[NAME_1]', 'nothing to restore any more');

    const log = path.join(dir, '.lokal', 'audit.jsonl');
    assert.equal(readFileSync(path.join(dir, '.lokal', '.gitignore'), 'utf8'), '*\n', 'the audit folder stays out of git');
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => `${l.action} ${l.what}`), [
      'blocked read_file_masked', 'masked read_file_masked', 'restored write_file_unmasked', 'forgot clear_vault', 'restored write_file_unmasked',
    ]);
    assert.equal(lines[0].file, 'pasien.csv');
    assert.deepEqual(lines[2].counts, { NAME: 1, NIK: 1 });
    noValues(readFileSync(log, 'utf8'), 'the audit log');

    // lokal-mcp audit summarizes it.
    const summary = spawnSync(process.execPath, [CLI, 'audit'], { cwd: dir, encoding: 'utf8' });
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /5 event\(s\)/);
    assert.match(summary.stdout, /mcp blocked\s+1/);
    assert.match(summary.stdout, /read_file_masked pasien\.csv NAME=1,HEALTH=1 \(policy blocks HEALTH\)/);
    const asJson = JSON.parse(spawnSync(process.execPath, [CLI, 'audit', '--json', '--since', '1h'], { cwd: dir, encoding: 'utf8' }).stdout);
    assert.equal(asJson.events, 5);
    assert.equal(asJson.byType.NIK, 2);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MCP: the vault forgets after vaultTtlMinutes without use', async () => {
  const dir = project({ audit: true }, { 'data.csv': 'nama,nik\nKenanga Purbasari,3174015507880099\n' });
  // 0.005 minutes is 300 ms.
  const { call, close } = await server(dir, { LOKAL_VAULT_TTL_MINUTES: '0.005' });
  try {
    await call('read_file_masked', { path: 'data.csv' });
    const soon = JSON.parse((await call('write_file_unmasked', { path: 'a.csv', content: '[NIK_1]' })).text);
    assert.equal(soon.restored, 1);
    await new Promise((r) => setTimeout(r, 700));
    const late = JSON.parse((await call('write_file_unmasked', { path: 'b.csv', content: '[NIK_1]' })).text);
    assert.deepEqual(late.unknownPlaceholders, ['[NIK_1]']);
    assert.match(readFileSync(path.join(dir, '.lokal', 'audit.jsonl'), 'utf8'), /"action":"forgot","what":"vault"/);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guard: types the policy blocks are held back one at a time; allowed types are not counted; decisions are audited', () => {
  const dir = project(
    { policy: { PHONE: 'block', NIK: 'allow' }, audit: true },
    { 'kontak.csv': 'nama,hp\nKenanga Purbasari,0813-7788-1290\n' },
  );
  const guard = (event: object) =>
    spawnSync(process.execPath, [CLI, 'guard'], { input: JSON.stringify(event), env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  try {
    // One phone number passes by default; here the policy blocks it.
    assert.equal(guard({ hook_event_name: 'UserPromptSubmit', prompt: 'hubungi 0813-7788-1290 ya' }).status, 2);
    assert.equal(guard({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'kontak.csv') }, cwd: dir }).status, 2);
    // A NIK is held by default; here the policy allows it.
    assert.equal(guard({ hook_event_name: 'UserPromptSubmit', prompt: 'cek NIK 3174015507880099' }).status, 0);
    const lines = readFileSync(path.join(dir, '.lokal', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => `${l.source} ${l.action} ${l.what}`), ['guard blocked UserPromptSubmit', 'guard blocked PreToolUse Read']);
    assert.equal(lines[0].counts.PHONE, 1);
    noValues(readFileSync(path.join(dir, '.lokal', 'audit.jsonl'), 'utf8'), 'the audit log');
    assert.ok(existsSync(path.join(dir, '.lokal', '.gitignore')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
