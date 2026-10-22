import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
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
  | { kind: 'skipped'; reason: string; dataBearing: boolean };

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
      return { kind: 'skipped', reason: `unreadable spreadsheet: ${(e as Error).message}`, dataBearing: true };
    }
  }
  if (ext === '.docx') {
    try {
      return { kind: 'sheets', sheets: readDocx(buf), unit: 'part' };
    } catch (e) {
      return { kind: 'skipped', reason: `unreadable Word document: ${(e as Error).message}`, dataBearing: true };
    }
  }
  try {
    const { pages, scanned, damaged, total } = readPdf(buf);
    if (!pages.length && (scanned.length || damaged.length)) {
      const reason = damaged.length ? 'damaged PDF: no readable text' : 'PDF without a text layer (scanned); needs OCR';
      return { kind: 'skipped', reason, dataBearing: true };
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
    const reason = /encrypted/.test(message) ? 'encrypted PDF (password-protected)' : `unreadable PDF: ${message.replace(/\.$/, '')}`;
    return { kind: 'skipped', reason, dataBearing: true };
  }
}

/** Loads a file for scanning: as text, as spreadsheet sheets, or as an explicit skip with a reason. */
export function loadDocument(file: string, options: LoadOptions = {}): Document {
  const ext = path.extname(file).toLowerCase();
  const st = statSync(file);
  if (st.size > MAX_FILE_BYTES) return { kind: 'skipped', reason: `larger than ${mb(MAX_FILE_BYTES)}`, dataBearing: true };
  if (PARSED_WHOLE.has(ext)) {
    if (options.maxZipBytes !== undefined && st.size > options.maxZipBytes) {
      return { kind: 'skipped', reason: `larger than ${mb(options.maxZipBytes)}`, dataBearing: true };
    }
    return parseWhole(ext, readFileSync(file));
  }
  const unsupported = UNSUPPORTED_DATA[ext];
  if (unsupported) return { kind: 'skipped', reason: unsupported, dataBearing: true };
  if (!isTextFile(file)) return { kind: 'skipped', reason: 'binary file', dataBearing: false };
  if (options.sampleBytes !== undefined && st.size > options.sampleBytes) {
    return { kind: 'text', text: readHead(file, options.sampleBytes), sampled: true };
  }
  return { kind: 'text', text: readFileSync(file, 'utf8') };
}

/** Like loadDocument, for content that is not on disk, such as a file staged in git. */
export function loadBuffer(name: string, buf: Buffer): Document {
  const ext = path.extname(name).toLowerCase();
  if (buf.length > MAX_FILE_BYTES) return { kind: 'skipped', reason: `larger than ${mb(MAX_FILE_BYTES)}`, dataBearing: true };
  if (PARSED_WHOLE.has(ext)) return parseWhole(ext, buf);
  const unsupported = UNSUPPORTED_DATA[ext];
  if (unsupported) return { kind: 'skipped', reason: unsupported, dataBearing: true };
  if (buf.subarray(0, 8000).includes(0)) return { kind: 'skipped', reason: 'binary file', dataBearing: false };
  return { kind: 'text', text: buf.toString('utf8') };
}
