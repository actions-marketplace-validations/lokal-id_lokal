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
// - PreToolUse, Read of what Samaran cannot check: asks the user first. That is a photo filed or named
//   like someone's document (ktp/, selfie_budi.jpg, media/uploads/…; not the app's own assets), a
//   PDF that is scanned, encrypted, damaged, or read only in part, and lines past the part of a big file it read.
//
// Exit code 2 blocks; stderr is shown to the user (prompts) or to Claude (tool calls). Asking prints
// a permissionDecision of "ask" on stdout, whose reason Claude Code shows in its permission prompt.
// Anything unexpected exits 0: a broken guard must never break the session. SAMARAN_GUARD=strict blocks instead,
// and blocks whatever the guard could not check: a file it cannot read, the part of a big file past what it read,
// more files than a search checks, and a check that runs too long.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { partialMask, PII_TYPES, type PiiMatch, type PiiType } from '@lokal-id/core';
import {
  detectConfigured, GUARD_MAX_ZIP_BYTES, GUARD_SAMPLE_BYTES, globToRegExp, loadConfig, loadDocument, loadIgnore, policyFor,
  walkFiles, type Document, type SamaranConfig,
} from './files.ts';
import { countMatches, writeAudit } from './audit.ts';
import { dataReadsInCommand, inlineCodeReads, SHELL_DATA_FILE } from './shell-reads.ts';

// One of these is enough to hold a prompt or a file back: identity numbers, and labeled sensitive data.
const STRICT: PiiType[] = [
  'NIK', 'KK', 'NPWP', 'PASSPORT', 'SIM', 'NIP', 'NISN', 'AKTA', 'BANK_ACCOUNT', 'BPJS', 'CARD', 'HEALTH',
  'CRIMINAL_RECORD', 'BIOMETRIC',
  // A team's own rules in .samaran.json: they wrote them because those values must not leave.
  'CUSTOM',
];
// Common on their own (a support email, a sample phone number); a file with several is a data export.
const BULK_THRESHOLD = 3;
const BYPASS = /#izinkan-pii\b/i;
// Claude Code's Read sends a PDF to the model as is, pages and all.
const DATA_FILE = /\.(csv|tsv|json|jsonl|ndjson|log|txt|sql|xml|ya?ml|dump|bak|out|xlsx|xlsm|docx|pdf)(\.\d+)?$/i;
const GREP_MAX_FILES = 300;
// Claude Code's Read shows this many lines when no limit is given.
const READ_LINES = 2000;
// The hook is stopped after 10 s, and a stopped hook lets the call through: strict mode blocks well before that.
const STRICT_BUDGET_MS = 7000;
// Read sends images to the model too, and nothing in them can be checked without OCR.
const IMAGE_FILE = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i;
// Words in a path that point at someone's documents: the kind of document, or whose it is.
const PERSONAL_PATH =
  /(?:^|[^a-z])(?:e?ktp|kk|kartu[ _-]?keluarga|npwp|sim|paspor|passport|selfie|swafoto|identitas|identity|id[ _-]?card|akta|ijazah|slip[ _-]?gaji|rekening|tabungan|bpjs|kyc|verifikasi|verification|pelanggan|customers?|nasabah|pasien|patients?|karyawan|employees?|pegawai|pemohon|applicants?|debitur|peserta|siswa|students?)(?:[^a-z]|$)/i;
// Folders where an app keeps what users upload.
const UPLOAD_PATH = /(?:^|[\\/])(?:media|uploads?|storage|attachments?|lampiran|berkas|dokumen|documents?|scans?|private|var)(?:[\\/]|$)/i;
// Folders of the app's own images: logos, icons, screenshots.
const ASSET_PATH = /(?:^|[\\/])(?:assets?|icons?|images?|img|static|fonts?|docs?|screenshots?|\.github|design|branding|logos?)(?:[\\/]|$)/i;
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
    offset?: number;
    limit?: number;
    '-i'?: boolean;
    '-A'?: number;
    '-B'?: number;
    '-C'?: number;
    context?: number;
  };
  cwd?: string;
}

function summarize(matches: PiiMatch[], examples = true): string {
  // Custom matches are counted under their own label: EMPLOYEE_ID×2.
  const name = (m: PiiMatch) => m.label ?? m.type;
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(name(m), (counts.get(name(m)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, n]) => {
      const first = matches.find((m) => name(m) === label)!;
      const sample = examples ? ` (${partialMask(first.type, first.value)})` : '';
      return `${label}×${n}${sample}`;
    })
    .join(', ');
}

