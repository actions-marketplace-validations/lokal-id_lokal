import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkCustomRules, detectPii, type CustomRule, type DetectOptions, type PiiMatch, type ScanStatus } from '@lokal-id/core';
import { readDocx } from './docx.ts';
import { readPdf } from './pdf.ts';
import { readXlsx, type Sheet } from './xlsx.ts';

/** scan_pii and read_file_masked read files up to this size; detection is linear, about 0.15 s per MB. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** The guard hook has 10 seconds, so for bigger text files it checks this much from the start. */
export const GUARD_SAMPLE_BYTES = 5 * 1024 * 1024;
/** Spreadsheets, Word documents, and PDFs must be parsed whole; above this the guard reports them instead. */
export const GUARD_MAX_ZIP_BYTES = 20 * 1024 * 1024;

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage', 'vendor',
  '__pycache__', '.venv', 'venv', '.turbo', '.cache', 'target',
]);

/** Resolves `p` against `root` and refuses paths that escape it. */
export function resolveInRoot(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path is outside the allowed root (${root}): ${p}`);
  }
  return abs;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Binary files have NUL bytes early on; text files do not. */
export function isTextFile(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8000);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return !buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}

export function* walkFiles(dir: string, limit = 5000): Generator<string> {
  const stack = [dir];
  let count = 0;
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        if (++count > limit) return;
        yield full;
      }
    }
  }
}

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{' && glob.indexOf('}', i) > i) {
      // "*.{csv,json}"
      const close = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, close).split(',').map((alt) => globToRegExp(alt).source.slice(1, -1)).join('|')})`;
      i = close;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** `.samaran.json`: a team's own rules and the values it never wants masked. */
export interface SamaranConfig {
  custom: CustomRule[];
  allow: string[];
}

/**
 * `.samaran.json` at the project root, or empty rules when there is none:
 *
 *   { "custom": [{ "label": "EMPLOYEE_ID", "pattern": "\\bEMP-\\d{6}\\b" }, { "label": "MEMBER", "fields": ["no_member"] }],
 *     "allow": ["0800-1-500-500"] }
 *
 * A file that is there but wrong throws: a rule that silently did nothing would mask less than the team expects.
 */
export function loadConfig(root: string): SamaranConfig {
  const file = path.join(root, '.samaran.json');
  if (!existsSync(file)) return { custom: [], allow: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`.samaran.json is not valid JSON: ${(e as Error).message}`);
  }
  const fail = (why: string): never => {
    throw new Error(`.samaran.json: ${why}`);
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('expected an object with "custom" and "allow"');
  const { custom = [], allow = [], ...rest } = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(rest).filter((k) => !k.startsWith('$'));
  if (unknownKeys.length) fail(`unknown key ${unknownKeys.map((k) => `"${k}"`).join(', ')} (expected "custom" and "allow")`);
  if (!Array.isArray(custom)) fail('"custom" must be a list of rules');
  if (!Array.isArray(allow) || !allow.every((a) => typeof a === 'string')) fail('"allow" must be a list of strings');
  const rules = (custom as unknown[]).map((r, i): CustomRule => {
    if (!r || typeof r !== 'object') fail(`custom[${i}] must be an object`);
    const { label, pattern, fields, ...extra } = r as Record<string, unknown>;
    if (Object.keys(extra).length) fail(`custom[${i}]: unknown key ${Object.keys(extra).map((k) => `"${k}"`).join(', ')}`);
    if (typeof label !== 'string') fail(`custom[${i}] needs a "label"`);
    if (pattern !== undefined && typeof pattern !== 'string') fail(`custom[${i}].pattern must be a string`);
    if (fields !== undefined && (!Array.isArray(fields) || !fields.every((f) => typeof f === 'string' && f.trim()))) {
      fail(`custom[${i}].fields must be a list of field names`);
    }
    return {
      label: label as string,
      ...(pattern !== undefined ? { pattern: pattern as string } : {}),
      ...(fields !== undefined ? { fields: fields as string[] } : {}),
    };
  });
  try {
    checkCustomRules(rules);
  } catch (e) {
    fail((e as Error).message);
  }
  return { custom: rules, allow: allow as string[] };
}

/** detectPii with the project's own rules, minus the values it allows. */
export function detectConfigured(text: string, options: DetectOptions, config: SamaranConfig): PiiMatch[] {
  const found = detectPii(text, { ...options, custom: config.custom });
  return config.allow.length ? found.filter((m) => !config.allow.includes(m.value)) : found;
}

/**
 * `.samaranignore` at the project root: gitignore-like patterns for files known to hold
 * only fake data (test fixtures, seeders). Patterns without "/" match the file name anywhere.
 */
export function loadIgnore(root: string): (absPath: string) => boolean {
  const file = path.join(root, '.samaranignore');
  if (!existsSync(file)) return () => false;
  const rules = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((pattern) => {
      const dirOnly = pattern.endsWith('/');
      const clean = pattern.replace(/^\/|\/$/g, '');
      return { re: globToRegExp(clean), dirOnly, anchored: pattern.replace(/\/$/, '').includes('/') };
    });

  return (absPath: string) => {
    const rel = toPosix(path.relative(root, absPath));
    if (rel.startsWith('..')) return false;
    const segments = rel.split('/');
    return rules.some(({ re, dirOnly, anchored }) => {
      if (anchored) {
        // Match the path itself or any of its parent directories.
        for (let i = segments.length; i >= 1; i--) {
          if (dirOnly && i === segments.length) continue;
          if (re.test(segments.slice(0, i).join('/'))) return true;
        }
        return false;
      }
      const candidates = dirOnly ? segments.slice(0, -1) : segments;
      return candidates.some((s) => re.test(s));
    });
  };
}

export type Document =
  /** `sampled`: only the first `sampleBytes`, cut at a line break. */
  | { kind: 'text'; text: string; sampled?: boolean }
  /**
   * Spreadsheet sheets, a Word document's text and tables (`unit: 'part'`), or a PDF's pages (`unit: 'page'`).
   * `unscanned` says what could not be read, such as scanned pages in an otherwise text-based PDF.
   */
  | { kind: 'sheets'; sheets: Sheet[]; unit?: 'sheet' | 'part' | 'page'; unscanned?: string }
  /** `status`: unsupported (a kind of file Lokal does not read) or failed (a kind it reads, but this one would not). */
  | { kind: 'skipped'; status: 'unsupported' | 'failed'; reason: string; dataBearing: boolean };

/** How much of a loaded document a check saw. */
export function documentStatus(doc: Document): ScanStatus {
  if (doc.kind === 'skipped') return doc.status;
  if ((doc.kind === 'text' && doc.sampled) || (doc.kind === 'sheets' && doc.unscanned)) return 'partial';
  return 'scanned';
}

const unsupported = (reason: string, dataBearing = true): Document => ({ kind: 'skipped', status: 'unsupported', reason, dataBearing });
const failed = (reason: string): Document => ({ kind: 'skipped', status: 'failed', reason, dataBearing: true });

export interface LoadOptions {
  /** Read only this many bytes of a larger text file (the guard's time budget). */
  sampleBytes?: number;
  /** Skip spreadsheets and documents above this size instead of unzipping them. */
  maxZipBytes?: number;
}

function readHead(file: string, bytes: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    const text = buf.subarray(0, n).toString('utf8');
    const lastBreak = text.lastIndexOf('\n');
    return lastBreak > 0 ? text.slice(0, lastBreak) : text;
  } finally {
    closeSync(fd);
  }
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** "2, 4-6, 9" */
function pageList(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
    out.push(j > i ? `${pages[i]}-${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  return out.join(', ');
}

// Formats that commonly hold personal data but cannot be read yet: they must be reported, not ignored.
const UNSUPPORTED_DATA: Record<string, string> = {
  '.xls': 'Excel 97-2003 (.xls) is not supported; save it as .xlsx or .csv',
  '.doc': 'Word 97-2003 (.doc) is not supported; save it as .docx',
  '.ods': 'OpenDocument spreadsheets are not supported yet',
  '.db': 'database file',
  '.sqlite': 'database file',
  '.sqlite3': 'database file',
  '.zip': 'archive',
  '.gz': 'archive',
  '.rar': 'archive',
  '.7z': 'archive',
  '.jpg': 'image (may be a KTP or selfie photo)',
  '.jpeg': 'image (may be a KTP or selfie photo)',
  '.png': 'image (may be a KTP or selfie photo)',
  '.heic': 'image (may be a KTP or selfie photo)',
  '.webp': 'image (may be a KTP or selfie photo)',
};

const PARSED_WHOLE = new Set(['.xlsx', '.xlsm', '.docx', '.pdf']);

/** Spreadsheets, Word documents, and PDFs: parsed as a whole into sheets, parts, or pages. */
function parseWhole(ext: string, buf: Buffer): Document {
  if (ext === '.xlsx' || ext === '.xlsm') {
    try {
      return { kind: 'sheets', sheets: readXlsx(buf) };
    } catch (e) {
      return failed(`unreadable spreadsheet: ${(e as Error).message}`);
    }
  }
  if (ext === '.docx') {
    try {
      return { kind: 'sheets', sheets: readDocx(buf), unit: 'part' };
    } catch (e) {
      return failed(`unreadable Word document: ${(e as Error).message}`);
    }
  }
  try {
    const { pages, scanned, damaged, total } = readPdf(buf);
    if (!pages.length && (scanned.length || damaged.length)) {
      return damaged.length ? failed('damaged PDF: no readable text') : unsupported('PDF without a text layer (scanned); needs OCR');
    }
    const notes: string[] = [];
    if (scanned.length) {
      const one = scanned.length === 1;
      notes.push(`${one ? 'page' : 'pages'} ${pageList(scanned)} of ${total} ${one ? 'has' : 'have'} no text layer (scanned) and need${one ? 's' : ''} OCR`);
    }
    if (damaged.length) {
      const one = damaged.length === 1;
      notes.push(`${one ? 'page' : 'pages'} ${pageList(damaged)} of ${total} ${one ? 'is' : 'are'} damaged and could not be read`);
    }
    return { kind: 'sheets', sheets: pages, unit: 'page', unscanned: notes.join('; ') || undefined };
  } catch (e) {
    const message = (e as Error).message;
    return failed(/encrypted/.test(message) ? 'encrypted PDF (password-protected)' : `unreadable PDF: ${message.replace(/\.$/, '')}`);
  }
}

/** Loads a file for scanning: as text, as spreadsheet sheets, or as an explicit skip with a reason. */
export function loadDocument(file: string, options: LoadOptions = {}): Document {
  const ext = path.extname(file).toLowerCase();
  const st = statSync(file);
  if (st.size > MAX_FILE_BYTES) return unsupported(`larger than ${mb(MAX_FILE_BYTES)}`);
  if (PARSED_WHOLE.has(ext)) {
    if (options.maxZipBytes !== undefined && st.size > options.maxZipBytes) {
      return unsupported(`larger than ${mb(options.maxZipBytes)}`);
    }
    return parseWhole(ext, readFileSync(file));
  }
  const why = UNSUPPORTED_DATA[ext];
  if (why) return unsupported(why);
  if (!isTextFile(file)) return unsupported('binary file', false);
  if (options.sampleBytes !== undefined && st.size > options.sampleBytes) {
    return { kind: 'text', text: readHead(file, options.sampleBytes), sampled: true };
  }
  return { kind: 'text', text: readFileSync(file, 'utf8') };
}

/** Like loadDocument, for content that is not on disk, such as a file staged in git. */
export function loadBuffer(name: string, buf: Buffer): Document {
  const ext = path.extname(name).toLowerCase();
  if (buf.length > MAX_FILE_BYTES) return unsupported(`larger than ${mb(MAX_FILE_BYTES)}`);
  if (PARSED_WHOLE.has(ext)) return parseWhole(ext, buf);
  const why = UNSUPPORTED_DATA[ext];
  if (why) return unsupported(why);
  if (buf.subarray(0, 8000).includes(0)) return unsupported('binary file', false);
  return { kind: 'text', text: buf.toString('utf8') };
}
