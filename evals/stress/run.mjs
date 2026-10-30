#!/usr/bin/env node
// Stress test: how fast Lokal is, and whether it stays correct and bounded, on large and hostile input.
//
//   npm run build && node --expose-gc evals/stress/run.mjs [--quick]
//
// Every value is made up: documents come from the benchmark generator (evals/bench/corpus.mjs). Each check prints its
// numbers, and the script exits with 1 if a hard limit is broken (a leak, a wrong count, an error, a time limit).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { detectPii, Samaran } from '../../packages/core/dist/index.js';
import { Kembaran } from '../../packages/core/dist/kembaran.js';
import { startProxy } from '../../packages/mcp/src/proxy.ts';
import { generate } from '../bench/corpus.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLI = path.join(ROOT, 'packages/mcp/dist/cli.js');
const quick = process.argv.includes('--quick');
const MB = 1024 * 1024;
const failures = [];
const results = [];

const gc = () => globalThis.gc?.();
const heapMb = () => Math.round(process.memoryUsage().heapUsed / MB);
const time = (fn) => {
  const t = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t };
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
function report(name, numbers, check) {
  const problem = check?.();
  results.push({ name, ...numbers, ok: !problem });
  console.log(`${problem ? 'FAIL' : 'ok  '} ${name.padEnd(46)} ${Object.entries(numbers).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  if (problem) {
    failures.push(`${name}: ${problem}`);
    console.log(`     ${problem}`);
  }
}

// --- made-up data ----------------------------------------------------------------------------------------------
const docs = generate({ split: 'dev' });
const csvDocs = docs.filter((d) => d.format === 'csv').map((d) => d.text);
const chatDocs = docs.filter((d) => ['chat', 'typo', 'mixed'].includes(d.format)).map((d) => d.text);
const allDocs = docs.map((d) => d.text);
const NIKS = [...new Set(allDocs.join('\n').match(/\b\d{16}\b/g))];
const fill = (parts, bytes, sep = '\n') => {
  const out = [];
  let size = 0;
  for (let i = 0; size < bytes; i++) {
    const p = parts[i % parts.length];
    out.push(p);
    size += p.length + sep.length;
  }
  return out.join(sep);
};
const size = (n) => (quick ? Math.ceil(n / 5) : n);

// A CSV export: one header, many rows from the CSV documents.
const header = 'nama,nik,hp,email,alamat,catatan';
const rows = docs
  .filter((d) => d.format === 'form')
  .map((d) => {
    const f = (re) => (re.exec(d.text)?.[1] ?? '').replace(/,/g, ' ');
    return [f(/NAMA\s*:\s*(.+)/i), f(/(\d{16})/), f(/(08[\d-]{9,14})/), 'x@example.com', f(/ALAMAT\s*:\s*(.+)/i), 'ok'].join(',');
  });
const csv = `${header}\n${fill(rows, size(10 * MB))}\n`;
const jsonl = fill(allDocs.map((t, i) => JSON.stringify({ ts: '2026-10-30T01:02:03Z', level: 'info', req: i, body: t })), size(10 * MB));
const chat = fill(chatDocs, size(5 * MB), '\n\n');

// --- 1. detection throughput -----------------------------------------------------------------------------------
console.log(`Lokal stress test${quick ? ' (quick)' : ''}: Node ${process.version}, ${cpus().length} CPUs, ${Math.round(totalmem() / MB / 1024)} GB RAM\n`);
for (const [name, text, minMbs] of [['detectPii: CSV export', csv, 0.5], ['detectPii: JSON log lines', jsonl, 0.5], ['detectPii: chat and prose', chat, 0.3]]) {
  gc();
  const { value, ms } = time(() => detectPii(text));
  const mbs = text.length / MB / (ms / 1000);
  report(name, { MB: (text.length / MB).toFixed(1), seconds: (ms / 1000).toFixed(2), 'MB/s': mbs.toFixed(2), matches: value.length, heapMB: heapMb() },
    () => (mbs < minMbs ? `slower than ${minMbs} MB/s` : value.length === 0 ? 'found nothing' : undefined));
}

// Hostile input: what a guard reading an attacker's file, or a proxy reading a crafted prompt, must survive in time.
const hostile = [
  ['one 2 MB line of capitalized words', 'Budi Santoso Wijaya Pratama '.repeat(size(75_000))],
  ['2 MB of digits and dashes', '1234-5678-'.repeat(size(200_000))],
  ['2 MB of "Nama:" labels', 'Nama: Nama: Nama: '.repeat(size(110_000))],
  ['deeply escaped JSON string', JSON.stringify(JSON.stringify(JSON.stringify({ nama: 'Budi Santoso', catatan: 'x'.repeat(size(1_000_000)) })))],
  ['1 MB of commas (CSV with no data)', ','.repeat(size(1_000_000))],
  ['50k one-line CSV header columns', Array.from({ length: size(50_000) }, (_, i) => `nama_${i}`).join(',')],
  ['1 MB without spaces', 'a'.repeat(size(1_000_000))],
  ['emoji and astral characters', '🙏 Nama: Budi Santoso 🙏 NIK 3201011508950001 '.repeat(size(20_000))],
];
for (const [name, text] of hostile) {
  const { value, ms } = time(() => detectPii(text));
  report(`hostile: ${name}`, { KB: Math.round(text.length / 1024), seconds: (ms / 1000).toFixed(2), matches: value.length },
    () => (ms > 7000 ? 'longer than the guard\'s 7-second budget' : undefined));
}

// --- 2. Samaran mask and unmask --------------------------------------------------------------------------------
{
  const messages = chatDocs.slice(0, size(5000));
  gc();
  const before = heapMb();
  const s = new Samaran();
  const { ms } = time(() => {
    for (const m of messages) {
      const masked = s.mask(m).text;
      // One vault gives one placeholder to a name however it is cased, and restores the casing it saw first.
      if (s.unmask(masked).toLowerCase() !== m.toLowerCase()) throw new Error('round trip changed a message');
    }
  });
  report('Samaran: mask + unmask each chat message', { messages: messages.length, 'ms/message': (ms / messages.length).toFixed(3), heapMB: heapMb() - before });

  gc();
  const v = new Samaran();
  const many = Array.from({ length: size(100_000) }, (_, i) => `NIK ${NIKS[i % NIKS.length].slice(0, 10)}${String(i).padStart(6, '0')}`);
  const heap0 = heapMb();
  const r = time(() => many.map((t) => v.mask(t).text));
  gc();
  report('Samaran: one vault with 100k distinct values', { values: many.length, seconds: (r.ms / 1000).toFixed(2), vaultHeapMB: heapMb() - heap0 },
    () => (heapMb() - heap0 > 512 ? 'vault uses more than 512 MB' : undefined));
}

// --- 3. Kembaran -----------------------------------------------------------------------------------------------
{
  const dump = `CREATE TABLE pelanggan (id int, nama varchar(100), nik char(16), hp varchar(20), email varchar(80), alamat text, catatan text);\n${
    rows.slice(0, size(20_000)).map((r, i) => `INSERT INTO pelanggan VALUES (${i},${r.split(',').map((f) => `'${f.replace(/'/g, "''")}'`).join(',')});`).join('\n')}\n`;
  gc();
  const k = new Kembaran({ secret: 'stress' });
  const { value, ms } = time(() => k.texts([dump, csv.slice(0, size(5 * MB))]));
  const mb = (dump.length + Math.min(csv.length, size(5 * MB))) / MB;
  report('Kembaran.texts: SQL dump + CSV export', { MB: mb.toFixed(1), seconds: (ms / 1000).toFixed(2), 'MB/s': (mb / (ms / 1000)).toFixed(2), leaked: value.leaked, heapMB: heapMb() },
    () => {
      const realNik = NIKS.find((n) => dump.includes(n));
      if (realNik && value.files.some((f) => f.text.includes(realNik))) return 'a real NIK is in the output';
      return value.leaked > 0 ? `${value.leaked} real values left` : undefined;
    });
}

// --- 4. proxy under load ---------------------------------------------------------------------------------------
{
  // What Samaran finds in a text must never reach the upstream: identity numbers, phones, e-mail, accounts.
  const IDENTIFIERS = new Set(['NIK', 'KK', 'NPWP', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CARD', 'BPJS', 'PASSPORT', 'NAME']);
  const realValues = (text) => detectPii(text).filter((m) => IDENTIFIERS.has(m.type) && m.value.length >= 5).map((m) => m.value);
  const bodies = new Map();
  const upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = JSON.parse(body);
      bodies.set(json.user, body);
      const content = json.messages.at(-1).content;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `Diterima: ${content.slice(0, 200)}` } }] }));
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  // The proxy logs a line per request; keep the report readable.
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  const proxy = await startProxy({ port: 0, openai: `http://127.0.0.1:${upstream.address().port}` });
  const url = `http://127.0.0.1:${proxy.address().port}/v1/chat/completions`;
  const total = size(3000);
  const concurrency = 64;
  const latencies = [];
  let errors = 0;
  let unrestored = 0;
  let next = 0;
  gc();
  const rss0 = process.memoryUsage().rss;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const i = next++;
      const doc = allDocs[i % allDocs.length];
      const t = performance.now();
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer sk-stress' },
          body: JSON.stringify({ model: 'gpt-x', user: String(i), messages: [{ role: 'system', content: 'CS bot' }, { role: 'user', content: doc }] }),
        });
        const json = await r.json();
        if (r.status !== 200) errors++;
        // The answer quotes the user's text: the proxy must put the real values back.
        else if (!json.choices[0].message.content.startsWith(`Diterima: ${doc.slice(0, 20)}`)) unrestored++;
      } catch {
        errors++;
      }
      latencies.push(performance.now() - t);
    }
  }));
  const seconds = (performance.now() - t0) / 1000;
  let leaked = 0;
  for (let i = 0; i < total; i++) {
    const body = bodies.get(String(i)) ?? '';
    if (realValues(allDocs[i % allDocs.length]).some((v) => body.includes(JSON.stringify(v).slice(1, -1)))) leaked++;
  }
  process.stderr.write = write;
  report('proxy: OpenAI requests, 64 at a time', {
    requests: total, 'req/s': Math.round(total / seconds), p50ms: pct(latencies, 50).toFixed(1), p95ms: pct(latencies, 95).toFixed(1),
    p99ms: pct(latencies, 99).toFixed(1), errors, unrestored, rssMB: Math.round((process.memoryUsage().rss - rss0) / MB),
  }, () => (errors ? `${errors} failed` : leaked ? `${leaked} requests reached the upstream with a value Samaran found` : unrestored ? `${unrestored} answers not restored` : bodies.size !== total ? 'request count' : undefined));

  // One big request: a 2 MB CSV pasted into a prompt.
  process.stderr.write = () => true;
  const big = csv.slice(0, size(2 * MB));
  const t = performance.now();
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-x', user: 'big', messages: [{ role: 'user', content: big }] }) });
  await r.text();
  const ms = performance.now() - t;
  process.stderr.write = write;
  const bigBody = bodies.get('big') ?? '';
  const bigLeaks = realValues(big).filter((v) => bigBody.includes(JSON.stringify(v).slice(1, -1))).length;
  report('proxy: one request with a 2 MB CSV', { status: r.status, seconds: (ms / 1000).toFixed(2) }, () => (r.status !== 200 ? 'failed' : bigLeaks ? `${bigLeaks} values reached the upstream` : undefined));
  proxy.close();
  upstream.close();
}