/**
 * A data file's text for the shell and Grep checks. `unchecked` says why some or all of it could not be checked;
 * `sampled` that only the first part was read.
 */
function fileTexts(file: string): { texts: string[]; sampled?: boolean; unchecked?: string } {
  let doc: Document;
  try {
    // A big export is checked from its first rows instead of being skipped: skipping once let a 6 MB CSV through.
    doc = loadDocument(file, { sampleBytes: GUARD_SAMPLE_BYTES, maxZipBytes: GUARD_MAX_ZIP_BYTES });
  } catch (e) {
    // A missing file fails the command on its own; one that exists but will not load would be printed unchecked.
    return { texts: [], unchecked: existsSync(file) ? `could not be read: ${(e as Error).message}` : undefined };
  }
  if (doc.kind === 'skipped') return { texts: [], unchecked: doc.dataBearing ? doc.reason : undefined };
  if (doc.kind === 'text') return { texts: [doc.text], sampled: doc.sampled };
  return { texts: doc.sheets.map((s) => s.csv), unchecked: doc.unscanned };
}

/**
 * Whether a command's output from a file depends only on the part the guard read: with more lines after that part
 * (the part again, or one new line), it prints the same. `head -n 20` and `grep -m 1` with a hit do; `cat`, `tail`,
 * and a plain `grep` may print the rest.
 */
function withinSample(select: (text: string) => string, sample: string, shown: string): boolean {
  if (!shown.trim()) return false;
  const first = sample.slice(0, sample.indexOf('\n') + 1 || sample.length).trimEnd();
  return select(`${sample}\n${sample}`) === shown && select(`${sample}\n${first}~`) === shown;
}

/** The part of a CSV the model would see, plus its header row so columns like "nama" still count. */
function withHeader(full: string, shown: string, file: string): string {
  if (!/\.(csv|tsv)$/i.test(file)) return shown;
  const header = full.slice(0, full.indexOf('\n') + 1 || full.length).replace(/\r?\n$/, '');
  return shown.startsWith(header) ? shown : `${header}\n${shown}`;
}

/** Personal data worth blocking for, or undefined. */
function verdict(texts: string[]): PiiMatch[] | undefined {
  return verdictOf(texts.flatMap((t) => detectConfigured(t, { minConfidence: 'high' }, config)));
}

function verdictOf(found: PiiMatch[]): PiiMatch[] | undefined {
  // What the project's policy blocks or keeps local is held back like an identity number: one is enough.
  const strict = found.some((m) => STRICT.includes(m.type) || ['block', 'route'].includes(policyFor(config, m)));
  return strict || found.length >= BULK_THRESHOLD ? found : undefined;
}

/**
 * Personal data in the part of a file a command prints. Detection runs on the whole file, where headers
 * and labels give context (`cut -d, -f2` prints a bare column of names), and counts what reaches the output.
 */
function shownPii(full: string, shown: string, file: string): PiiMatch[] {
  const all = detectConfigured(full, { minConfidence: 'high' }, config);
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
  const direct = detectConfigured(withHeader(full, shown, file), { minConfidence: 'high' }, config);
  return inFile.length >= direct.length ? inFile : direct;
}

const PROCESS_HINT =
  'To process the data, run a script that reads the file and writes its results to a file (or prints only counts), or use `write_file_unmasked`.';

/**
 * SAMARAN_GUARD=strict, for teams that want the guard to fail closed: an error in the guard blocks instead of allowing,
 * and code run from the command line (python -c, node -e, a heredoc fed to python) that names a data file with
 * personal data is blocked like `cat`. It narrows what gets through; it is still not a sandbox.
 */
export const strictMode = () => process.env.SAMARAN_GUARD === 'strict' || (!process.env.SAMARAN_GUARD && config.guard === 'strict');
/** Where strict mode came from, for the message. */
const strictBy = () => (process.env.SAMARAN_GUARD === 'strict' ? 'SAMARAN_GUARD=strict' : '"guard": "strict" in .samaran.json');

