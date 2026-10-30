// Rules a team adds for its own data: an employee ID format, a member-number column. They are found like the built-in
// types and masked as [<LABEL>_1], so `unmask` restores them like any other placeholder.
import { PII_TYPES, type PiiMatch } from './types.ts';

export interface CustomRule {
  /** Placeholder name, in capitals and underscores: EMPLOYEE_ID masks as [EMPLOYEE_ID_1]. */
  label: string;
  /**
   * Values that are this data, wherever they appear. A string is a regular expression's source, as written in
   * `.samaran.json`; keep to syntax JavaScript and Python share (no lookbehind, no named groups).
   */
  pattern?: RegExp | string;
  /**
   * Field names whose values are this data: JSON keys, `key: value` and `key=value` labels, and CSV or TSV columns.
   * Matched without regard to case.
   */
  fields?: readonly string[];
}

const LABEL = /^[A-Z][A-Z_]*[A-Z]$|^[A-Z]$/;

/** Throws RangeError for a rule that cannot work: a bad label, a pattern that does not compile, nothing to match. */
export function checkCustomRules(rules: readonly CustomRule[]): void {
  for (const rule of rules) {
    if (!LABEL.test(rule.label ?? '')) {
      throw new RangeError(`Custom rule label "${rule.label}" must be capital letters and underscores, like EMPLOYEE_ID.`);
    }
    if ((PII_TYPES as readonly string[]).includes(rule.label)) {
      throw new RangeError(`Custom rule label "${rule.label}" is a built-in type; choose another name.`);
    }
    if (rule.pattern === undefined && !rule.fields?.length) {
      throw new RangeError(`Custom rule ${rule.label} needs a pattern or fields.`);
    }
    if (typeof rule.pattern === 'string') {
      try {
        new RegExp(rule.pattern);
      } catch (e) {
        throw new RangeError(`Custom rule ${rule.label}: pattern does not compile (${(e as Error).message}).`);
      }
    }
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function custom(label: string, start: number, value: string): PiiMatch {
  return { type: 'CUSTOM', label, start, end: start + value.length, value, confidence: 'high' };
}

function byPattern(text: string, rule: CustomRule): PiiMatch[] {
  const source = typeof rule.pattern === 'string' ? rule.pattern : rule.pattern!.source;
  const flags = typeof rule.pattern === 'string' ? '' : rule.pattern!.flags.replace(/[gy]/g, '');
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(new RegExp(source, `${flags}g`))) {
    if (m[0]) out.push(custom(rule.label, m.index, m[0]));
  }
  return out;
}

/** `"no_member": "M-0042"`, `no_member: M-0042`, `no_member=M-0042`. */
function byLabel(text: string, rule: CustomRule, names: string): PiiMatch[] {
  const re = new RegExp(
    `(?:^|[^A-Za-z0-9_])(["']?)(?:${names})\\1[ \\t]*[:=][ \\t]*(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([^\\s,;}\\]"'][^,;}\\]\\r\\n]*))`,
    'gi',
  );
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(re)) {
    const quoted = m[2] ?? m[3];
    if (quoted !== undefined) {
      if (quoted.trim()) out.push(custom(rule.label, m.index + m[0].length - 1 - quoted.length, quoted));
      continue;
    }
    // Unquoted, the value runs on while words look like part of it ("Siti Aminah", "M 0042"), not into a sentence.
    const raw = m[4]!;
    const words = raw.split(/(\s+)/);
    let value = words[0]!;
    for (let i = 1; i + 1 < words.length && i < 12 && /^[A-Z0-9]/.test(words[i + 1]!); i += 2) value += words[i]! + words[i + 1]!;
    out.push(custom(rule.label, m.index + m[0].length - raw.length, value));
  }
  return out;
}

/** Splits one CSV/TSV line into cells with their offsets, honoring double quotes. */
function cells(line: string, delimiter: string): Array<{ start: number; text: string }> {
  const out: Array<{ start: number; text: string }> = [];
  let i = 0;
  for (;;) {
    let start = i;
    let end: number;
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && !(line[j] === '"' && line[j + 1] !== '"')) j += line[j] === '"' ? 2 : 1;
      start = i + 1;
      end = j;
      i = j + 1;
      while (i < line.length && line[i] !== delimiter) i++;
    } else {
      end = line.indexOf(delimiter, i);
      if (end === -1) end = line.length;
      i = end;
    }
    out.push({ start, text: line.slice(start, end) });
    if (i >= line.length) return out;
    i++;
  }
}

/** A column of a CSV or TSV whose header names the field, down to the first blank line. */
function byColumn(text: string, rule: CustomRule, wanted: ReadonlySet<string>): PiiMatch[] {
  const out: PiiMatch[] = [];
  let columns: number[] | undefined;
  let delimiter = ',';
  let width = 0;
  for (let pos = 0; pos <= text.length; ) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    const line = text.slice(pos, end).replace(/\r$/, '');
    if (!line.trim()) {
      columns = undefined;
    } else if (columns) {
      const row = cells(line, delimiter);
      if (row.length === width) {
        for (const c of columns) {
          const value = row[c]!.text.trim();
          if (value) out.push(custom(rule.label, pos + row[c]!.start + row[c]!.text.indexOf(value), value));
        }
      }
    } else {
      for (const d of [',', '\t', ';', '|']) {
        const header = cells(line, d);
        if (header.length < 2) continue;
        const hit = header.flatMap((c, i) => (wanted.has(c.text.trim().toLowerCase()) ? [i] : []));
        if (hit.length) {
          columns = hit;
          delimiter = d;
          width = header.length;
          break;
        }
      }
    }
    pos = end + 1;
  }
  return out;
}

/** Everything the rules find, possibly overlapping; detectPii picks among them and the built-in matches. */
export function detectCustom(text: string, rules: readonly CustomRule[]): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const rule of rules) {
    if (rule.pattern !== undefined) out.push(...byPattern(text, rule));
    if (rule.fields?.length) {
      out.push(...byLabel(text, rule, rule.fields.map(escape).join('|')));
      out.push(...byColumn(text, rule, new Set(rule.fields.map((f) => f.toLowerCase()))));
    }
  }
  return out;
}