// --- 5. guard hook, MCP server, and scan (separate processes, as agents run them) --------------------------------
const dir = mkdtempSync(path.join(tmpdir(), 'lokal-stress-'));
try {
  writeFileSync(path.join(dir, 'pelanggan.csv'), csv.slice(0, MB));
  writeFileSync(path.join(dir, 'besar.csv'), csv.slice(0, size(20 * MB)));
  writeFileSync(path.join(dir, 'bersih.csv'), 'id,kota\n1,Bandung\n'.repeat(1000));
  const guard = (event) => {
    const t = performance.now();
    const r = spawnSync(process.execPath, [CLI, 'guard'], { input: JSON.stringify(event), env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SAMARAN_GUARD: '' }, encoding: 'utf8' });
    return { ms: performance.now() - t, status: r.status };
  };
  for (const [name, file, expected] of [['guard: Read of a clean CSV', 'bersih.csv', 0], ['guard: Read of a 1 MB CSV with data', 'pelanggan.csv', 2], ['guard: Read of a 20 MB CSV with data', 'besar.csv', 2]]) {
    const runs = Array.from({ length: quick ? 3 : 10 }, () => guard({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, file) } }));
    report(name, { runs: runs.length, p50ms: Math.round(pct(runs.map((r) => r.ms), 50)), maxMs: Math.round(Math.max(...runs.map((r) => r.ms))) },
      () => (runs.some((r) => r.status !== expected) ? `exit ${runs.map((r) => r.status).join(',')}, expected ${expected}` : Math.max(...runs.map((r) => r.ms)) > 10_000 ? 'over the 10-second hook limit' : undefined));
  }
  const prompts = Array.from({ length: quick ? 3 : 10 }, () => guard({ hook_event_name: 'UserPromptSubmit', prompt: chat.slice(0, 50_000) }));
  report('guard: a 50 KB prompt', { runs: prompts.length, p50ms: Math.round(pct(prompts.map((r) => r.ms), 50)) });

  const client = new Client({ name: 'stress', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI], env: { ...process.env, LOKAL_ROOT: dir } }));
  try {
    for (const [file, lim] of [['pelanggan.csv', 30_000], ['besar.csv', 120_000]]) {
      const t = performance.now();
      const r = await client.callTool({ name: 'read_file_masked', arguments: { path: file } }, undefined, { timeout: lim });
      const text = r.content[0].text;
      report(`MCP read_file_masked: ${file}`, { seconds: ((performance.now() - t) / 1000).toFixed(2), returnedKB: Math.round(text.length / 1024) },
        () => (/\b\d{16}\b/.test(text) ? 'a NIK reached the model' : r.isError ? text.slice(0, 200) : undefined));
    }
  } finally {
    await client.close();
  }

  const many = path.join(dir, 'repo');
  mkdirSync(many);
  for (let i = 0; i < size(500); i++) writeFileSync(path.join(many, `f${i}.${['csv', 'json', 'log', 'txt', 'sql'][i % 5]}`), allDocs.slice(i * 3, i * 3 + 3).join('\n'));
  const t = performance.now();
  const scan = spawnSync(process.execPath, [CLI, 'scan', many, '--format', 'json', '--no-fail'], { cwd: many, encoding: 'utf8', maxBuffer: 256 * MB });
  const out = JSON.parse(scan.stdout);
  report('lokal-mcp scan: a folder of 500 files', { files: out.filesScanned, seconds: ((performance.now() - t) / 1000).toFixed(2), findings: out.findings.length },
    () => (scan.status !== 0 ? `exit ${scan.status}: ${scan.stderr.slice(0, 200)}` : out.findings.some((f) => /\d{16}/.test(f.preview ?? '')) ? 'a full NIK in the report' : undefined));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exitCode = failures.length ? 1 : 0;