/** The project's .samaran.json, loaded by `evaluate`. */
let config: SamaranConfig = { custom: [], allow: [] };
/** When strict mode stops checking, set by `evaluate`. */
let deadline = Infinity;
const outOfTime = () => strictMode() && Date.now() > deadline;

/** What the guard does with a prompt or tool call: block it (the message goes to Claude), or ask the user. */
export type Verdict = { action: 'block' | 'ask'; message: string; counts?: Record<string, number> };
const block = (message: string, found?: PiiMatch[]): Verdict => ({ action: 'block', message, ...(found ? { counts: countMatches(found) } : {}) });

/** Strict mode's answer to a tool call the guard could not check in full. */
function uncheckedBlock(what: string, why: string[]): Verdict {
  return block([
    `Samaran blocked ${what}: ${why.join('; ')}, so it could not be checked for personal data, and ${strictBy()} blocks what it cannot check.`,
    'Use the `read_file_masked` tool from the lokal MCP server, or narrow the command to what you need (`head -n 50`).',
    'If the user confirms the file holds no real personal data, they can add it to .samaranignore.',
  ].join(' '));
}

/** Asks before Read sends what Samaran cannot check, in the user's language: the user answers the prompt. */
function ask(shownAs: string, what: string): Verdict {
  return {
    action: 'ask',
    message: [
      `🛡️  Samaran: ${shownAs} ${what}, jadi isinya tidak bisa diperiksa dan akan dikirim ke model AI apa adanya.`,
      'Izinkan hanya jika berkas ini tidak berisi data pribadi asli (KTP, selfie, formulir pelanggan).',
      'Berkas contoh bisa dimasukkan ke .samaranignore supaya tidak ditanyakan lagi.',
    ].join(' '),
  };
}

/** An image that is probably someone's document: named or filed as one, and not among the app's own images. */
function personalImage(file: string, root: string): boolean {
  const rel = path.relative(root, file);
  const where = rel.startsWith('..') || path.isAbsolute(rel) ? file : rel;
  return PERSONAL_PATH.test(where) || (UPLOAD_PATH.test(path.dirname(where)) && !ASSET_PATH.test(path.dirname(where)));
}

/** What Read would send unchecked: the user is asked, and strict mode blocks. */
function uncheckedRead(shownAs: string, what: string, why: string): Verdict {
  return strictMode() ? uncheckedBlock(`reading ${shownAs}`, [why]) : ask(shownAs, what);
}

function readTool(
  file: string, shownAs: string, root: string, ignored: (f: string) => boolean, lines: { offset?: number; limit?: number },
): Verdict | undefined {
  if (ignored(file)) return undefined;
  if (IMAGE_FILE.test(file)) {
    return personalImage(file, root) && existsSync(file)
      ? uncheckedRead(shownAs, 'mungkin foto KTP atau dokumen pribadi', 'it is an image that may be a photo of an ID card or document')
      : undefined;
  }
  if (!DATA_FILE.test(file)) return undefined;
  let doc: Document;
  try {
    // A big export is checked from its first rows instead of being skipped: skipping once let a 6 MB CSV through.
    doc = loadDocument(file, { sampleBytes: GUARD_SAMPLE_BYTES, maxZipBytes: GUARD_MAX_ZIP_BYTES });
  } catch (e) {
    // Missing: Read fails on its own. A file that exists but Samaran cannot load is sent unchecked.
    return strictMode() && existsSync(file) ? uncheckedBlock(`reading ${shownAs}`, [`it could not be read (${(e as Error).message})`]) : undefined;
  }
  if (doc.kind === 'skipped') {
    // What Samaran could not read (a scanned or encrypted PDF, a damaged spreadsheet) would reach the model unchecked.
    return doc.dataBearing ? uncheckedRead(shownAs, `tidak bisa dibaca Samaran (${doc.reason})`, doc.reason) : undefined;
  }
  const found = verdict(doc.kind === 'text' ? [doc.text] : doc.sheets.map((s) => s.csv));
  if (found) {
    return block(
      [
        `Samaran blocked reading ${shownAs}: it contains personal data (${summarize(found, false)}).`,
        'Use the `read_file_masked` tool from the lokal MCP server instead: same content, with personal data replaced by stable placeholders.',
        'Write results that need the real values with `write_file_unmasked`.',
        'If the user confirms the file only holds fake data, they can add it to .samaranignore.',
      ].join(' '),
      found,
    );
  }
  if (doc.kind === 'sheets' && doc.unscanned) return uncheckedRead(shownAs, `hanya terbaca sebagian (${doc.unscanned})`, doc.unscanned);
  if (doc.kind === 'text' && doc.sampled) {
    // Only the first part of a big file was checked; Read with an offset can show lines past it.
    const checked = doc.text.split('\n').length;
    const last = Math.max(0, (lines.offset ?? 1) - 1) + (lines.limit ?? READ_LINES);
    if (last > checked) {
      const mb = `${GUARD_SAMPLE_BYTES / 1024 / 1024} MB`;
      return uncheckedRead(shownAs, `hanya ${mb} pertama yang diperiksa Samaran`, `only its first ${mb} (${checked} lines) were checked`);
    }
  }
  return undefined;
}

