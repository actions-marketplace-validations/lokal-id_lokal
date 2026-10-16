#!/usr/bin/env node
// Runs each eval case in real Claude Code (`claude -p`) twice — without and with the Lokal plugin —
// in fresh empty directories, then grades the results.
//
//   node evals/run.mjs [--cases a,b] [--variants baseline,lokal] [--repeat 3] [--model sonnet] [--concurrency 4]
//
// Requires a logged-in `claude` CLI and a built repo (`npm run build`). Uses only local settings
// (--setting-sources local) so the user's other plugins and hooks do not affect either variant.
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cases } from './cases.mjs';

const REPO = path.resolve(import.meta.dirname, '..');
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const selected = args.cases ? cases.filter((c) => args.cases.split(',').includes(c.id)) : cases;
const variants = (args.variants ?? 'baseline,lokal').split(',');
const concurrency = Number(args.concurrency ?? 2);
const repeat = Number(args.repeat ?? 1);
const TIMEOUT_MS = 15 * 60 * 1000;

/** The plugin as installed, except the MCP server runs from this checkout instead of npm. */
function stagePlugin() {
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-plugin-'));
  for (const part of ['.claude-plugin', 'skills', 'hooks']) cpSync(path.join(REPO, part), path.join(dir, part), { recursive: true });
  const cli = path.join(REPO, 'packages', 'mcp', 'dist', 'cli.js');
  writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ lokal: { command: process.execPath, args: [cli] } }, null, 2));
  return dir;
}

function readTextFiles(dir) {
  const files = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', '.git', '.claude'].includes(e.name)) walk(full);
      } else if (statSync(full).size < 1e6) {
        files[path.relative(dir, full).split(path.sep).join('/')] = readFileSync(full, 'utf8');
      }
    }
  };
  walk(dir);
  return files;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
  return JSON.stringify(content ?? '');
}

function runClaude(testCase, variant, pluginDir) {
  const cwd = mkdtempSync(path.join(tmpdir(), `lokal-eval-${testCase.id}-${variant}-`));
  for (const f of testCase.fixtures ?? []) copyFileSync(path.join(REPO, 'evals', 'fixtures', f), path.join(cwd, f));

  // The prompt goes in on stdin: no shell, no quoting rules to get wrong on Windows.
  const cliArgs = [
    '-p',
    '--output-format', 'stream-json', '--verbose',
    '--setting-sources', 'local',
    '--no-session-persistence',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash PowerShell Read Write Edit Glob Grep mcp__plugin_lokal_lokal',
    '--max-budget-usd', String(args.budget ?? 3),
  ];
  if (args.model) cliArgs.push('--model', args.model);
  if (variant === 'lokal') cliArgs.push('--plugin-dir', pluginDir);

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('claude', cliArgs, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(testCase.prompt);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      const toolUses = [];
      const seen = [];
      let result = {};
      for (const line of out.split('\n')) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        for (const block of ev.message?.content ?? []) {
          if (ev.type === 'assistant' && block.type === 'tool_use') toolUses.push({ name: block.name, input: block.input });
          if (ev.type === 'user' && block.type === 'tool_result') seen.push(contentText(block.content));
        }
        if (ev.type === 'result') result = ev;
      }
      resolve({
        cwd, code, stderr: err.slice(-2000), seconds: Math.round((Date.now() - started) / 1000),
        text: result.result ?? '', cost: result.total_cost_usd, turns: result.num_turns,
        toolUses, seen: seen.join('\n'), files: readTextFiles(cwd),
      });
    });
  });
}

async function pool(jobs, size) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]();
      }
    }),
  );
  return results;
}

const pluginDir = variants.includes('lokal') ? stagePlugin() : '';
mkdirSync(path.join(REPO, 'evals', 'results'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
// Each run is appended as soon as it finishes, so an interrupted eval keeps what it measured.
const partialFile = path.join(REPO, 'evals', 'results', `${stamp}.partial.jsonl`);
const jobs = Array.from({ length: repeat }).flatMap((_, rep) => selected.flatMap((c) =>
  variants.map((v) => async () => {
    process.stderr.write(`▶ ${c.id} [${v}] #${rep + 1}\n`);
    const run = await runClaude(c, v, pluginDir);
    const checks = Object.fromEntries(
      Object.entries(c.checks).map(([name, check]) => {
        try {
          return [name, Boolean(check(run))];
        } catch {
          return [name, false];
        }
      }),
    );
    process.stderr.write(`■ ${c.id} [${v}] ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length} in ${run.seconds}s\n`);
    const record = { case: c.id, variant: v, rep: rep + 1, checks, ...run };
    appendFileSync(partialFile, `${JSON.stringify({ ...record, files: Object.keys(run.files) })}\n`);
    return record;
  }),
));
const results = await pool(jobs, concurrency);

const outFile = path.join(REPO, 'evals', 'results', `${stamp}.json`);
writeFileSync(
  outFile,
  JSON.stringify(
    results.map(({ files, ...r }) => ({ ...r, files: Object.keys(files) })),
    null,
    2,
  ),
);

let md = '| Case | Check | ' + variants.join(' | ') + ' |\n|---|---|' + variants.map(() => '---').join('|') + '|\n';
for (const c of selected) {
  for (const name of Object.keys(c.checks)) {
    const cells = variants.map((v) => {
      const runs = results.filter((r) => r.case === c.id && r.variant === v);
      const passed = runs.filter((r) => r.checks[name]).length;
      return repeat === 1 ? (passed ? '✅' : '❌') : `${passed}/${runs.length}`;
    });
    md += `| ${c.id} | ${name} | ${cells.join(' | ')} |\n`;
  }
}
const totals = variants.map((v) => {
  const rs = results.filter((r) => r.variant === v);
  const passed = rs.reduce((n, r) => n + Object.values(r.checks).filter(Boolean).length, 0);
  const total = rs.reduce((n, r) => n + Object.keys(r.checks).length, 0);
  return `${v}: ${passed}/${total}`;
});
console.log(md);
console.log(totals.join('   '));
console.log(`\nDetails: ${path.relative(REPO, outFile)}`);
