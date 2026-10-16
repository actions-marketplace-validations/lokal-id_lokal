// Which data files a shell command would print into the conversation, and which part of them.
//
// The guard only needs the common ways an agent looks at a file: `cat`, `head -5`, `grep … | sort`,
// `Get-Content x -Tail 20`, `Import-Csv x | Select-Object -First 3`. Anything it does not recognize
// (`node dedupe.js data.csv`, `python clean.py`) is allowed: running a script on the real data is the
// private way to process it, and what the script prints is the script author's choice.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './files.ts';

/** Text data formats; spreadsheets are binary and print nothing readable through `cat`. */
export const SHELL_DATA_FILE = /\.(csv|tsv|json|jsonl|ndjson|log|txt|sql|xml|ya?ml|dump|bak|out)(\.\d+)?$/i;

export interface ShellRead {
  file: string;
  /** Narrows the file's text to what the command prints. */
  select: (text: string) => string;
}

type Select = (text: string) => string;
const all: Select = (t) => t;

// Programs that print the files they are given (or their stdin).
const READERS = new Set([
  'cat', 'type', 'gc', 'get-content', 'more', 'less', 'bat', 'batcat', 'head', 'tail', 'nl', 'tac', 'sed', 'awk',
  'gawk', 'cut', 'sort', 'uniq', 'column', 'jq', 'yq', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'select-string', 'sls',
  'import-csv', 'ipcsv', 'xxd', 'od', 'strings', 'csvlook', 'csvcut', 'mlr', 'paste', 'findstr',
]);
// Programs that pass their stdin through to the screen, reshaped.
const FILTERS = new Set([
  ...READERS, 'tr', 'fold', 'fmt', 'tee', 'select-object', 'select', 'format-table', 'ft', 'format-list', 'fl',
  'out-string', 'out-host', 'convertto-json', 'convertto-csv', 'where-object', 'where', '?', 'sort-object',
  'group-object', 'write-output', 'echo',
]);
const WRITE_SINKS = new Set(['out-file', 'set-content', 'add-content', 'export-csv', 'out-null']);
const PREFIXES = new Set(['sudo', 'command', 'env', 'time', 'nice', 'nohup', 'exec', '&', '.']);

interface Word {
  text: string;
  quoted: boolean;
}