function shellTool(command: string, cwd: string, powershell: boolean, ignored: (f: string) => boolean): Verdict | undefined {
  const reads = [...dataReadsInCommand(command, cwd, powershell), ...(strictMode() ? inlineCodeReads(command, cwd, powershell) : [])]
    .filter((r) => !ignored(r.file));
  const matches: PiiMatch[] = [];
  const files = new Set<string>();
  const unchecked: string[] = [];
  const nameOf = (f: string) => path.relative(cwd, f) || f;
  for (const r of reads) {
    if (outOfTime()) {
      unchecked.push(`checking ${nameOf(r.file)} took too long`);
      break;
    }
    const loaded = fileTexts(r.file);
    if (loaded.unchecked) unchecked.push(`${nameOf(r.file)}: ${loaded.unchecked}`);
    for (const full of loaded.texts) {
      const shown = r.select(full);
      if (loaded.sampled && !withinSample(r.select, full, shown)) {
        unchecked.push(`${nameOf(r.file)}: only its first ${GUARD_SAMPLE_BYTES / 1024 / 1024} MB were checked`);
      }
      if (!shown.trim()) continue;
      const here = shownPii(full, shown, r.file);
      for (const m of here) matches.push(m);
      if (verdictOf(here)) files.add(r.file);
    }
  }
  const found = verdictOf(matches);
  if (!found) return strictMode() && unchecked.length ? uncheckedBlock('this command', unchecked) : undefined;
  const names = [...(files.size ? files : new Set(reads.map((r) => r.file)))].map(nameOf);
  return block([
    `Samaran blocked this command: it would print personal data from ${names.join(', ')} into the conversation (${summarize(found, false)}).`,
    'To look at the data, use the `read_file_masked` tool from the lokal MCP server (personal data replaced by stable placeholders).',
    PROCESS_HINT,
    'If the user confirms the file only holds fake data, they can add it to .samaranignore.',
  ].join(' '), found);
}

