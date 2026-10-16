import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { readDocx } from './docx.ts';
import { readXlsx, type Sheet } from './xlsx.ts';

/** scan_pii and read_file_masked read files up to this size; detection is linear, about 0.15 s per MB. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** The guard hook has 10 seconds, so for bigger text files it checks this much from the start. */
export const GUARD_SAMPLE_BYTES = 5 * 1024 * 1024;
/** Spreadsheets and documents must be unzipped whole; above this the guard reports them instead. */
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
  /** Spreadsheet sheets, or a Word document's text and tables (`unit: 'part'`), each as CSV. */
  | { kind: 'sheets'; sheets: Sheet[]; unit?: 'sheet' | 'part' }
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

// Formats that commonly hold personal data but cannot be read yet: they must be reported, not ignored.
const UNSUPPORTED_DATA: Record<string, string> = {
  '.xls': 'Excel 97-2003 (.xls) is not supported; save it as .xlsx or .csv',
  '.pdf': 'PDF is not supported yet',
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

/** Loads a file for scanning: as text, as spreadsheet sheets, or as an explicit skip with a reason. */
export function loadDocument(file: string, options: LoadOptions = {}): Document {
  const ext = path.extname(file).toLowerCase();
  const st = statSync(file);
  if (st.size > MAX_FILE_BYTES) return { kind: 'skipped', reason: `larger than ${mb(MAX_FILE_BYTES)}`, dataBearing: true };
  const zipped = ext === '.xlsx' || ext === '.xlsm' || ext === '.docx';
  if (zipped && options.maxZipBytes !== undefined && st.size > options.maxZipBytes) {
    return { kind: 'skipped', reason: `larger than ${mb(options.maxZipBytes)}`, dataBearing: true };
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    try {
      return { kind: 'sheets', sheets: readXlsx(readFileSync(file)) };
    } catch (e) {
      return { kind: 'skipped', reason: `unreadable spreadsheet: ${(e as Error).message}`, dataBearing: true };
    }
  }
  if (ext === '.docx') {
    try {
      return { kind: 'sheets', sheets: readDocx(readFileSync(file)), unit: 'part' };
    } catch (e) {
      return { kind: 'skipped', reason: `unreadable Word document: ${(e as Error).message}`, dataBearing: true };
    }
  }
  const unsupported = UNSUPPORTED_DATA[ext];
  if (unsupported) return { kind: 'skipped', reason: unsupported, dataBearing: true };
  if (!isTextFile(file)) return { kind: 'skipped', reason: 'binary file', dataBearing: false };
  if (options.sampleBytes !== undefined && st.size > options.sampleBytes) {
    return { kind: 'text', text: readHead(file, options.sampleBytes), sampled: true };
  }
  return { kind: 'text', text: readFileSync(file, 'utf8') };
}
