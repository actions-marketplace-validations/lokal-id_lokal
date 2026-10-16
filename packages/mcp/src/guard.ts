// Claude Code hook: stops Indonesian personal data from reaching the model.
//
// - UserPromptSubmit: blocks a prompt that contains identity numbers (NIK, KK, NPWP, passport, SIM,
//   NIP, bank account, BPJS, card) or labeled health, criminal-record or biometric data.
//   Add "#izinkan-pii" to the prompt to send it anyway.
// - PreToolUse: blocks a tool call that would put a data file (CSV, JSON, logs, SQL dumps …) full of
//   personal data into the conversation, and points Claude to read_file_masked:
//     Read                 the file itself
//     Grep (content mode)  the lines that match, in data files under the search path
//     Bash / PowerShell    `cat`, `head`, `grep`, `Get-Content`, `Import-Csv` … printing a data file
//   Source code is never blocked: example numbers in code are normal, and agents must be able to read
//   it. Running a script on a data file is allowed: that is how data gets processed without being
//   shown. Files in .samaranignore are allowed.
//
// Exit code 2 blocks; stderr is shown to the user (prompts) or to Claude (tool calls).
// Anything unexpected exits 0: a broken guard must never break the session.
import { statSync } from 'node:fs';
import path from 'node:path';
import { detectPii, partialMask, type PiiMatch, type PiiType } from '@lokal-id/core';
import { GUARD_MAX_ZIP_BYTES, GUARD_SAMPLE_BYTES, globToRegExp, loadDocument, loadIgnore, walkFiles } from './files.ts';
import { dataReadsInCommand, SHELL_DATA_FILE } from './shell-reads.ts';

// One of these is enough to hold a prompt or a file back: identity numbers, and labeled sensitive data.
const STRICT: PiiType[] = [
  'NIK', 'KK', 'NPWP', 'PASSPORT', 'SIM', 'NIP', 'BANK_ACCOUNT', 'BPJS', 'CARD', 'HEALTH', 'CRIMINAL_RECORD',
  'BIOMETRIC',
];
// Common on their own (a support email, a sample phone number); a file with several is a data export.
const BULK_THRESHOLD = 3;
const BYPASS = /#izinkan-pii\b/i;
const DATA_FILE = /\.(csv|tsv|json|jsonl|ndjson|log|txt|sql|xml|ya?ml|dump|bak|out|xlsx|xlsm)(\.\d+)?$/i;
const GREP_MAX_FILES = 300;
// Grep's `type` filter, for the types that are data formats.
const GREP_TYPES: Record<string, RegExp> = {
  csv: /\.csv$/i, tsv: /\.tsv$/i, json: /\.(json|jsonl|ndjson)$/i, jsonl: /\.jsonl$/i, yaml: /\.ya?ml$/i,
  xml: /\.xml$/i, sql: /\.sql$/i, txt: /\.txt$/i, log: /\.log$/i,
};

interface HookInput {
  hook_event_name?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    command?: string;
    pattern?: string;
    path?: string;
    glob?: string;
    type?: string;
    output_mode?: string;
    '-i'?: boolean;
    '-A'?: number;
    '-B'?: number;
    '-C'?: number;
    context?: number;
  };
  cwd?: string;
}

function summarize(matches: PiiMatch[], examples = true): string {
  const counts = new Map<PiiType, number>();
  for (const m of matches) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
  return [...counts.entries()]
    .map(([type, n]) => {
      const sample = examples ? ` (${partialMask(type, matches.find((m) => m.type === type)!.value)})` : '';
      return `${type}×${n}${sample}`;
    })
    .join(', ');
}

function fileTexts(file: string): string[] | undefined {
  try {
    // A big export is checked from its first rows instead of being skipped: skipping once let a 6 MB CSV through.
    const doc = loadDocument(file, { sampleBytes: GUARD_SAMPLE_BYTES, maxZipBytes: GUARD_MAX_ZIP_BYTES });
    if (doc.kind === 'skipped') return undefined;
    return doc.kind === 'text' ? [doc.text] : doc.sheets.map((s) => s.csv);
  } catch {
    return undefined;
  }
}