function grepTool(input: NonNullable<HookInput['tool_input']>, cwd: string, ignored: (f: string) => boolean): Verdict | undefined {
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
    .filter((f) => !typeFilter || typeFilter.test(f));
  const unchecked: string[] = [];
  if (candidates.length > GREP_MAX_FILES) {
    unchecked.push(`only ${GREP_MAX_FILES} of the ${candidates.length} data files it searches were checked`);
    candidates = candidates.slice(0, GREP_MAX_FILES);
  }
  const nameOf = (f: string) => path.relative(cwd, f) || f;

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
    if (outOfTime()) {
      unchecked.push(`checking the files took too long (stopped at ${nameOf(file)})`);
      break;
    }
    const loaded = fileTexts(file);
    if (loaded.unchecked) unchecked.push(`${nameOf(file)}: ${loaded.unchecked}`);
    // Grep searches the whole file; past the part that was read, any line can match.
    if (loaded.sampled) unchecked.push(`${nameOf(file)}: only its first ${GUARD_SAMPLE_BYTES / 1024 / 1024} MB were checked`);
    for (const full of loaded.texts) {
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
  if (!found) return strictMode() && unchecked.length ? uncheckedBlock('this search', unchecked) : undefined;
  const names = (files.length ? files : candidates).slice(0, 5).map(nameOf);
  return block([
    `Samaran blocked this search: the matching lines in ${names.join(', ')} contain personal data (${summarize(found, false)}).`,
    'Search with output_mode "files_with_matches" or "count", or read the file with `read_file_masked` from the lokal MCP server.',
    'Add a glob or type that leaves data files out if you meant to search code.',
  ].join(' '), found);
}

/** Whether to block or ask, with the message; undefined to allow. */
export function evaluate(input: HookInput, projectRoot?: string): Verdict | undefined {
  if (process.env.SAMARAN_GUARD === 'off') return undefined;
  const root = projectRoot ?? process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  // SAMARAN_GUARD_BUDGET_MS can only shorten the budget, which blocks more: tests use it.
  const budget = Math.min(Number(process.env.SAMARAN_GUARD_BUDGET_MS) || STRICT_BUDGET_MS, STRICT_BUDGET_MS);
  deadline = Date.now() + budget;
  // One hook call is one process: the project's rules apply to every check below.
  config = loadConfig(root);

  if (input.hook_event_name === 'UserPromptSubmit' && input.prompt) {
    if (BYPASS.test(input.prompt)) return undefined;
    // Identity numbers, and whatever the project's policy blocks or keeps local.
    const held = Object.entries(config.policy ?? {})
      .filter(([type, action]) => (action === 'block' || action === 'route') && PII_TYPES.includes(type as PiiType))
      .map(([type]) => type as PiiType);
    const found = detectConfigured(input.prompt, { types: [...new Set([...STRICT, ...held])], minConfidence: 'high' }, config);
    if (!found.length) return undefined;
    return block([
      `🛡️  Samaran menahan prompt ini: ada data pribadi ${summarize(found)}.`,
      'Prompt akan terkirim ke server model AI. Ganti dengan data contoh atau samarkan dulu,',
      'atau kirim ulang dengan menambahkan #izinkan-pii jika memang disengaja.',
    ].join('\n'), found);
  }

  if (input.hook_event_name !== 'PreToolUse' || !input.tool_input) return undefined;
  const cwd = input.cwd ?? root;
  const ignored = loadIgnore(root);
  const tool = input.tool_input;
  switch (input.tool_name) {
    case 'Read':
      if (!tool.file_path) return undefined;
      {
        const file = path.resolve(root, tool.file_path);
        const rel = path.relative(root, file);
        const shownAs = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : tool.file_path;
        return readTool(file, shownAs, root, ignored, tool);
      }
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

// ------------------------------------------------------------------------------------------------ other agents
//
// The same guard for other agents' hooks. Codex CLI uses Claude Code's format (PreToolUse with Bash, UserPromptSubmit,
// exit code 2) and needs nothing here. Cursor and Gemini CLI name their events differently and answer differently;
// their event names tell them apart, so one command, `lokal-mcp guard`, serves every agent.

interface OtherAgentInput {
  hook_event_name?: string;
  prompt?: string;
  file_path?: string;
  command?: string;
  cwd?: string;
  workspace_roots?: string[];
  tool_name?: string;
  tool_input?: { file_path?: string; absolute_path?: string; path?: string; command?: string };
}

type Agent = 'claude' | 'cursor' | 'gemini';
const CURSOR_EVENTS = new Set(['beforeSubmitPrompt', 'beforeReadFile', 'beforeShellExecution']);
const GEMINI_EVENTS = new Set(['BeforeAgent', 'BeforeTool']);
// Cursor and Gemini CLI run shell commands in PowerShell on Windows.
const shellToolName = () => (process.platform === 'win32' ? 'PowerShell' : 'Bash');

/** The event in Claude Code's terms, which `evaluate` speaks, and the project root to use. */
export function translate(raw: OtherAgentInput & HookInput): { agent: Agent; input: HookInput; root?: string } {
  const event = raw.hook_event_name ?? '';
  if (CURSOR_EVENTS.has(event)) {
    const root = raw.workspace_roots?.[0];
    if (event === 'beforeSubmitPrompt') return { agent: 'cursor', input: { hook_event_name: 'UserPromptSubmit', prompt: raw.prompt }, root };
    if (event === 'beforeReadFile') {
      return { agent: 'cursor', input: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: raw.file_path }, cwd: root }, root };
    }
    return {
      agent: 'cursor',
      input: { hook_event_name: 'PreToolUse', tool_name: shellToolName(), tool_input: { command: raw.command }, cwd: raw.cwd ?? root },
      root,
    };
  }
  if (GEMINI_EVENTS.has(event)) {
    if (event === 'BeforeAgent') return { agent: 'gemini', input: { hook_event_name: 'UserPromptSubmit', prompt: raw.prompt, cwd: raw.cwd } };
    const tool = raw.tool_input ?? {};
    if (raw.tool_name === 'read_file') {
      const file = tool.file_path ?? tool.absolute_path ?? tool.path;
      return { agent: 'gemini', input: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: file }, cwd: raw.cwd } };
    }
    if (raw.tool_name === 'run_shell_command') {
      return { agent: 'gemini', input: { hook_event_name: 'PreToolUse', tool_name: shellToolName(), tool_input: { command: tool.command }, cwd: raw.cwd } };
    }
    return { agent: 'gemini', input: { hook_event_name: 'PreToolUse', tool_name: raw.tool_name, cwd: raw.cwd } };
  }
  return { agent: 'claude', input: raw };
}

