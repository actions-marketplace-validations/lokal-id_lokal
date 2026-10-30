// "No network calls" is a claim the README makes; this test checks it. The MCP server (every tool), the guard, the
// scanner, and Kembaran run with every Node network API replaced by one that throws and logs (test/no-network.mjs).
// The proxy is left out: forwarding to the model provider is its job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { qrisCrc } from '@lokal-id/core';

const CLI = path.resolve(import.meta.dirname, '../src/cli.ts');
const PRELOAD = ['--import', pathToFileURL(path.resolve(import.meta.dirname, 'no-network.mjs')).href];

const f = (tag: string, value: string) => tag + String(value.length).padStart(2, '0') + value;
const QRIS_BODY = `${f('00', '01') + f('01', '11') + f('26', f('00', 'COM.CONTOH.WWW') + f('01', '936000000000000001'))}${
  f('52', '5812') + f('53', '360') + f('58', 'ID') + f('59', 'KOPI CONTOH') + f('60', 'BOGOR')
}6304`;
const QRIS = QRIS_BODY + qrisCrc(QRIS_BODY);

// One call per tool. A new tool must be added here, or the test fails.
const CALLS: Record<string, Record<string, unknown>> = {
  parse_nik: { nik: '3201011508950001' },
  validate_npwp: { npwp: '01.234.567.8-901.000' },
  parse_qris: { payload: QRIS },
  set_qris_amount: { payload: QRIS, amount: 15000 },
  parse_phone: { phone: '0812-3456-7890' },
  format_rupiah: { amount: 1500000 },
  parse_rupiah: { text: 'Rp1,5 jt' },
  search_wilayah: { query: 'Kemiri Muka' },
  list_wilayah: {},
  lookup_kode_pos: { kode_pos: '16423' },
  parse_alamat: { address: 'Jl. Margonda Raya No. 1, Kemiri Muka, Beji, Depok 16423' },
  list_holidays: { year: 2026 },
  working_days: { from: '2026-12-21', to: '2026-12-31' },
  scan_pii: { path: '.' },
  read_file_masked: { path: 'pelanggan.csv' },
  write_file_unmasked: { path: 'keluar.txt', content: 'halo' },
  anonymize_file: { paths: ['pelanggan.csv'], output: 'samaran.csv' },
  clear_vault: {},
};

test('the MCP server, guard, scanner, and Kembaran make no network calls', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-offline-'));
  const log = path.join(dir, 'network.log');
  const env = { ...process.env, LOKAL_ROOT: dir, LOKAL_NETWORK_LOG: log } as Record<string, string>;
  writeFileSync(path.join(dir, 'pelanggan.csv'), 'nama,nik,hp\nBudi Santoso,3201011508950001,0812-3456-7890\n');
  try {
    const client = new Client({ name: 'offline', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [...PRELOAD, CLI], env }));
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual(tools, Object.keys(CALLS).sort(), 'every tool has a call in CALLS');
      for (const [name, args] of Object.entries(CALLS)) {
        const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
        assert.ok(!res.isError, `${name}: ${res.content[0]?.text}`);
      }
    } finally {
      await client.close();
    }

    const run = (args: string[], input?: string) =>
      spawnSync(process.execPath, [...PRELOAD, CLI, ...args], { cwd: dir, env: { ...env, CLAUDE_PROJECT_DIR: dir }, input, encoding: 'utf8' });
    assert.equal(run(['guard'], JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'NIK 3201011508950001' })).status, 2);
    const read = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'pelanggan.csv') } };
    assert.equal(run(['guard'], JSON.stringify(read)).status, 2);
    assert.equal(run(['scan', '.']).status, 1);
    assert.equal(run(['kembaran', 'pelanggan.csv', '-o', 'kembaran.csv']).status, 0);

    assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '', 'no network attempts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the preload does block the network', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-offline-'));
  const log = path.join(dir, 'network.log');
  try {
    const code = "try { fetch('https://example.com') } catch {} try { require('node:dns').lookup('example.com', () => {}) } catch {}";
    spawnSync(process.execPath, [...PRELOAD, '-e', code], { env: { ...process.env, LOKAL_NETWORK_LOG: log }, encoding: 'utf8' });
    assert.match(readFileSync(log, 'utf8'), /^fetch https:\/\/example\.com\ndns\.lookup example\.com\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
