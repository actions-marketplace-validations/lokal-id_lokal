// Kembaran ("twin"): replaces Indonesian personal data with realistic stand-ins, so a copy of production data can go
// to staging, a developer's laptop, or a vendor without anyone in it being a real person.
//
// Unlike Samaran's [NIK_1] placeholders, the result looks like the original and still works as data:
// - The same value always gets the same stand-in, across tables and files, so joins and foreign keys hold.
// - Stand-ins keep what analysis needs and nothing that identifies: a NIK keeps its district, gender, and birth year;
//   a phone number its operator; an address its RT/RW and area; a name its number of words and its casing.
// - Within one line (a CSV row, an SQL tuple), a birth date follows the stand-in NIK, so the row stays consistent.
// - Stand-ins come from HMAC-SHA256 under a secret: random for each run unless one is given, and never reversible
//   without it. Unique values (NIK, phone, account numbers) never collide.
// - `texts` takes the files of one database together: a value found in one is replaced wherever it appears in the
//   others, where the detector alone would miss it (a phone number as a foreign key, a name in a notes column), no
//   stand-in is a real value of the input, and what is left of the real values is counted.
//
// Node only (node:crypto), like @lokal-id/core/wilayah. python/src/lokal/kembaran.py gives identical output for the
// same secret.
import { createHash, randomBytes, type Hash } from 'node:crypto';
import {
  FEMALE_FIRST, FEMALE_LAST, HEALTH, MALE_FIRST, MALE_LAST, MARITAL, NAME_KEEP, RELIGIONS, STREETS,
} from './kembaran-data.ts';
import { parseNik } from './nik.ts';
import { parsePhone } from './phone.ts';
import { canonical, checkCustomRules, detectPii, PII_TYPES, type Confidence, type CustomRule, type PiiType } from './samaran/index.ts';

export interface KembaranOptions {
  /** The same secret gives the same stand-ins on every run. Without one, each run picks a random secret. */
  secret?: string;
  /** Types left as they are. Default: gender, religion, marital status, and nationality, which identify no one. */
  keep?: readonly PiiType[];
  /** Keep the whole birth date, not just the year: more useful for debugging, easier to single someone out. */
  keepBirthDate?: boolean;
  /** "high" replaces only validated or labeled matches. Default "medium". */
  minConfidence?: Confidence;
  /** A team's own rules, as for Samaran: their values get stand-ins of the same shape. */
  custom?: readonly CustomRule[];
}

export interface KembaranResult {
  text: string;
  /** How many values of each type were replaced. */
  replaced: Partial<Record<PiiType, number>>;
}

export interface KembaranTextsResult {
  files: Array<KembaranResult & {
    /** Values replaced because they were found in this or another input, where the detector missed them here. */
    crossed: Partial<Record<PiiType, number>>;
  }>;
  /**
   * Real identity numbers, phone numbers, e-mail addresses, and full names of the input still in the output. 0 unless
   * one is glued to other text ("ID3201…"); a check, not a guarantee for what the detector never found.
   */
  leaked: number;
}

export const KEEP_BY_DEFAULT: readonly PiiType[] = ['GENDER', 'RELIGION', 'MARITAL_STATUS', 'NATIONALITY'];