/** The part of a CSV the model would see, plus its header row so columns like "nama" still count. */
function withHeader(full: string, shown: string, file: string): string {
  if (!/\.(csv|tsv)$/i.test(file)) return shown;
  const header = full.slice(0, full.indexOf('\n') + 1 || full.length).replace(/\r?\n$/, '');
  return shown.startsWith(header) ? shown : `${header}\n${shown}`;
}

/** Personal data worth blocking for, or undefined. */
function verdict(texts: string[]): PiiMatch[] | undefined {
  return verdictOf(texts.flatMap((t) => detectPii(t, { minConfidence: 'high' })));
}

function verdictOf(found: PiiMatch[]): PiiMatch[] | undefined {
  const strict = found.some((m) => STRICT.includes(m.type));
  return strict || found.length >= BULK_THRESHOLD ? found : undefined;
}

/**
 * Personal data in the part of a file a command prints. Detection runs on the whole file, where headers
 * and labels give context (`cut -d, -f2` prints a bare column of names), and counts what reaches the output.
 */
function shownPii(full: string, shown: string, file: string): PiiMatch[] {
  const all = detectPii(full, { minConfidence: 'high' });
  let inFile: PiiMatch[];
  if (shown.length >= full.length) {
    inFile = all; // `cat`: everything is shown
  } else if (shown.length <= 100_000) {
    inFile = all.filter((m) => shown.includes(m.value));
  } else {
    // A large partial output (`cut`, `grep` on a big export): look values up by field. Searching the whole output
    // once per match was quadratic and could run past the hook's 10 s, which lets the command through.
    const fields = new Set(shown.split(/[\t\n\r,;|]+/).map((f) => f.trim().replace(/^"|"$/g, '')));
    inFile = all.filter((m) => fields.has(m.value));
  }
  const direct = detectPii(withHeader(full, shown, file), { minConfidence: 'high' });
  return inFile.length >= direct.length ? inFile : direct;
}

const PROCESS_HINT =
  'To process the data, run a script that reads the file and writes its results to a file (or prints only counts), or use `write_file_unmasked`.';

function readTool(file: string, shownAs: string, ignored: (f: string) => boolean): string | undefined {
  if (!DATA_FILE.test(file) || ignored(file)) return undefined;
  const texts = fileTexts(file);
  const found = texts && verdict(texts);
  if (!found) return undefined;
  return [
    `Samaran blocked reading ${shownAs}: it contains personal data (${summarize(found, false)}).`,
    'Use the `read_file_masked` tool from the lokal MCP server instead: same content, with personal data replaced by stable placeholders.',
    'Write results that need the real values with `write_file_unmasked`.',
    'If the user confirms the file only holds fake data, they can add it to .samaranignore.',
  ].join(' ');
}

function shellTool(command: string, cwd: string, powershell: boolean, ignored: (f: string) => boolean): string | undefined {
  const reads = dataReadsInCommand(command, cwd, powershell).filter((r) => !ignored(r.file));
  const matches: PiiMatch[] = [];
  const files = new Set<string>();
  for (const r of reads) {
    for (const full of fileTexts(r.file) ?? []) {
      const shown = r.select(full);
      if (!shown.trim()) continue;
      const here = shownPii(full, shown, r.file);
      for (const m of here) matches.push(m);
      if (verdictOf(here)) files.add(r.file);
    }
  }
  const found = verdictOf(matches);
  if (!found) return undefined;
  const names = [...(files.size ? files : new Set(reads.map((r) => r.file)))].map((f) => path.relative(cwd, f) || f);
  return [
    `Samaran blocked this command: it would print personal data from ${names.join(', ')} into the conversation (${summarize(found, false)}).`,
    'To look at the data, use the `read_file_masked` tool from the lokal MCP server (personal data replaced by stable placeholders).',
    PROCESS_HINT,
    'If the user confirms the file only holds fake data, they can add it to .samaranignore.',
  ].join(' ');
}

