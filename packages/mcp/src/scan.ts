// `lokal-mcp scan`: finds Indonesian personal data in files before they are committed, for pre-commit hooks and CI.
// With --staged or --diff it checks only the lines a commit or pull request adds, so a repository that already holds
// fixtures can adopt it without cleaning up first. Findings show partially masked values only: CI logs are often
// public.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { detectPii, partialMask, PII_TYPES, UU_PDP_CATEGORY, type PiiType } from '@lokal-id/core';
import { loadBuffer, loadDocument, loadIgnore, toPosix, walkFiles, type Document } from './files.ts';

/** A line containing this is never reported, like `// samaran-ignore` after a made-up NIK in a test. */
export const IGNORE_MARKER = 'samaran-ignore';

export interface Finding {
  file: string;
  /** Line in a text file; absent for spreadsheets, Word documents, and PDFs, which name the `sheet` instead. */
  line?: number;
  sheet?: string;
  type: PiiType;
  uuPdp: 'umum' | 'spesifik';
  confidence: 'high' | 'medium';
  preview: string;
}

export interface ScanReport {
  filesScanned: number;
  filesIgnored: number;
  findings: Finding[];
  /** Files that may hold personal data but could not be read: encrypted PDFs, .xls, archives, … */
  notScanned: Array<{ file: string; reason: string }>;
}

/** A file to check, and which of its lines count: `all`, or the lines a change adds. */
export interface Target {
  file: string;
  load: () => Document;
  lines: 'all' | Set<number>;
}

export interface ScanOptions {
  types?: PiiType[];
  minConfidence?: 'high' | 'medium';
  isIgnored?: (file: string) => boolean;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export function scanTargets(targets: Target[], options: ScanOptions = {}): ScanReport {
  const report: ScanReport = { filesScanned: 0, filesIgnored: 0, findings: [], notScanned: [] };
  for (const target of targets) {
    if (options.isIgnored?.(target.file)) {
      report.filesIgnored++;
      continue;
    }
    if (target.lines !== 'all' && !target.lines.size) continue;
    let doc: Document;
    try {
      doc = target.load();
    } catch (e) {
      report.notScanned.push({ file: target.file, reason: `unreadable: ${(e as Error).message}` });
      continue;
    }
    if (doc.kind === 'skipped') {
      if (doc.dataBearing && !doc.reason.startsWith('image')) report.notScanned.push({ file: target.file, reason: doc.reason });
      continue;
    }
    report.filesScanned++;
    const detect = { types: options.types, minConfidence: options.minConfidence ?? 'high' } as const;
    if (doc.kind === 'text') {
      const starts = lineStarts(doc.text);
      for (const m of detectPii(doc.text, detect)) {
        const line = lineAt(starts, m.start);
        if (target.lines !== 'all' && !target.lines.has(line)) continue;
        const end = starts[line] ?? doc.text.length;
        if (doc.text.slice(starts[line - 1], end).includes(IGNORE_MARKER)) continue;
        report.findings.push({ file: target.file, line, type: m.type, uuPdp: UU_PDP_CATEGORY[m.type], confidence: m.confidence, preview: partialMask(m.type, m.value) });
      }
    } else {
      if (doc.unscanned) report.notScanned.push({ file: target.file, reason: `partly scanned: ${doc.unscanned}` });
      for (const sheet of doc.sheets) {
        for (const m of detectPii(sheet.csv, detect)) {
          report.findings.push({ file: target.file, sheet: sheet.name, type: m.type, uuPdp: UU_PDP_CATEGORY[m.type], confidence: m.confidence, preview: partialMask(m.type, m.value) });
        }
      }
    }
  }
  return report;
}

// --- git -------------------------------------------------------------------------------------------------------

function git(cwd: string, args: string[]): Buffer {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Undoes git's C-style quoting of unusual paths: "a\tb.csv", "caf\303\251.csv". */
export function unquoteGitPath(p: string): string {
  if (!p.startsWith('"')) return p;
  const bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  for (let i = 1; i < p.length - 1; i++) {
    const c = p[i]!;
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const next = p[i + 1]!;
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(p.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The lines each file gains in a `git diff -U0` patch. */
export function addedLines(patch: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let current: Set<number> | undefined;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).replace(/\t$/, '');
      if (name === '/dev/null') {
        current = undefined;
        continue;
      }
      const file = unquoteGitPath(name).replace(/^b\//, '');
      current = out.get(file) ?? new Set();
      out.set(file, current);
    } else if (line.startsWith('@@') && current) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      for (let i = 0; i < count; i++) current.add(start + i);
    }
  }
  return out;
}

/** Changed files from `git diff --numstat -z`: binary files (counts shown as "-") are checked whole. */
function changedFiles(numstat: string): Array<{ file: string; binary: boolean }> {
  const out: Array<{ file: string; binary: boolean }> = [];
  const parts = numstat.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]!);
    if (!m) continue;
    // A rename is "added<TAB>deleted<TAB>" followed by the old and new paths.
    let file = m[3]!;
    if (!file) {
      file = parts[i + 2] ?? '';
      i += 2;
    }
    if (file) out.push({ file, binary: m[1] === '-' });
  }
  return out;
}