/** Heredoc and here-string bodies are file contents being written, not commands. */
function stripHeredocs(command: string): string {
  return command
    .replace(/(<<-?[ \t]*(['"]?)(\w+)\2)[^\n]*\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\r?\n|$)/g, '$1')
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "''");
}

/**
 * Splits a command line into pipelines of segments of words. Quotes are honored; `$(…)` is not
 * expanded. In PowerShell a backslash is a path separator and the backtick escapes.
 */
function parse(command: string, powershell: boolean): Word[][][] {
  const escape = powershell ? '`' : '\\';
  const pipelines: Word[][][] = [];
  let segments: Word[][] = [];
  let words: Word[] = [];
  let cur = '';
  let quoted = false;
  let started = false;
  const endWord = () => {
    if (started) words.push({ text: cur, quoted });
    cur = '';
    quoted = false;
    started = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  const endPipeline = () => {
    endSegment();
    if (segments.length) pipelines.push(segments);
    segments = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === "'" || c === '"') {
      const close = command.indexOf(c, i + 1);
      const end = close === -1 ? command.length : close;
      cur += command.slice(i + 1, end);
      quoted = started = true;
      i = end;
    } else if (c === escape && i + 1 < command.length && command[i + 1] !== '\n') {
      cur += command[++i];
      started = true;
    } else if (c === '\n' || c === ';' || (c === '&' && command[i + 1] === '&') || (c === '|' && command[i + 1] === '|')) {
      endPipeline();
      if (c !== '\n' && c !== ';') i++;
    } else if (c === '|') {
      endSegment();
    } else if (c === '>' || c === '<') {
      // Redirections become their own words: ">", ">>", "2>", "<".
      const fd = /^\d$|^&$/.test(cur) ? cur : '';
      if (!fd) endWord();
      cur = '';
      started = false;
      let op = fd + c;
      if (command[i + 1] === '>') op += command[++i];
      if (command[i + 1] === '&') op += command[++i] + (command[i + 1] ?? '');
      if (/&\d$/.test(op)) i++;
      words.push({ text: op, quoted: false });
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
    } else {
      cur += c;
      started = true;
    }
  }
  endPipeline();
  return pipelines;
}

function programName(word: string): string {
  return path.basename(word).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
}

function firstLines(n: number): Select {
  return (t) => t.split('\n').slice(0, Math.max(0, n)).join('\n');
}
function lastLines(n: number, fromLine?: number): Select {
  return (t) => {
    const lines = t.replace(/\n$/, '').split('\n');
    return (fromLine !== undefined ? lines.slice(Math.max(0, fromLine - 1)) : lines.slice(-Math.max(1, n))).join('\n');
  };
}
function matching(
  pattern: string,
  opts: { ignoreCase?: boolean; invert?: boolean; fixed?: boolean; onlyMatching?: boolean },
): Select {
  let re: RegExp | undefined;
  try {
    const source = opts.fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern.replace(/\\([<>])/g, '\\b');
    re = new RegExp(source, opts.ignoreCase ? 'gi' : 'g');
  } catch {
    return all; // A pattern JavaScript cannot read: assume every line can come out.
  }
  if (opts.onlyMatching && !opts.invert) {
    // grep -o prints just the matched parts: `grep -o "err=[A-Za-z]*"` shows error names, not the line.
    return (t) => t.split('\n').flatMap((l) => [...l.matchAll(re!)].map((m) => m[0])).join('\n');
  }
  return (t) =>
    t
      .split('\n')
      .filter((l) => {
        re!.lastIndex = 0;
        return re!.test(l) !== Boolean(opts.invert);
      })
      .join('\n');
}

/** "2", "1,3", "2-4", "3-" → a test for 1-based field numbers. */
function fieldList(spec: string): ((n: number) => boolean) | undefined {
  const parts = spec.split(',').map((p) => /^(\d*)(-?)(\d*)$/.exec(p));
  if (parts.some((p) => !p || (!p[1] && !p[3]))) return undefined;
  return (n) =>
    parts.some((p) => {
      const from = p![1] ? Number(p![1]) : 1;
      const to = p![2] ? (p![3] ? Number(p![3]) : Infinity) : from;
      return n >= from && n <= to;
    });
}

/** Lines cut into fields, keeping only the ones asked for. */
function fields(split: (line: string) => string[], keep: (n: number) => boolean, joiner: string): Select {
  return (t) =>
    t
      .split('\n')
      .map((l) => split(l).filter((_, i) => keep(i + 1)).join(joiner))
      .join('\n');
}

/** `awk -F, '{print $2, $5}'`: the printed fields; anything fancier prints the whole line as far as we know. */
function awkSelect(args: string[], positional: string[]): Select {
  const sep = option(args, ['-f', '-F']) ?? args.find((a) => /^-F./.test(a))?.slice(2);
  const program = positional.find((p) => p.includes('{')) ?? '';
  const m = /^\s*(?:NR\s*[<>]=?\s*\d+\s*)?\{\s*print\s+((?:\$\d+\s*,?\s*)+);?\s*\}\s*$/.exec(program);
  if (!m) return all;
  const wanted = new Set([...m[1]!.matchAll(/\$(\d+)/g)].map((x) => Number(x[1])));
  if (wanted.has(0)) return all;
  const splitter = sep === undefined ? /\s+/ : sep.length === 1 ? sep : new RegExp(sep);
  return fields((l) => (sep === undefined ? l.trim() : l).split(splitter), (n) => wanted.has(n), ' ');
}

/** Value of `-Name value` / `--name=value` style options. */
function option(args: string[], names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!.toLowerCase();
    for (const n of names) {
      if (a === n) return args[i + 1];
      if (a.startsWith(`${n}=`)) return args[i]!.slice(n.length + 1);
      if (n.length === 2 && n.startsWith('-') && a.startsWith(n) && a.length > 2) {
        return args[i]!.slice(2); // -n5, -d, -F"err="
      }
    }
  }
  return undefined;
}

const has = (args: string[], ...flags: string[]) =>
  args.some((a) => flags.includes(a) || (/^-[a-zA-Z]+$/.test(a) && flags.some((f) => /^-[a-zA-Z]$/.test(f) && a.includes(f[1]!))));

interface Segment {
  program: string;
  args: string[];
  /** Words that are not options, in order. */
  positional: string[];
  inputFile?: string;
  writesToFile: boolean;
}

function toSegment(words: Word[]): Segment | undefined {
  const list = [...words];
  // Skip VAR=value assignments and wrappers like sudo.
  while (list.length && (/^[A-Za-z_]\w*=/.test(list[0]!.text) && !list[0]!.quoted)) list.shift();
  while (list.length && PREFIXES.has(list[0]!.text.toLowerCase())) list.shift();
  if (!list.length) return undefined;
  const program = programName(list[0]!.text);
  const args: string[] = [];
  let inputFile: string | undefined;
  let writesToFile = false;
  for (let i = 1; i < list.length; i++) {
    const w = list[i]!;
    if (!w.quoted && /^(\d|&)?>>?$/.test(w.text)) {
      if (!w.text.startsWith('2')) writesToFile = true; // `2>` only redirects errors
      i++;
    } else if (!w.quoted && /^\d?>&\d$/.test(w.text)) {
      // 2>&1 and friends: nothing to do
    } else if (!w.quoted && w.text === '<') {
      inputFile = list[++i]?.text;
    } else {
      args.push(w.text);
    }
  }
  const positional = args.filter((a) => !/^--?[A-Za-z]/.test(a) && !/^-\d+$/.test(a));
  return { program, args, positional, inputFile, writesToFile };
}

/** How a segment narrows what flows through it, or `undefined` when it prints a summary instead (wc -l, grep -c). */
function selection(seg: Segment): Select | undefined {
  const { program, args } = seg;
  const num = (v: string | undefined) => (v !== undefined && /^[+-]?\d+$/.test(v) ? Number(v) : undefined);
  switch (program) {
    case 'head': {
      const n = num(option(args, ['-n', '--lines', '-c', '--bytes'])) ?? num(args.find((a) => /^-\d+$/.test(a))?.slice(1));
      return firstLines(Math.abs(n ?? 10));
    }
    case 'tail': {
      const raw = option(args, ['-n', '--lines']) ?? args.find((a) => /^-\d+$/.test(a))?.slice(1);
      if (raw?.startsWith('+')) return lastLines(0, Number(raw.slice(1)));
      return lastLines(Math.abs(num(raw) ?? 10));
    }
    case 'grep': case 'egrep': case 'fgrep': case 'rg': case 'ag': case 'findstr': {
      if (has(args, '-c', '-l', '-L', '-q', '--count', '--files-with-matches', '--files-without-match', '--quiet')) {
        return undefined;
      }
      const pattern = option(args, ['-e', '--regexp']) ?? seg.positional[0];
      if (pattern === undefined) return all;
      return matching(pattern, {
        ignoreCase: has(args, '-i', '--ignore-case') || (program === 'findstr' && has(args, '/i')),
        invert: has(args, '-v', '--invert-match'),
        fixed: program === 'fgrep' || has(args, '-F', '--fixed-strings'),
        onlyMatching: has(args, '-o', '--only-matching'),
      });
    }
    case 'cut': {
      const list = option(args, ['-f', '--fields']);
      const keep = list === undefined ? undefined : fieldList(list);
      if (!keep) return all;
      const delimiter = option(args, ['-d', '--delimiter']) ?? '\t';
      return fields((l) => l.split(delimiter), keep, delimiter);
    }
    case 'awk': case 'gawk':
      return awkSelect(args, seg.positional);
    case 'select-string': case 'sls': {
      const pattern = option(args, ['-pattern']) ?? seg.positional[0];
      if (pattern === undefined) return all;
      if (has(args, '-quiet', '-list')) return undefined;
      return matching(pattern, {
        ignoreCase: !has(args, '-casesensitive'),
        invert: has(args, '-notmatch'),
        fixed: has(args, '-simplematch'),
      });
    }
    case 'sed': {
      const script = option(args, ['-e', '--expression']) ?? seg.positional[0] ?? '';
      const range = /^(\d+)(?:,(\d+))?p$/.exec(script);
      if (has(args, '-n') && range) {
        const from = Number(range[1]);
        const to = Number(range[2] ?? range[1]);
        return (t) => t.split('\n').slice(from - 1, to).join('\n');
      }
      const quit = /^(\d+)q$/.exec(script);
      return quit ? firstLines(Number(quit[1])) : all;
    }
    case 'get-content': case 'gc': case 'cat': case 'type': {
      const head = num(option(args, ['-totalcount', '-head', '-first']));
      const tail = num(option(args, ['-tail', '-last']));
      if (head !== undefined) return firstLines(head);
      if (tail !== undefined) return lastLines(tail);
      return all;
    }
    case 'select-object': case 'select': {
      const first = num(option(args, ['-first']));
      const last = num(option(args, ['-last']));
      if (first !== undefined) return firstLines(first + 1); // + the header row of Import-Csv output
      if (last !== undefined) return lastLines(last);
      return all;
    }
    default:
      return all;
  }
}

function expand(raw: string, cwd: string, powershell: boolean): string[] {
  let word = raw;
  // Git Bash on Windows writes Z:\Project as /z/Project.
  if (process.platform === 'win32') word = word.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:');
  // PowerShell takes "\" as a path separator on every OS: .\data.csv
  else if (powershell) word = word.replace(/\\/g, '/');
  if (!/[*?]/.test(word)) {
    const file = path.resolve(cwd, word);
    return SHELL_DATA_FILE.test(file) && existsSync(file) && statSync(file).isFile() ? [file] : [];
  }
  const dir = path.resolve(cwd, path.dirname(word));
  const re = globToRegExp(path.basename(word));
  try {
    return readdirSync(dir)
      .filter((name) => re.test(name) && SHELL_DATA_FILE.test(name))
      .map((name) => path.join(dir, name))
      .filter((f) => statSync(f).isFile());
  } catch {
    return [];
  }
}

/** Data files whose contents the command prints to the conversation. */
export function dataReadsInCommand(command: string, cwd: string, powershell = false): ShellRead[] {
  const out: ShellRead[] = [];
  for (const pipeline of parse(stripHeredocs(command), powershell)) {
    let flow: ShellRead[] = [];
    for (const words of pipeline) {
      const seg = toSegment(words);
      if (!seg) continue;
      const narrow = selection(seg);
      if (WRITE_SINKS.has(seg.program) || (!READERS.has(seg.program) && !FILTERS.has(seg.program))) {
        flow = []; // written to a file, or consumed by a program whose output we cannot predict
        continue;
      }
      if (!narrow) {
        flow = []; // a count or a yes/no, not the data
        continue;
      }
      const files = READERS.has(seg.program)
        ? [...seg.args, ...(seg.inputFile ? [seg.inputFile] : [])].flatMap((a) => expand(a, cwd, powershell))
        : [];
      flow = files.length
        ? files.map((file) => ({ file, select: narrow }))
        : flow.map((r) => ({ file: r.file, select: (t: string) => narrow(r.select(t)) }));
      if (seg.writesToFile && seg.program !== 'tee') flow = [];
    }
    for (const r of flow) out.push(r);
  }
  return out;
}