function grepTool(input: NonNullable<HookInput['tool_input']>, cwd: string, ignored: (f: string) => boolean): string | undefined {
  if (input.output_mode !== 'content' || !input.pattern) return undefined; // file names and counts are fine
  const target = path.resolve(cwd, input.path ?? '.');
  let candidates: string[];
  try {
    candidates = statSync(target).isDirectory() ? [...walkFiles(target)] : [target];
  } catch {
    return undefined;
  }
  const glob = input.glob ? globToRegExp(input.glob.includes('/') ? input.glob : `**/${input.glob}`) : undefined;
  const typeFilter = input.type ? GREP_TYPES[input.type.toLowerCase()] : undefined;
  if (input.type && !typeFilter) return undefined; // `type: "ts"` searches code
  candidates = candidates
    .filter((f) => SHELL_DATA_FILE.test(f) && !ignored(f))
    .filter((f) => !glob || glob.test(path.relative(target, f).split(path.sep).join('/')) || glob.test(path.basename(f)))
    .filter((f) => !typeFilter || typeFilter.test(f))
    .slice(0, GREP_MAX_FILES);

  let re: RegExp | undefined;
  try {
    re = new RegExp(input.pattern, input['-i'] ? 'i' : '');
  } catch {
    re = undefined; // a ripgrep-only pattern: assume any line can match
  }
  const after = input['-A'] ?? input['-C'] ?? input.context ?? 0;
  const beforeN = input['-B'] ?? input['-C'] ?? input.context ?? 0;
  const matches: PiiMatch[] = [];
  const files: string[] = [];
  for (const file of candidates) {
    for (const full of fileTexts(file) ?? []) {
      const lines = full.split('\n');
      const keep = new Set<number>();
      lines.forEach((line, i) => {
        if (re && !re.test(line)) return;
        for (let j = Math.max(0, i - beforeN); j <= Math.min(lines.length - 1, i + after); j++) keep.add(j);
      });
      if (!keep.size) continue;
      const shown = [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n');
      const here = shownPii(full, shown, file);
      for (const m of here) matches.push(m);
      if (verdictOf(here)) files.push(file);
    }
  }
  const found = verdictOf(matches);
  if (!found) return undefined;
  const names = (files.length ? files : candidates).slice(0, 5).map((f) => path.relative(cwd, f) || f);
  return [
    `Samaran blocked this search: the matching lines in ${names.join(', ')} contain personal data (${summarize(found, false)}).`,
    'Search with output_mode "files_with_matches" or "count", or read the file with `read_file_masked` from the lokal MCP server.',
    'Add a glob or type that leaves data files out if you meant to search code.',
  ].join(' ');
}

/** Returns the message to block with, or undefined to allow. */
export function evaluate(input: HookInput): string | undefined {
  if (process.env.SAMARAN_GUARD === 'off') return undefined;

  if (input.hook_event_name === 'UserPromptSubmit' && input.prompt) {
    if (BYPASS.test(input.prompt)) return undefined;
    const found = detectPii(input.prompt, { types: STRICT, minConfidence: 'high' });
    if (!found.length) return undefined;
    return [
      `🛡️  Samaran menahan prompt ini: ada data pribadi ${summarize(found)}.`,
      'Prompt akan terkirim ke server model AI. Ganti dengan data contoh atau samarkan dulu,',
      'atau kirim ulang dengan menambahkan #izinkan-pii jika memang disengaja.',
    ].join('\n');
  }

  if (input.hook_event_name !== 'PreToolUse' || !input.tool_input) return undefined;
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const cwd = input.cwd ?? root;
  const ignored = loadIgnore(root);
  const tool = input.tool_input;
  switch (input.tool_name) {
    case 'Read':
      return tool.file_path ? readTool(path.resolve(root, tool.file_path), tool.file_path, ignored) : undefined;
    case 'Grep':
      return grepTool(tool, cwd, ignored);
    case 'Bash':
      return tool.command ? shellTool(tool.command, cwd, false, ignored) : undefined;
    case 'PowerShell':
      return tool.command ? shellTool(tool.command, cwd, true, ignored) : undefined;
    default:
      return undefined;
  }
}

export async function runGuard(): Promise<void> {
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const message = evaluate(JSON.parse(raw) as HookInput);
    if (message) {
      process.stderr.write(`${message}\n`);
      process.exitCode = 2;
    }
  } catch (e) {
    process.stderr.write(`samaran-guard: ${(e as Error).message}\n`);
  }
}

// When bundled into hooks/samaran-guard.mjs, this file is the entry point.
if (process.argv[1] && /samaran-guard\.m?js$/.test(process.argv[1])) {
  await runGuard();
}
