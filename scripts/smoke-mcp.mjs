// Checks the built @lokal-id/mcp bundle (packages/mcp/dist/cli.js), not the sources the tests run: that it starts,
// serves its tools, and that each command works. CI runs it after the build; the release runs it before publishing.
//
//   npm run build && node scripts/smoke-mcp.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/mcp/dist/cli.js');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'packages/mcp/package.json'), 'utf8'));
assert.deepEqual(Object.keys(pkg.dependencies), ['@lokal-id/core'], 'everything else is bundled');

const dir = mkdtempSync(path.join(tmpdir(), 'lokal-smoke-'));
try {
  writeFileSync(path.join(dir, 'pelanggan.csv'), 'nama,nik\nBudi Santoso,3201011508950001\n');
  const client = new Client({ name: 'smoke', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI], env: { ...process.env, LOKAL_ROOT: dir } }));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const t of ['parse_nik', 'parse_qris', 'scan_pii', 'read_file_masked', 'anonymize_file']) assert.ok(tools.includes(t), t);
  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
  assert.equal((await call('parse_nik', { nik: '3201011508950001' })).regency, 'Kabupaten Bogor');
  assert.equal((await call('scan_pii', { path: '.' })).totals.NIK, 1);
  assert.equal((await call('anonymize_file', { paths: ['pelanggan.csv'], output: 'staging.csv', secret: 's' })).files[0].replaced.NIK, 1);
  await client.close();

  const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  assert.equal(run(['guard'], JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'NIK 3201011508950001' })).status, 2);
  for (const command of ['kembaran', 'proxy']) assert.equal(run([command, '--help']).status, 0, command);
  console.log(`bundle ok: ${tools.length} tools, guard, kembaran, proxy`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