/** What a hook prints and exits with, in the agent's own format. */
export function respond(agent: Agent, event: string, verdict: Verdict | undefined): { stdout?: string; stderr?: string; exitCode: number } {
  if (agent === 'cursor') {
    // Cursor treats a permission hook without valid JSON as a denial, so it always gets an answer.
    if (event === 'beforeSubmitPrompt') {
      return { stdout: JSON.stringify(verdict ? { continue: false, user_message: verdict.message } : { continue: true }), exitCode: 0 };
    }
    if (!verdict) return { stdout: JSON.stringify({ permission: 'allow' }), exitCode: 0 };
    if (event === 'beforeReadFile') {
      // Reads cannot ask in Cursor: what Samaran cannot check is held back, with a way to allow it.
      const message = verdict.action === 'ask' ? `${verdict.message} (Cursor tidak bisa bertanya dulu, jadi berkas ini ditahan.)` : verdict.message;
      return { stdout: JSON.stringify({ permission: 'deny', user_message: message }), exitCode: 0 };
    }
    return {
      stdout: JSON.stringify(
        verdict.action === 'ask'
          ? { permission: 'ask', user_message: verdict.message }
          : { permission: 'deny', user_message: verdict.message, agent_message: verdict.message },
      ),
      exitCode: 0,
    };
  }
  if (!verdict) return { exitCode: 0 };
  if (verdict.action === 'ask' && agent === 'claude') {
    // Claude Code shows the reason in its permission prompt, and asks in auto mode too.
    const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: verdict.message };
    return { stdout: JSON.stringify({ hookSpecificOutput }), exitCode: 0 };
  }
  // A block, or an ask in Gemini CLI, which cannot ask: exit code 2 with the reason on stderr.
  return { stderr: verdict.message, exitCode: 2 };
}

export async function runGuard(): Promise<void> {
  let agent: Agent = 'claude';
  let event = '';
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const parsed = JSON.parse(raw) as OtherAgentInput & HookInput;
    const translated = translate(parsed);
    agent = translated.agent;
    event = parsed.hook_event_name ?? '';
    const verdict = evaluate(translated.input, translated.root);
    if (verdict) {
      const tool = translated.input.tool_name;
      writeAudit(config.audit, {
        source: 'guard',
        action: verdict.action === 'block' ? 'blocked' : 'asked',
        what: `${translated.input.hook_event_name ?? event}${tool ? ` ${tool}` : ''}`,
        ...(verdict.counts ? { counts: verdict.counts } : { reason: 'could not be checked' }),
      });
    }
    const out = respond(agent, event, verdict);
    if (out.stdout) process.stdout.write(`${out.stdout}\n`);
    if (out.stderr) process.stderr.write(`${out.stderr}\n`);
    process.exitCode = out.exitCode;
  } catch (e) {
    process.stderr.write(`samaran-guard: ${(e as Error).message}\n`);
    // By default a broken guard must never break the session: allow, in the agent's format. Strict mode blocks.
    const failed = strictMode()
      ? block(`Samaran guard failed (${(e as Error).message}), and ${strictBy()} blocks what it cannot check.`)
      : undefined;
    const out = respond(agent, event, failed);
    if (out.stdout) process.stdout.write(`${out.stdout}\n`);
    if (out.stderr) process.stderr.write(`${out.stderr}\n`);
    process.exitCode = out.exitCode;
  }
}

// When bundled into hooks/samaran-guard.mjs, this file is the entry point.
if (process.argv[1] && /samaran-guard\.m?js$/.test(process.argv[1])) {
  await runGuard();
}