// Numbers looked up across inputs. Shorter or other numbers (amounts, IDs) are too common to look up.
const CROSS_DIGITS: ReadonlySet<PiiType> = new Set(['NIK', 'KK', 'NPWP', 'PHONE', 'BANK_ACCOUNT', 'CARD', 'BPJS', 'SIM', 'NIP', 'NISN']);
const DIGIT_RUN = /(?<![A-Za-z0-9_+])\+?\d(?:[ .-]?\d){7,18}(?![A-Za-z0-9_])/g;
const EMAIL_RUN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NAME_WORD = /^[A-Za-z'’-]{2,}$/;

// Values that must stay unique: two people must not end up with one stand-in.
const UNIQUE: ReadonlySet<PiiType> = new Set([
  'NIK', 'KK', 'NPWP', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CARD', 'BPJS', 'SIM', 'NIP', 'NISN', 'AKTA', 'PASSPORT', 'PLATE', 'IP',
]);

const MONTHS: ReadonlyArray<readonly string[]> = [
  ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'],
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'],
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
];
const MONTH_ALIASES: Record<string, number> = { agt: 7, ags: 7, sept: 8, nop: 10, peb: 1 };
const MONTH_NAMES = [...new Set([...MONTHS.flat(), ...Object.keys(MONTH_ALIASES)])].sort((a, b) => b.length - a.length).join('|');
const DMY = /(\d{1,2})([-/. ])(\d{1,2})\2(\d{4})/;
const YMD = /(\d{4})([-/.])(\d{1,2})\2(\d{1,2})/;
const D_NAME_Y = new RegExp(`(\\d{1,2})(\\s+)(${MONTH_NAMES})(\\.?\\s+)(\\d{4})`, 'i');
const EXCEL_SERIAL = /^\d{5}$/;
const STREET = /\b(Jl|Jln|Jalan|Gg|Gang|Komp|Kompleks|Perum|Perumahan)(\.?\s+)([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)*?)(?=\s+(?:No|Nomor|Blok|Kav|RT|RW)\b|\s*\d|\s*$)/i;
const INITIAL = /^[A-Za-z]\.$/;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FEMALE_SET = new Set(FEMALE_FIRST.map((n) => n.toLowerCase()));
const MALE_SET = new Set(MALE_FIRST.map((n) => n.toLowerCase()));

/**
 * HMAC-SHA256 under one key, with the padded key hashed once: createHmac re-imports the key on every call, which
 * made a 100,000-row file take seconds longer.
 */
class Hmac {
  private readonly inner: Hash;
  private readonly outer: Hash;
  constructor(secret: Buffer) {
    const key = Buffer.alloc(64);
    (secret.length > 64 ? createHash('sha256').update(secret).digest() : secret).copy(key);
    this.inner = createHash('sha256').update(key.map((b) => b ^ 0x36));
    this.outer = createHash('sha256').update(key.map((b) => b ^ 0x5c));
  }

  digest(message: string): Buffer {
    return this.outer.copy().update(this.inner.copy().update(message).digest()).digest();
  }
}

/** A stream of numbers from HMAC-SHA256(secret, label): the same label always gives the same stream. */
class Stream {
  private block = 0;
  private buf: Buffer = Buffer.alloc(0);
  private pos = 32;
  private readonly key: Hmac;
  private readonly label: string;
  constructor(key: Hmac, label: string) {
    this.key = key;
    this.label = label;
  }

  int(n: number): number {
    if (this.pos + 4 > 32) {
      this.buf = this.key.digest(`${this.label}#${this.block++}`);
      this.pos = 0;
    }
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v % n;
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)]!;
  }

  digits(n: number): string {
    let out = '';
    for (let i = 0; i < n; i++) out += String(this.int(10));
    return out;
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const onlyDigits = (s: string) => s.replace(/\D/g, '');

/** How `texts` looks a number up: a phone number in its national form, so 0812… and 62812… are one. */
function digitKey(type: PiiType, digits: string): string {
  return type === 'PHONE' && digits.startsWith('62') ? `0${digits.slice(2)}` : digits;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Writes `digits` into the digit positions of `template`, keeping its separators: "0812-3456-7890". */
function putDigits(template: string, digits: string): string {
  if (onlyDigits(template).length !== digits.length) return digits;
  let i = 0;
  return template.replace(/\d/g, () => digits[i++]!);
}

/** Same casing as `like`: "BUDI", "budi", or "Budi". */
function caseLike(word: string, like: string): string {
  if (like.length > 1 && like === like.toUpperCase() && like !== like.toLowerCase()) return word.toUpperCase();
  if (like === like.toLowerCase() && like !== like.toUpperCase()) return word.toLowerCase();
  return word;
}

/** Each run of digits replaced by random digits of the same length, keeping a leading zero; never a leading zero otherwise. */
function shapeDigits(s: string, rng: Stream): string {
  // "03" stays "0x", as an RT number would be written.
  return s.replace(/\d+/g, (run) =>
    run
      .split('')
      .map((d, i) => (i > 0 ? String(rng.int(10)) : d === '0' && run.length > 1 ? '0' : String(1 + rng.int(9))))
      .join(''),
  );
}

/** Letters to random letters of the same case, digits to random digits; anything else stays. */
function shapeAll(s: string, rng: Stream): string {
  let out = '';
  for (const ch of s) {
    if (/\d/.test(ch)) out += String(rng.int(10));
    else if (/[A-Z]/.test(ch)) out += LETTERS[rng.int(26)];
    else if (/[a-z]/.test(ch)) out += LETTERS[rng.int(26)]!.toLowerCase();
    else out += ch;
  }
  return out;
}

function luhnFix(digits: string): string {
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return body + String((10 - (sum % 10)) % 10);
}

interface Day {
  day: number;
  month: number;
}

export class Kembaran {
  private readonly key: Hmac;
  private readonly keep: ReadonlySet<PiiType>;
  private readonly keepBirthDate: boolean;
  private readonly minConfidence: Confidence;
  private readonly custom: readonly CustomRule[];
  private readonly fakes = new Map<string, string>();
  private readonly used = new Map<PiiType, Set<string>>();
  private readonly nikDays = new Map<string, Day>();
  /** Canonical real values of the inputs given to `texts`: no stand-in may be one of them. */
  private readonly originals = new Map<PiiType, Set<string>>();

  constructor(options: KembaranOptions = {}) {
    for (const t of options.keep ?? []) {
      if (!PII_TYPES.includes(t)) throw new RangeError(`Unknown PII type "${t}". Valid types: ${PII_TYPES.join(', ')}`);
    }
    this.key = new Hmac(options.secret !== undefined ? Buffer.from(options.secret, 'utf8') : randomBytes(32));
    this.keep = new Set(options.keep ?? KEEP_BY_DEFAULT);
    this.keepBirthDate = options.keepBirthDate ?? false;
    this.minConfidence = options.minConfidence ?? 'medium';
    if (options.custom?.length) checkCustomRules(options.custom);
    this.custom = options.custom ?? [];
  }

  /** Replaces every piece of personal data in a text: a CSV, an SQL dump, JSON, a log, or prose. */
  text(input: string): KembaranResult {
    return this.replaceMatches(input, this.detect(input));
  }

  /**
   * The files of one database or export, with one set of stand-ins: an SQL dump and the CSV files made from it. On
   * top of what `text` does for each, a real value found in any of them is replaced wherever it appears, no stand-in
   * is a real value of the input, and `leaked` counts the real values left.
   */
  texts(inputs: readonly string[]): KembaranTextsResult {
    const found = inputs.map((t) => this.detect(t));
    const digits = new Map<string, PiiType>();
    const emails = new Set<string>();
    const names = new Set<string>();
    for (const matches of found) {
      for (const m of matches) {
        if (this.keep.has(m.type)) continue;
        if (CROSS_DIGITS.has(m.type) || m.type === 'NAME') {
          const set = this.originals.get(m.type) ?? new Set<string>();
          this.originals.set(m.type, set);
          set.add(this.canon(m.type, m.value));
        }
        if (CROSS_DIGITS.has(m.type)) {
          const d = onlyDigits(m.value);
          if (d.length >= 8 && !digits.has(digitKey(m.type, d))) digits.set(digitKey(m.type, d), m.type);
        } else if (m.type === 'EMAIL') emails.add(m.value.toLowerCase());
        else if (m.type === 'NAME') {
          const core = this.nameCore(m.value);
          if (core.length >= 2 && core.every((w) => NAME_WORD.test(w))) names.add(core.map((w) => w.toLowerCase()).join(' '));
        }
      }
    }
    // A backstop that does not depend on the detector: any run of 16 digits, however it is separated, that is a valid
    // NIK by its structure is taken for one, replaced, and counted if it is left. A NIK the detector misses ("3276.0101.
    // 0180.0001" before 0.17.0) must never pass through an "anonymized" file unseen.
    if (!this.keep.has('NIK')) {
      for (const input of inputs) {
        for (const m of input.matchAll(DIGIT_RUN)) {
          const d = onlyDigits(m[0]);
          if (d.length !== 16 || digits.has(d) || !parseNik(d).valid) continue;
          digits.set(d, 'NIK');
          const set = this.originals.get('NIK') ?? new Set<string>();
          this.originals.set('NIK', set);
          set.add(this.canon('NIK', d));
        }
      }
    }
    // Longest first, so "Budi Santoso Wijaya" is replaced whole before "Budi Santoso".
    const nameRe = names.size
      ? new RegExp(
        `(?<![A-Za-z0-9])(?:${[...names].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).map((n) => n.split(' ').map(escapeRe).join('[ \\t]+')).join('|')})(?![A-Za-z0-9])`,
        'gi',
      )
      : undefined;
    // What in a text is a real value of the inputs: its type and where it is.
    const realValues = (text: string) => {
      const hits: Array<{ type: PiiType; start: number; end: number; value: string }> = [];
      for (const m of text.matchAll(DIGIT_RUN)) {
        const d = onlyDigits(m[0]);
        let type = digits.get(d);
        if (type === undefined && d.startsWith('62') && digits.get(`0${d.slice(2)}`) === 'PHONE') type = 'PHONE';
        if (type !== undefined) hits.push({ type, start: m.index, end: m.index + m[0].length, value: m[0] });
      }
      for (const m of text.matchAll(EMAIL_RUN)) {
        if (emails.has(m[0].toLowerCase())) hits.push({ type: 'EMAIL', start: m.index, end: m.index + m[0].length, value: m[0] });
      }
      if (nameRe) for (const m of text.matchAll(nameRe)) hits.push({ type: 'NAME', start: m.index, end: m.index + m[0].length, value: m[0] });
      hits.sort((a, b) => a.start - b.start || b.end - a.end);
      const kept: typeof hits = [];
      for (const h of hits) if (!kept.length || h.start >= kept.at(-1)!.end) kept.push(h);
      return kept;
    };
    const files = inputs.map((input, i) => {
      const first = this.replaceMatches(input, found[i]!);
      const crossed: Partial<Record<PiiType, number>> = {};
      let text = '';
      let cursor = 0;
      for (const h of realValues(first.text)) {
        text += first.text.slice(cursor, h.start) + this.value(h.type, h.value);
        cursor = h.end;
        crossed[h.type] = (crossed[h.type] ?? 0) + 1;
      }
      return { text: text + first.text.slice(cursor), replaced: first.replaced, crossed };
    });
    return { files, leaked: files.reduce((n, f) => n + realValues(f.text).length, 0) };
  }

  private detect(input: string) {
    return detectPii(input, { minConfidence: this.minConfidence, exclude: [...this.keep], custom: this.custom });
  }

  private replaceMatches(input: string, matches: ReturnType<typeof detectPii>): KembaranResult {
    const lineStarts = [0];
    for (let i = input.indexOf('\n'); i >= 0; i = input.indexOf('\n', i + 1)) lineStarts.push(i + 1);
    const lineOf = (pos: number) => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid]! <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    // NIKs first, so a birth date on the same line can follow the stand-in NIK.
    const out: string[] = new Array(matches.length);
    const rowDays = new Map<number, Day>();
    matches.forEach((m, i) => {
      if (m.type !== 'NIK') return;
      out[i] = this.value('NIK', m.value);
      const day = this.nikDays.get(onlyDigits(out[i]!));
      const line = lineOf(m.start);
      if (day && !rowDays.has(line)) rowDays.set(line, day);
    });
    matches.forEach((m, i) => {
      if (out[i] === undefined) out[i] = this.value(m.type, m.value, rowDays.get(lineOf(m.start)));
    });
    let text = '';
    let cursor = 0;
    const replaced: Partial<Record<PiiType, number>> = {};
    matches.forEach((m, i) => {
      text += input.slice(cursor, m.start) + out[i];
      cursor = m.end;
      replaced[m.type] = (replaced[m.type] ?? 0) + 1;
    });
    return { text: text + input.slice(cursor), replaced };
  }

  /** The stand-in for one value of a known type. */
  value(type: PiiType, original: string, rowDay?: Day): string {
    if (this.keep.has(type)) return original;
    const canon = this.canon(type, original);
    if (type === 'BIRTH_DATE' && rowDay && !this.keepBirthDate) return this.birthDate(original, new Stream(this.key, 'BIRTH_DATE|row'), rowDay);
    const cacheKey = `${type}|${canon}`;
    const cached = this.fakes.get(cacheKey);
    if (cached !== undefined) return this.render(type, original, cached);
    // "Bu Siti" in a note, where the data has one full name that starts with "Siti": the same person, so the first word
    // of that name's stand-in. With two people called Siti it could be either, and gets a stand-in of its own.
    if (type === 'NAME' && !canon.includes(' ') && canon) {
      const full = [...(this.originals.get('NAME') ?? [])].filter((n) => n.startsWith(`${canon} `));
      if (full.length === 1) {
        const first = this.value('NAME', full[0]!);
        const standIn = this.fakes.get(`NAME|${full[0]}`)?.split(' ')[0] ?? first.split(/\s+/)[0]!;
        this.fakes.set(cacheKey, standIn);
        return this.render(type, original, standIn);
      }
    }
    let fake = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      fake = this.make(type, original, canon, new Stream(this.key, `${type}|${canon}|${attempt}`));
      // A stand-in that is someone's real value in the same data would put a real person back in it.
      if (this.originals.get(type)?.has(type === 'NAME' ? fake.toLowerCase() : canonical(type, fake))) continue;
      if (!UNIQUE.has(type)) break;
      const used = this.used.get(type) ?? new Set<string>();
      this.used.set(type, used);
      if (!used.has(fake)) {
        used.add(fake);
        break;
      }
    }
    this.fakes.set(cacheKey, fake);
    return this.render(type, original, fake);
  }

  private canon(type: PiiType, value: string): string {
    return type === 'NAME' ? this.nameCore(value).map((t) => t.toLowerCase()).join(' ') : canonical(type, value);
  }

  /** The words of a name that identify the person: not honorifics, titles, or "bin". */
  private nameCore(name: string): string[] {
    return name.split(/\s+/).filter((w) => w && !NAME_KEEP.has(w.toLowerCase().replace(/[.,]/g, '')));
  }

  /** A stand-in in canonical form: digits for numbers, words joined by spaces for names. */
  private make(type: PiiType, original: string, canon: string, rng: Stream): string {
    switch (type) {
      case 'NIK': {
        const d = onlyDigits(original);
        if (d.length !== 16) return d.slice(0, 6) + rng.digits(Math.max(0, d.length - 6));
        const female = Number(d.slice(6, 8)) > 40;
        let day: Day = { day: Number(d.slice(6, 8)) - (female ? 40 : 0), month: Number(d.slice(8, 10)) };
        if (!this.keepBirthDate) day = { day: 1 + rng.int(28), month: 1 + rng.int(12) };
        const nik = d.slice(0, 6) + pad(day.day + (female ? 40 : 0)) + pad(day.month) + d.slice(10, 12) + pad(1 + rng.int(9999), 4);
        this.nikDays.set(nik, day);
        return nik;
      }
      case 'KK':
        return onlyDigits(original).slice(0, 6) + rng.digits(Math.max(0, onlyDigits(original).length - 6));
      case 'NPWP': {
        const d = onlyDigits(original);
        // An individual's NPWP is their NIK: the same person keeps one stand-in for both.
        if (d.length === 16 && d[0] !== '0') return onlyDigits(this.value('NIK', d));
        return d.slice(0, 1) + rng.digits(Math.max(0, d.length - 1));
      }
      case 'PHONE': {
        if (canon.startsWith('+62')) return canon.slice(0, 6) + rng.digits(canon.length - 6);
        const d = onlyDigits(original);
        return d.slice(0, 4) + rng.digits(Math.max(0, d.length - 4));
      }
      case 'EMAIL': {
        const female = rng.int(2) === 1;
        const first = rng.pick(female ? FEMALE_FIRST : MALE_FIRST).toLowerCase();
        const last = rng.pick(female ? FEMALE_LAST : MALE_LAST).toLowerCase();
        return `${first}.${last}${pad(rng.int(100))}`;
      }
      case 'NAME': {
        const core = this.nameCore(original);
        const lead = core.find((w) => !INITIAL.test(w))?.toLowerCase().replace(/[.,]/g, '');
        const female = lead !== undefined && FEMALE_SET.has(lead) ? true : lead !== undefined && MALE_SET.has(lead) ? false : rng.int(2) === 1;
        const words: string[] = [];
        let firstDone = false;
        for (const w of core) {
          if (INITIAL.test(w)) words.push(`${LETTERS[rng.int(26)]}.`);
          else if (!firstDone) {
            words.push(rng.pick(female ? FEMALE_FIRST : MALE_FIRST));
            firstDone = true;
          } else {
            let next = rng.pick(female ? FEMALE_LAST : MALE_LAST);
            for (let i = 0; i < 5 && words.includes(next); i++) next = rng.pick(female ? FEMALE_LAST : MALE_LAST);
            words.push(next);
          }
        }
        return words.join(' ');
      }
      case 'ADDRESS':
        return this.address(original, rng);
      case 'BIRTH_DATE':
        return this.keepBirthDate ? original : this.birthDate(original, rng);
      case 'BANK_ACCOUNT':
      case 'BPJS':
      case 'SIM':
      case 'NISN':
        return rng.digits(onlyDigits(original).length);
      case 'NIP': {
        const d = onlyDigits(original);
        return d.slice(0, 4) + rng.digits(Math.max(0, d.length - 4));
      }
      case 'CARD': {
        const d = onlyDigits(original);
        return d.length > 7 ? luhnFix(d.slice(0, 6) + rng.digits(d.length - 6)) : rng.digits(d.length);
      }
      case 'PASSPORT':
        return original.slice(0, 1) + shapeAll(original.slice(1), rng);
      case 'PLATE': {
        const m = /^([A-Za-z]{1,2})(\s*)(\d{1,4})(\s*)([A-Za-z]{0,3})$/.exec(original.trim());
        if (!m) return shapeAll(original, rng);
        const num = String(1 + rng.int(9)) + rng.digits(m[3]!.length - 1);
        const suffix = m[5]!.split('').map((c) => caseLike(LETTERS[rng.int(26)]!, c)).join('');
        return `${m[1]}${m[2]}${num}${m[4]}${suffix}`;
      }
      case 'IP':
        if (original.includes(':')) return `2001:db8::${rng.int(65536).toString(16)}:${rng.int(65536).toString(16)}`;
        return `${rng.pick(['192.0.2', '198.51.100', '203.0.113'])}.${1 + rng.int(254)}`;
      case 'GEO':
        return original.replace(/(\.\d{2})(\d+)/g, (_, keep: string, rest: string) => keep + rng.digits(rest.length));
      case 'FINANCIAL':
      case 'AKTA':
        return shapeDigits(original, rng);
      case 'HEALTH':
        return caseLike(rng.pick(HEALTH), original);
      case 'CRIMINAL_RECORD':
        return caseLike('Tidak ada catatan', original);
      case 'BIOMETRIC': {
        const dot = original.lastIndexOf('.');
        const ext = dot > 0 && original.length - dot <= 5 ? original.slice(dot) : '';
        return shapeAll(original.slice(0, original.length - ext.length), rng) + ext;
      }
      case 'GENDER':
        return original.trim().length === 1 ? rng.pick(['L', 'P']) : rng.pick(['Laki-laki', 'Perempuan']);
      case 'RELIGION':
        return rng.pick(RELIGIONS);
      case 'MARITAL_STATUS':
        return rng.pick(MARITAL);
      case 'NATIONALITY':
        return 'WNI';
      default:
        return shapeAll(original, rng);
    }
  }

  /** A stand-in in the original's format: its separators, its casing, its titles. */
  private render(type: PiiType, original: string, fake: string): string {
    switch (type) {
      case 'NIK':
      case 'KK':
      case 'NPWP':
      case 'BANK_ACCOUNT':
      case 'BPJS':
      case 'SIM':
      case 'NIP':
      case 'NISN':
      case 'CARD':
        return putDigits(original, fake);
      case 'PHONE': {
        if (!fake.startsWith('+62')) return putDigits(original, fake);
        const d = onlyDigits(original);
        const digits = d.startsWith('0') ? `0${fake.slice(3)}` : d.startsWith('62') ? fake.slice(1) : fake.slice(3);
        return putDigits(original, digits);
      }
      case 'EMAIL':
        return original.includes('@') ? `${fake}@example.com` : `${fake} [at] example [dot] com`;
      case 'NAME': {
        const words = fake.split(' ');
        let i = 0;
        return original
          .split(/(\s+)/)
          .map((part) => {
            if (!part || /^\s+$/.test(part) || NAME_KEEP.has(part.toLowerCase().replace(/[.,]/g, ''))) return part;
            const word = words[i++] ?? part;
            const trail = /[,]$/.test(part) ? ',' : '';
            return caseLike(word, part.replace(/[,]$/, '')) + trail;
          })
          .join('');
      }
      default:
        return fake;
    }
  }

  private address(original: string, rng: Stream): string {
    const comma = original.indexOf(',');
    const head = comma < 0 ? original : original.slice(0, comma);
    const tail = comma < 0 ? '' : original.slice(comma);
    const street = head.replace(STREET, (_, kind: string, gap: string, name: string) => kind + gap + caseLike(rng.pick(STREETS), name));
    return shapeDigits(street, rng) + tail;
  }

  private birthDate(original: string, rng: Stream, rowDay?: Day): string {
    if (EXCEL_SERIAL.test(original.trim())) {
      const date = new Date(Date.UTC(1899, 11, 30) + Number(original.trim()) * 86400000);
      const day = rowDay ?? { day: 1 + rng.int(28), month: 1 + rng.int(12) };
      return String(Math.round((Date.UTC(date.getUTCFullYear(), day.month - 1, day.day) - Date.UTC(1899, 11, 30)) / 86400000));
    }
    const pick = () => rowDay ?? { day: 1 + rng.int(28), month: 1 + rng.int(12) };
    const width = (s: string, n: number) => (s.length >= 2 ? pad(n) : String(n));
    let m = DMY.exec(original);
    if (m) {
      const d = pick();
      return original.replace(DMY, `${width(m[1]!, d.day)}${m[2]}${width(m[3]!, d.month)}${m[2]}${m[4]}`);
    }
    m = YMD.exec(original);
    if (m) {
      const d = pick();
      return original.replace(YMD, `${m[1]}${m[2]}${width(m[3]!, d.month)}${m[2]}${width(m[4]!, d.day)}`);
    }
    m = D_NAME_Y.exec(original);
    if (m) {
      const d = pick();
      const word = m[3]!.toLowerCase();
      const family = MONTHS.find((names) => names.includes(word)) ?? MONTHS[2]!;
      const name = family[d.month - 1]!;
      const styled = caseLike(name.charAt(0).toUpperCase() + name.slice(1), m[3]!);
      return original.replace(D_NAME_Y, `${width(m[1]!, d.day)}${m[2]}${styled}${m[4]}${m[5]}`);
    }
    return original;
  }
}

/** One-shot: replaces personal data in a text with stand-ins under a random secret. */
export function kembaran(text: string, options: KembaranOptions = {}): KembaranResult {
  return new Kembaran(options).text(text);
}
