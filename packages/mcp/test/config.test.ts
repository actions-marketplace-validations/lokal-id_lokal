// .samaran.json: a team's own rules, read by the MCP server, the guard, `lokal-mcp scan`, and the proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfig } from '../src/files.ts';

const CLI = path.resolve(import.meta.dirname, '../src/cli.ts');
const CONFIG = {
  custom: [
    { label: 'EMPLOYEE_ID', pattern: String.raw`\bEMP-\d{6}\b` },
    { label: 'MEMBER', fields: ['no_member'] },
  ],
  allow: ['EMP-000001'],
};
// Nothing here is a built-in type: without the rules, Samaran finds nothing.
const CSV = 'no_member,karyawan,catatan\nM-0042,EMP-004211,ganti shift\nM-0043,EMP-000001,akun contoh\n';

function project(config: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-config-'));
  writeFileSync(path.join(dir, 'absen.csv'), CSV);
  if (config !== undefined) writeFileSync(path.join(dir, '.samaran.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return dir;
}

async function server(dir: string) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [CLI], env: { ...process.env, LOKAL_ROOT: dir } as Record<string, string> }),
  );
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: res.content[0]!.text, isError: res.isError };
  };
  return { call, close: () => client.close() };
}

const guard = (dir: string, event: object, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [CLI, 'guard'], {
    input: JSON.stringify(event),
    env: { ...process.env, ...env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  });

test('.samaran.json: the server masks, scans, and counts by the rules', async () => {
  const dir = project(CONFIG);
  const { call, close } = await server(dir);
  try {
    const read = await call('read_file_masked', { path: 'absen.csv' });
    assert.match(read.text, /\[MEMBER_1\],\[EMPLOYEE_ID_1\],ganti shift/);
    assert.match(read.text, /\[MEMBER_2\],EMP-000001,akun contoh/, 'allowed values stay');
    assert.ok(!read.text.includes('EMP-004211') && !read.text.includes('M-0042'));
    assert.match(read.text, /"EMPLOYEE_ID":1/);
    const scan = JSON.parse((await call('scan_pii', { path: 'absen.csv' })).text);
    assert.deepEqual(scan.totals, { MEMBER: 2, EMPLOYEE_ID: 1 });
    assert.equal(scan.findings[0].type, 'CUSTOM');
    assert.equal(scan.findings[0].label, 'MEMBER');
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('.samaran.json: the guard blocks files and prompts with the team\'s IDs', () => {
  const dir = project(CONFIG);
  try {
    const read = guard(dir, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'absen.csv') } });
    assert.equal(read.status, 2);
    assert.match(read.stderr, /MEMBER×2/);
    const prompt = guard(dir, { hook_event_name: 'UserPromptSubmit', prompt: 'cek absen EMP-004211 dong' });
    assert.equal(prompt.status, 2);
    assert.match(prompt.stderr, /EMPLOYEE_ID×1/);
    assert.equal(guard(dir, { hook_event_name: 'UserPromptSubmit', prompt: 'akun contoh EMP-000001' }).status, 0, 'allowed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('.samaran.json: `lokal-mcp scan` uses the rules', () => {
  const dir = project(CONFIG);
  try {
    const res = spawnSync(process.execPath, [CLI, 'scan', 'absen.csv', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(res.status, 1, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.deepEqual(report.findings.map((f: { label: string }) => f.label), ['MEMBER', 'EMPLOYEE_ID', 'MEMBER']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a broken .samaran.json stops the file tools instead of masking less', async () => {
  const dir = project({ custom: [{ label: 'employee', pattern: 'EMP' }] });
  const { call, close } = await server(dir);
  try {
    const read = await call('read_file_masked', { path: 'absen.csv' });
    assert.equal(read.isError, true);
    assert.match(read.text, /capital letters.*restart the MCP server/);
    assert.equal((await call('scan_pii', { path: '.' })).isError, true);
    // Data tools that read no files still work.
    assert.equal((await call('format_rupiah', { amount: 1500 })).isError, undefined);
  } finally {
    await close();
  }
  try {
    const scan = spawnSync(process.execPath, [CLI, 'scan', '.'], { cwd: dir, encoding: 'utf8' });
    assert.equal(scan.status, 2);
    assert.match(scan.stderr, /\.samaran\.json/);
    const event = { hook_event_name: 'UserPromptSubmit', prompt: 'halo' };
    assert.equal(guard(dir, event).status, 0, 'the default guard never breaks the session');
    assert.equal(guard(dir, event, { SAMARAN_GUARD: 'strict' }).status, 2, 'strict mode blocks');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig explains what is wrong', () => {
  const cases: Array<[unknown, RegExp]> = [
    ['{ not json', /not valid JSON/],
    [[], /expected an object/],
    [{ rules: [] }, /unknown key "rules"/],
    [{ custom: {} }, /"custom" must be a list/],
    [{ allow: [1] }, /"allow" must be a list of strings/],
    [{ custom: [{ label: 'A', regex: 'x' }] }, /unknown key "regex"/],
    [{ custom: [{ pattern: 'x' }] }, /needs a "label"/],
    [{ custom: [{ label: 'A', fields: 'no_member' }] }, /fields must be a list/],
    [{ custom: [{ label: 'NIK', pattern: 'x' }] }, /built-in type/],
    [{ custom: [{ label: 'A', pattern: '(' }] }, /does not compile/],
  ];
  for (const [config, why] of cases) {
    const dir = project(config);
    try {
      assert.throws(() => loadConfig(dir), why, JSON.stringify(config));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const none = project(undefined);
  assert.deepEqual(loadConfig(none), { custom: [], allow: [] });
  rmSync(none, { recursive: true, force: true });
  const ok = project({ $schema: 'x', ...CONFIG });
  assert.deepEqual(loadConfig(ok), CONFIG);
  rmSync(ok, { recursive: true, force: true });
});