export function gitTargets(root: string, mode: { staged: true } | { base: string }): Target[] {
  const range = 'staged' in mode ? ['--cached'] : [mode.base];
  const common = ['diff', ...range, '--no-color', '--no-ext-diff', '--no-textconv', '--diff-filter=ACMR'];
  const files = changedFiles(git(root, [...common, '--numstat', '-z']).toString('utf8'));
  const added = addedLines(git(root, [...common, '-U0']).toString('utf8'));
  return files.map(({ file, binary }) => ({
    file,
    lines: binary ? 'all' : (added.get(file) ?? new Set<number>()),
    load: () => ('staged' in mode ? loadBuffer(file, git(root, ['show', `:${file}`])) : loadDocument(path.join(root, file))),
  }));
}

/**
 * Files under `inputs`. Inside a git repository these are the files git tracks or would add, so whatever .gitignore
 * leaves out (build output, caches, local data) is skipped too.
 */
export function pathTargets(root: string | undefined, inputs: string[]): Target[] {
  const cwd = process.cwd();
  for (const input of inputs) if (!existsSync(path.resolve(input))) throw new Error(`Not found: ${input}`);
  if (root) {
    const listed = git(cwd, ['ls-files', '-z', '--full-name', '--cached', '--others', '--exclude-standard', '--', ...inputs]);
    return [...new Set(listed.toString('utf8').split('\0').filter(Boolean))]
      .filter((file) => existsSync(path.join(root, file)))
      .map((file) => ({ file, lines: 'all' as const, load: () => loadDocument(path.join(root, file)) }));
  }
  const targets: Target[] = [];
  for (const input of inputs) {
    const abs = path.resolve(input);
    const files = statSync(abs).isDirectory() ? walkFiles(abs, Number.POSITIVE_INFINITY) : [abs];
    for (const file of files) targets.push({ file: toPosix(path.relative(cwd, file)), lines: 'all', load: () => loadDocument(file) });
  }
  return targets;
}

// --- output ----------------------------------------------------------------------------------------------------

const where = (f: Finding) => (f.line ? `${f.file}:${f.line}` : f.sheet ? `${f.file} (${f.sheet})` : f.file);

const ADVICE = [
  'Replace real data with made-up data (lokal-mcp kembaran makes realistic stand-ins).',
  `Files that only hold made-up data can be listed in .samaranignore; a single line can be skipped with a "${IGNORE_MARKER}" comment.`,
];

const PER_FILE = 10;

export function formatText(report: ScanReport): string {
  const out: string[] = [];
  const byFile = new Map<string, Finding[]>();
  for (const f of report.findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  for (const findings of byFile.values()) {
    for (const f of findings.slice(0, PER_FILE)) out.push(`${where(f)}: ${f.type} ${f.preview}${f.uuPdp === 'spesifik' ? ' (UU PDP: spesifik)' : ''}`);
    if (findings.length > PER_FILE) out.push(`${findings[0]!.file}: … and ${findings.length - PER_FILE} more`);
  }
  for (const s of report.notScanned) out.push(`warning: ${s.file} was not scanned (${s.reason})`);
  if (report.findings.length) {
    out.push('', `Found ${report.findings.length} personal data value(s) in ${byFile.size} file(s).`, ...ADVICE);
  } else {
    out.push(`No personal data found in ${report.filesScanned} file(s).`);
  }
  return `${out.join('\n')}\n`;
}

const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** Workflow commands that GitHub shows as annotations on the pull request's changed lines. */
export function formatGithub(report: ScanReport): string {
  const out: string[] = [];
  for (const f of report.findings.slice(0, 500)) {
    const props = [`file=${escapeProperty(f.file)}`, f.line ? `line=${f.line}` : '', `title=${escapeProperty(`Personal data: ${f.type}`)}`].filter(Boolean).join(',');
    out.push(`::error ${props}::${escapeData(`${f.type} ${f.preview}${f.sheet ? ` in ${f.sheet}` : ''}. ${ADVICE[0]}`)}`);
  }
  for (const s of report.notScanned) out.push(`::warning file=${escapeProperty(s.file)},title=Not scanned::${escapeData(s.reason)}`);
  return `${out.join('\n')}${out.length ? '\n' : ''}${formatText(report)}`;
}

export function formatSummary(report: ScanReport): string {
  if (!report.findings.length && !report.notScanned.length) {
    return `### Lokal scan\n\nNo personal data found in ${report.filesScanned} file(s).\n`;
  }
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const rows = report.findings.slice(0, 200).map((f) => `| \`${cell(where(f))}\` | ${f.type} | \`${cell(f.preview)}\` | ${f.uuPdp} |`);
  const lines = [
    '### Lokal scan',
    '',
    report.findings.length ? `Found **${report.findings.length}** personal data value(s).` : 'No personal data found.',
    '',
  ];
  if (rows.length) lines.push('| Location | Type | Value (masked) | UU PDP |', '|---|---|---|---|', ...rows, '');
  if (report.findings.length > rows.length) lines.push(`… and ${report.findings.length - rows.length} more.`, '');
  if (report.notScanned.length) lines.push('**Not scanned:**', '', ...report.notScanned.map((s) => `- \`${s.file}\`: ${s.reason}`), '');
  if (report.findings.length) lines.push(...ADVICE.map((a) => `- ${a}`), '');
  return lines.join('\n');
}

// --- command ---------------------------------------------------------------------------------------------------

const USAGE = `Usage: lokal-mcp scan [path...] [options]

Finds Indonesian personal data (NIK, KK, NPWP, phone numbers, bank accounts, names, health data, …) in files, so it
is not committed. Exits with 1 when it finds some. Values are shown partially masked.

  --staged                 Check only the lines staged for commit (pre-commit hook)
  --diff <ref>             Check only the lines added since <ref> (pull requests)
  --min-confidence <level> high (default) or medium
  --types <types>          Only these types, e.g. NIK,PHONE,BANK_ACCOUNT
  --format <format>        text (default), github (annotations), or json
  --strict                 Also fail when files that may hold personal data could not be read
  --no-fail                Report, but exit with 0

Files listed in .samaranignore at the repository root are skipped, and so is any line containing "${IGNORE_MARKER}".`;

function gitRoot(cwd: string): string | undefined {
  try {
    return git(cwd, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  } catch {
    return undefined;
  }
}

export function runScan(args: string[]): void {
  const valued = new Set(['--diff', '--min-confidence', '--types', '--format']);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const usage = (message: string) => {
    process.stderr.write(`${message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  };
  const format = opt('--format') ?? 'text';
  const minConfidence = opt('--min-confidence') ?? 'high';
  const types = (opt('--types') ?? '').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  const unknown = types.filter((t) => !PII_TYPES.includes(t as PiiType));
  if (!['text', 'github', 'json'].includes(format)) return usage(`Unknown format: ${format}`);
  if (minConfidence !== 'high' && minConfidence !== 'medium') return usage(`--min-confidence must be high or medium`);
  if (unknown.length) return usage(`Unknown PII type ${unknown.join(', ')}. Valid types: ${PII_TYPES.join(', ')}`);
  const inputs = args.filter((a, i) => !a.startsWith('-') && !valued.has(args[i - 1] ?? ''));
  const base = opt('--diff');
  const staged = args.includes('--staged');
  if ((staged || base) && inputs.length) return usage('Paths cannot be combined with --staged or --diff.');

  const root = gitRoot(process.cwd());
  let targets: Target[];
  try {
    if (staged || base) {
      if (!root) return usage('--staged and --diff need a git repository.');
      targets = gitTargets(root, staged ? { staged: true } : { base: base! });
    } else {
      targets = pathTargets(root, inputs.length ? inputs : ['.']);
    }
  } catch (e) {
    const err = e as Error & { stderr?: Buffer };
    process.stderr.write(`${err.stderr?.toString('utf8').trim() || err.message}\n`);
    process.exitCode = 2;
    return;
  }

  const ignoreRoot = root ?? process.cwd();
  const isIgnoredAbs = loadIgnore(ignoreRoot);
  const report = scanTargets(targets, {
    types: types.length ? (types as PiiType[]) : undefined,
    minConfidence,
    isIgnored: (file) => isIgnoredAbs(path.resolve(ignoreRoot, file)),
  });

  if (format === 'json') process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(format === 'github' ? formatGithub(report) : formatText(report));
  if (format === 'github' && process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatSummary(report));
    } catch {
      // The summary is a convenience; the annotations and exit code carry the result.
    }
  }
  const failed = report.findings.length > 0 || (args.includes('--strict') && report.notScanned.length > 0);
  if (failed && !args.includes('--no-fail')) process.exitCode = 1;
}
