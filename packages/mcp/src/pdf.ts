// Minimal PDF text reader for scanning and masking, without dependencies.
// It covers PDFs that a program wrote: invoices, letters, statements, forms, and reports from browsers, Word, and PDF
// libraries. It reads every object (also inside object streams), decodes Flate, ASCII85, and ASCIIHex streams, and
// turns each page's text operators into lines, using the font's ToUnicode map or its encoding, and glyph widths to
// tell word gaps from kerning and table columns. Filled-in form fields, stamps, and comments are read as well. A
// scanned page has no text operators, so it comes back empty and the caller reports it as needing OCR. Encrypted
// PDFs throw.
import { constants, inflateRawSync, inflateSync } from 'node:zlib';
import type { Sheet } from './xlsx.ts';

class Name {
  readonly v: string;
  constructor(v: string) {
    this.v = v;
  }
}
/** A PDF string: its bytes as a latin1 string. */
class Str {
  readonly v: string;
  constructor(v: string) {
    this.v = v;
  }
}
class Ref {
  readonly num: number;
  readonly gen: number;
  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }
}
class Op {
  readonly v: string;
  constructor(v: string) {
    this.v = v;
  }
}
class Stream {
  readonly dict: Dict;
  readonly raw: Buffer;
  /** The file ends inside this stream: a cut-off download or a partial copy. */
  readonly truncated: boolean;
  constructor(dict: Dict, raw: Buffer, truncated = false) {
    this.dict = dict;
    this.raw = raw;
    this.truncated = truncated;
  }
}
type Dict = Map<string, Value>;
type Value = number | boolean | null | Name | Str | Ref | Op | Stream | Dict | Value[];

const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
// ( ) < > [ ] { } / %
const isDelim = (c: number) =>
  c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const MAX_DEPTH = 64;

class Lexer {
  pos = 0;
  readonly s: string;
  constructor(s: string) {
    this.s = s;
  }

  skip(): void {
    const s = this.s;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (c === 37) {
        while (this.pos < s.length && s[this.pos] !== '\n' && s[this.pos] !== '\r') this.pos++;
      } else if (isSpace(c)) this.pos++;
      else break;
    }
  }

  private regular(): string {
    const start = this.pos;
    while (this.pos < this.s.length) {
      const c = this.s.charCodeAt(this.pos);
      if (isSpace(c) || isDelim(c)) break;
      this.pos++;
    }
    return this.s.slice(start, this.pos);
  }

  /** The next value or operator, or undefined at the end. */
  value(depth = 0): Value | undefined {
    if (depth > MAX_DEPTH) throw new Error('PDF nesting too deep.');
    this.skip();
    const s = this.s;
    if (this.pos >= s.length) return undefined;
    const c = s[this.pos]!;
    if (c === '/') {
      this.pos++;
      return new Name(this.regular().replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
    }
    if (c === '(') return this.literal();
    if (c === '<') {
      if (s[this.pos + 1] === '<') {
        this.pos += 2;
        const dict: Dict = new Map();
        for (;;) {
          this.skip();
          if (this.pos >= s.length) break;
          if (s[this.pos] === '>' && s[this.pos + 1] === '>') {
            this.pos += 2;
            break;
          }
          const key = this.value(depth + 1);
          if (key === undefined) break;
          if (!(key instanceof Name)) continue;
          const val = this.value(depth + 1);
          if (val === undefined) break;
          dict.set(key.v, val);
        }
        return dict;
      }
      const close = s.indexOf('>', this.pos);
      const hex = s.slice(this.pos + 1, close < 0 ? s.length : close).replace(/[^0-9A-Fa-f]/g, '');
      this.pos = close < 0 ? s.length : close + 1;
      let bytes = '';
      for (let i = 0; i < hex.length; i += 2) bytes += String.fromCharCode(parseInt(hex.slice(i, i + 2).padEnd(2, '0'), 16));
      return new Str(bytes);
    }
    if (c === '[') {
      this.pos++;
      const arr: Value[] = [];
      for (;;) {
        this.skip();
        if (this.pos >= s.length) break;
        if (s[this.pos] === ']') {
          this.pos++;
          break;
        }
        const v = this.value(depth + 1);
        if (v === undefined) break;
        arr.push(v);
      }
      return arr;
    }
    const token = this.regular();
    if (!token) {
      // A stray delimiter: ")", ">", "]", "{" or "}".
      this.pos++;
      return new Op(c);
    }
    if (NUMBER.test(token)) {
      const n = Number(token);
      if (/^\d+$/.test(token)) {
        // "12 0 R" is a reference.
        const save = this.pos;
        this.skip();
        const gen = this.regular();
        if (/^\d+$/.test(gen)) {
          this.skip();
          if (s[this.pos] === 'R' && (this.pos + 1 >= s.length || isSpace(s.charCodeAt(this.pos + 1)) || isDelim(s.charCodeAt(this.pos + 1)))) {
            this.pos++;
            return new Ref(n, Number(gen));
          }
        }
        this.pos = save;
      }
      return n;
    }
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    return new Op(token);
  }

  private literal(): Str {
    const s = this.s;
    let depth = 1;
    let out = '';
    this.pos++;
    while (this.pos < s.length) {
      const c = s[this.pos++]!;
      if (c === '\\') {
        const n = s[this.pos++];
        if (n === undefined) break;
        if (n >= '0' && n <= '7') {
          let oct = n;
          while (oct.length < 3 && s[this.pos]! >= '0' && s[this.pos]! <= '7') oct += s[this.pos++];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (n === '\r') {
          if (s[this.pos] === '\n') this.pos++;
        } else if (n !== '\n') {
          out += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[n] ?? n;
        }
      } else if (c === '(') {
        depth++;
        out += c;
      } else if (c === ')') {
        if (--depth === 0) break;
        out += c;
      } else out += c;
    }
    return new Str(out);
  }
}

/** Decompressed streams above this are cut off: a few KB of Flate can expand to gigabytes. */
const MAX_STREAM_BYTES = 64 * 1024 * 1024;

function ascii85(data: string): Buffer {
  const out: number[] = [];
  let group: number[] = [];
  const body = data.replace(/^\s*<~/, '');
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '~') break;
    if (ch === 'z' && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 33 || code > 117) continue;
    group.push(code - 33);
    if (group.length === 5) {
      const n = group.reduce((acc, d) => acc * 85 + d, 0);
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const size = group.length;
    while (group.length < 5) group.push(84);
    const n = group.reduce((acc, d) => acc * 85 + d, 0);
    out.push(...[(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].slice(0, size - 1));
  }
  return Buffer.from(out);
}

function inflate(data: Buffer): Buffer {
  // A truncated stream keeps what decompresses; some writers leave out the zlib header (raw deflate).
  const options = { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: MAX_STREAM_BYTES };
  const tooLarge = (e: unknown) => (e instanceof RangeError ? new Error('A PDF stream is too large to decompress.') : e);
  try {
    return inflateSync(data, options);
  } catch (e) {
    if (e instanceof RangeError) throw tooLarge(e);
    try {
      return inflateRawSync(data, options);
    } catch (raw) {
      throw raw instanceof RangeError ? tooLarge(raw) : e;
    }
  }
}

class Pdf {
  private readonly objects = new Map<number, { value: Value; at: number }>();
  private readonly decoded = new Map<Stream, string>();
  private readonly fonts = new Map<Dict, Font>();
  readonly truncated = new Set<Dict>();
  trailers: Dict[] = [];

  constructor(buf: Buffer) {
    const s = buf.toString('latin1');
    const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
    for (let m = objRe.exec(s); m; m = objRe.exec(s)) {
      const lx = new Lexer(s);
      lx.pos = objRe.lastIndex;
      let value: Value | undefined;
      try {
        value = lx.value();
      } catch {
        continue;
      }
      if (value === undefined) break;
      lx.skip();
      // The file ends inside this object: a page cut off here may have lost its /Contents.
      if (lx.pos >= s.length && value instanceof Map) this.truncated.add(value);
      if (value instanceof Map && s.startsWith('stream', lx.pos)) {
        let start = lx.pos + 6;
        if (s[start] === '\r') start++;
        if (s[start] === '\n') start++;
        const length = value.get('Length');
        let end = -1;
        if (typeof length === 'number' && Number.isInteger(length) && length >= 0 && start + length <= s.length) {
          const after = s.slice(start + length, start + length + 32);
          if (/^\s*endstream/.test(after)) end = start + length;
        }
        let truncated = false;
        if (end < 0) {
          // An indirect or wrong /Length: the data ends at "endstream".
          end = s.indexOf('endstream', start);
          if (end < 0) {
            end = s.length;
            truncated = true;
          }
          if (s[end - 1] === '\n') end--;
          if (s[end - 1] === '\r') end--;
        }
        value = new Stream(value, buf.subarray(start, Math.max(start, end)), truncated);
        objRe.lastIndex = Math.max(end, start);
      } else {
        objRe.lastIndex = Math.max(objRe.lastIndex, lx.pos);
      }
      if (value instanceof Stream && this.nameOf(value.dict.get('Type')) === 'XRef') this.trailers.push(value.dict);
      // A later definition replaces an earlier one, as in an incremental update.
      this.objects.set(Number(m[1]), { value, at: m.index });
    }
    for (const m of s.matchAll(/trailer\s*<</g)) {
      const lx = new Lexer(s);
      lx.pos = m.index + 7;
      const t = lx.value();
      if (t instanceof Map) this.trailers.push(t);
    }
    if (this.trailers.some((t) => t.has('Encrypt'))) throw new Error('The PDF is encrypted (password-protected).');
    this.expandObjectStreams();
  }

  private expandObjectStreams(): void {
    for (const [, { value, at }] of [...this.objects]) {
      if (!(value instanceof Stream) || this.nameOf(value.dict.get('Type')) !== 'ObjStm') continue;
      let data: string;
      try {
        data = this.data(value);
      } catch {
        continue;
      }
      const n = this.num(value.dict.get('N'));
      const first = this.num(value.dict.get('First'));
      const lx = new Lexer(data);
      const header: number[] = [];
      for (let i = 0; i < 2 * n; i++) {
        const v = lx.value();
        if (typeof v !== 'number') break;
        header.push(v);
      }
      for (let i = 0; i + 1 < header.length; i += 2) {
        const num = header[i]!;
        const pos = first + header[i + 1]!;
        if (!Number.isInteger(num) || !Number.isInteger(pos) || pos < 0) continue;
        const existing = this.objects.get(num);
        if (existing && existing.at > at) continue;
        const ox = new Lexer(data);
        ox.pos = pos;
        try {
          const v = ox.value();
          if (v !== undefined) this.objects.set(num, { value: v, at });
        } catch {
          // Skip a damaged object.
        }
      }
    }
  }

  resolve(v: Value | undefined): Value | undefined {
    for (let i = 0; i < 32 && v instanceof Ref; i++) v = this.objects.get(v.num)?.value;
    return v instanceof Ref ? undefined : v;
  }

  dict(v: Value | undefined): Dict | undefined {
    const r = this.resolve(v);
    if (r instanceof Stream) return r.dict;
    return r instanceof Map ? r : undefined;
  }

  nameOf(v: Value | undefined): string | undefined {
    const r = this.resolve(v);
    return r instanceof Name ? r.v : undefined;
  }

  num(v: Value | undefined, fallback = 0): number {
    const r = this.resolve(v);
    return typeof r === 'number' ? r : fallback;
  }

  /** A stream's decoded bytes, as a latin1 string. */
  data(stream: Stream): string {
    const cached = this.decoded.get(stream);
    if (cached !== undefined) return cached;
    const filters = this.resolve(stream.dict.get('Filter'));
    const list = (Array.isArray(filters) ? filters : filters === undefined ? [] : [filters]).map((f) => this.nameOf(f));
    let buf: Buffer = stream.raw;
    for (const f of list) {
      if (f === 'FlateDecode' || f === 'Fl') buf = inflate(buf);
      else if (f === 'ASCII85Decode' || f === 'A85') buf = ascii85(buf.toString('latin1'));
      else if (f === 'ASCIIHexDecode' || f === 'AHx') buf = Buffer.from(buf.toString('latin1').replace(/>[\s\S]*$/, '').replace(/[^0-9A-Fa-f]/g, ''), 'hex');
      else throw new Error(`Unsupported PDF filter ${f}.`);
    }
    const out = buf.toString('latin1');
    this.decoded.set(stream, out);
    return out;
  }

  /** Pages in reading order, each with the resources it inherits. */
  pages(): Array<{ page: Dict; resources: Dict | undefined }> {
    const out: Array<{ page: Dict; resources: Dict | undefined }> = [];
    const seen = new Set<Dict>();
    const walk = (node: Dict | undefined, inherited: Dict | undefined, depth: number) => {
      if (!node || seen.has(node) || depth > 64 || out.length >= 10000) return;
      seen.add(node);
      const resources = this.dict(node.get('Resources')) ?? inherited;
      const kids = this.resolve(node.get('Kids'));
      if (Array.isArray(kids)) for (const k of kids) walk(this.dict(k), resources, depth + 1);
      else out.push({ page: node, resources });
    };
    for (const t of [...this.trailers].reverse()) {
      const catalog = this.dict(t.get('Root'));
      if (catalog) {
        walk(this.dict(catalog.get('Pages')), undefined, 0);
        if (out.length) return out;
      }
    }
    // No usable trailer (a damaged file): every page object in number order.
    for (const [, { value }] of [...this.objects].sort((a, b) => a[0] - b[0])) {
      const d = value instanceof Map ? value : undefined;
      if (d && this.nameOf(d.get('Type')) === 'Page') out.push({ page: d, resources: this.dict(d.get('Resources')) });
    }
    return out;
  }

  font(ref: Value | undefined): Font | undefined {
    const dict = this.dict(ref);
    if (!dict) return undefined;
    let font = this.fonts.get(dict);
    if (!font) {
      font = new Font(this, dict);
      this.fonts.set(dict, font);
    }
    return font;
  }
}

// ------------------------------------------------------------------------------------------------ fonts

const decodeTable = (label: string): string[] => {
  try {
    const dec = new TextDecoder(label);
    return Array.from({ length: 256 }, (_, i) => dec.decode(new Uint8Array([i])));
  } catch {
    return Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
  }
};
const WIN_ANSI = decodeTable('windows-1252');
const MAC_ROMAN = decodeTable('macintosh');
const STANDARD = WIN_ANSI.map((c, i) => (i === 39 ? '\u2019' : i === 96 ? '\u2018' : c));

// Glyph names that /Differences arrays use, besides single letters and uniXXXX.
const GLYPHS: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'",
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
  backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|',
  braceright: '}', asciitilde: '~', bullet: '\u2022', endash: '\u2013', emdash: '\u2014', quoteleft: '\u2018',
  quoteright: '\u2019', quotedblleft: '\u201c', quotedblright: '\u201d', quotesinglbase: '\u201a',
  quotedblbase: '\u201e', ellipsis: '\u2026', Euro: '\u20ac', minus: '\u2212', nbspace: '\u00a0', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', f_i: 'fi', f_l: 'fl', f_f: 'ff',
  degree: '\u00b0', copyright: '\u00a9', registered: '\u00ae', trademark: '\u2122', section: '\u00a7',
  paragraph: '\u00b6', periodcentered: '\u00b7', multiply: '\u00d7', divide: '\u00f7', plusminus: '\u00b1',
};
const ACCENTED = /^([A-Za-z])(acute|grave|circumflex|dieresis|tilde|ring|cedilla|caron)$/;
const COMBINING: Record<string, string> = {
  acute: '\u0301', grave: '\u0300', circumflex: '\u0302', dieresis: '\u0308', tilde: '\u0303', ring: '\u030a',
  cedilla: '\u0327', caron: '\u030c',
};

function glyphToUnicode(name: string): string | undefined {
  if (Object.hasOwn(GLYPHS, name)) return GLYPHS[name]; // not "constructor" from the prototype
  if (/^[A-Za-z]$/.test(name)) return name;
  let m = /^uni([0-9A-Fa-f]{4})+$/.exec(name);
  if (m) return String.fromCharCode(...name.slice(3).match(/.{4}/g)!.map((h) => parseInt(h, 16)));
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) {
    const cp = parseInt(m[1]!, 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : undefined;
  }
  m = ACCENTED.exec(name);
  if (m) return (m[1]! + COMBINING[m[2]!]!).normalize('NFC');
  const dot = name.indexOf('.');
  if (dot > 0) return glyphToUnicode(name.slice(0, dot)); // "a.sc", "one.oldstyle"
  return undefined;
}

function utf16be(bytes: string): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1));
  return out;
}

function bytesToInt(bytes: string): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) n = n * 256 + bytes.charCodeAt(i);
  return n;
}

function intToBytes(n: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out = String.fromCharCode(n % 256) + out;
    n = Math.floor(n / 256);
  }
  return out;
}

/** A ToUnicode CMap: code bytes to text, plus the code space that says how many bytes each code takes. */
function parseCMap(text: string): { map: Map<string, string>; ranges: Array<[string, string]> } {
  const map = new Map<string, string>();
  const ranges: Array<[string, string]> = [];
  const lx = new Lexer(text);
  const operands: Value[] = [];
  for (let v = lx.value(); v !== undefined; v = lx.value()) {
    if (!(v instanceof Op)) {
      operands.push(v);
      continue;
    }
    if (v.v === 'endcodespacerange') {
      for (let i = 0; i + 1 < operands.length; i += 2) {
        const [lo, hi] = [operands[i], operands[i + 1]];
        if (lo instanceof Str && hi instanceof Str && lo.v.length === hi.v.length) ranges.push([lo.v, hi.v]);
      }
    } else if (v.v === 'endbfchar') {
      for (let i = 0; i + 1 < operands.length; i += 2) {
        const [src, dst] = [operands[i], operands[i + 1]];
        if (src instanceof Str && dst instanceof Str) map.set(src.v, utf16be(dst.v));
        else if (src instanceof Str && dst instanceof Name) map.set(src.v, glyphToUnicode(dst.v) ?? '');
      }
    } else if (v.v === 'endbfrange') {
      for (let i = 0; i + 2 < operands.length; i += 3) {
        const [lo, hi, dst] = [operands[i], operands[i + 1], operands[i + 2]];
        if (!(lo instanceof Str && hi instanceof Str)) continue;
        const from = bytesToInt(lo.v);
        const to = Math.min(bytesToInt(hi.v), from + 0xffff);
        for (let code = from; code <= to; code++) {
          const key = intToBytes(code, lo.v.length);
          if (Array.isArray(dst)) {
            const d = dst[code - from];
            if (d instanceof Str) map.set(key, utf16be(d.v));
          } else if (dst instanceof Str && dst.v.length >= 2) {
            // The last code unit counts up through the range.
            const base = utf16be(dst.v);
            map.set(key, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + code - from));
          }
        }
      }
    }
    if (v.v.startsWith('end') || v.v.startsWith('begin')) operands.length = 0;
  }
  return { map, ranges };
}

class Font {
  private readonly toUnicode?: Map<string, string>;
  private readonly ranges: Array<[string, string]> = [];
  private readonly composite: boolean;
  private readonly encoding: string[];
  private readonly widths = new Map<number, number>();
  private readonly defaultWidth: number;

  constructor(pdf: Pdf, dict: Dict) {
    this.composite = pdf.nameOf(dict.get('Subtype')) === 'Type0';
    const tu = pdf.resolve(dict.get('ToUnicode'));
    if (tu instanceof Stream) {
      try {
        this.toUnicode = parseCMap(pdf.data(tu)).map;
      } catch {
        // Fall back to the encoding.
      }
    }
    let encoding = WIN_ANSI;
    const enc = pdf.resolve(dict.get('Encoding'));
    // How many bytes a code takes comes from the font's own CMap, not from ToUnicode: generators often declare a
    // two-byte code space there for one-byte fonts. Simple fonts use one byte; Identity-H and most CMaps two.
    if (this.composite && enc instanceof Stream) {
      try {
        this.ranges = parseCMap(pdf.data(enc)).ranges;
      } catch {
        // Two-byte codes.
      }
    }
    const named = (n: string | undefined) => (n === 'MacRomanEncoding' ? MAC_ROMAN : n === 'StandardEncoding' ? STANDARD : WIN_ANSI);
    if (enc instanceof Name) encoding = named(enc.v);
    else if (enc instanceof Map) {
      encoding = [...named(pdf.nameOf(enc.get('BaseEncoding')))];
      const diffs = pdf.resolve(enc.get('Differences'));
      if (Array.isArray(diffs)) {
        let code = 0;
        for (const d of diffs) {
          if (typeof d === 'number') code = d;
          else if (d instanceof Name) {
            if (code >= 0 && code < 256) encoding[code] = glyphToUnicode(d.v) ?? '';
            code++;
          }
        }
      }
    }
    this.encoding = encoding;

    if (this.composite) {
      const descendants = pdf.resolve(dict.get('DescendantFonts'));
      const cid = pdf.dict(Array.isArray(descendants) ? descendants[0] : undefined);
      this.defaultWidth = pdf.num(cid?.get('DW'), 1000);
      const w = pdf.resolve(cid?.get('W'));
      if (Array.isArray(w)) {
        for (let i = 0; i < w.length; ) {
          const first = pdf.num(w[i]);
          const next = pdf.resolve(w[i + 1]);
          if (Array.isArray(next)) {
            next.forEach((width, j) => this.widths.set(first + j, pdf.num(width)));
            i += 2;
          } else {
            const last = pdf.num(next);
            const width = pdf.num(w[i + 2]);
            for (let c = first; c <= last && c - first < 0x10000; c++) this.widths.set(c, width);
            i += 3;
          }
        }
      }
    } else {
      const first = pdf.num(dict.get('FirstChar'));
      const widths = pdf.resolve(dict.get('Widths'));
      if (Array.isArray(widths)) widths.forEach((w, i) => this.widths.set(first + i, pdf.num(w)));
      const descriptor = pdf.dict(dict.get('FontDescriptor'));
      const base = pdf.nameOf(dict.get('BaseFont')) ?? '';
      // The standard 14 fonts come without widths; an average glyph is about half an em, Courier 0.6.
      this.defaultWidth = pdf.num(descriptor?.get('MissingWidth'), 0) || (/Courier/.test(base) ? 600 : 500);
    }
  }

  /** Splits a string into character codes. */
  codes(bytes: string): string[] {
    const out: string[] = [];
    if (!this.composite) {
      for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
      return out;
    }
    for (let i = 0; i < bytes.length; ) {
      let len = 0;
      for (let n = 1; n <= 4 && !len; n++) {
        const code = bytes.slice(i, i + n);
        if (code.length === n && this.ranges.some(([lo, hi]) => lo.length === n && code >= lo && code <= hi)) len = n;
      }
      if (!len) len = this.composite ? 2 : 1;
      out.push(bytes.slice(i, i + len));
      i += len;
    }
    return out;
  }

  text(code: string): string {
    // Some ToUnicode maps write one-byte codes with two bytes.
    const mapped = this.toUnicode?.get(code) ?? (code.length === 1 ? this.toUnicode?.get(`\0${code}`) : undefined);
    if (mapped !== undefined) return mapped;
    if (code.length === 1) return this.encoding[code.charCodeAt(0)] ?? '';
    return '';
  }

  width(code: string): number {
    return this.widths.get(bytesToInt(code)) ?? this.defaultWidth;
  }
}

// ------------------------------------------------------------------------------------------------ text

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

class TextWriter {
  out = '';
  /** Text was shown in a font the file does not have (it was cut off or damaged). */
  missingFont = false;
  private last?: { x: number; y: number; size: number };

  /** Text drawn from (x0, y0) to (x1, y1) in device space, at an effective font size. */
  add(text: string, x0: number, y0: number, x1: number, y1: number, size: number): void {
    if (!text) return;
    const last = this.last;
    if (last && this.out) {
      const tolerance = Math.max(size, last.size) * 0.5;
      const end = this.out.charCodeAt(this.out.length - 1);
      if (Math.abs(y0 - last.y) > tolerance) {
        if (end !== 10) this.out += '\n';
      } else {
        const gap = x0 - last.x;
        // Word gaps are about a quarter em (more in justified text); kerning and rounding are far smaller. A gap of most
        // of an em separates table columns, even tight ones with only their cell padding between them.
        if ((gap > size * 0.15 || gap < -size) && end !== 32 && end !== 9 && end !== 10 && text[0] !== ' ') {
          this.out += gap > size * 0.8 ? '\t' : ' ';
        }
      }
    }
    this.out += text;
    this.last = { x: x1, y: y1, size };
  }

  breakLine(): void {
    if (this.out && !this.out.endsWith('\n')) this.out += '\n';
    this.last = undefined;
  }

  /** A line of its own, such as a form field. */
  line(text: string): void {
    if (!text) return;
    this.breakLine();
    this.out += `${text}\n`;
  }
}

/** A PDF text string (names, form values, comments): UTF-16BE or UTF-8 with a byte order mark, else Latin-1. */
function textString(bytes: string): string {
  if (bytes.startsWith('\xfe\xff')) return utf16be(bytes.slice(2));
  if (bytes.startsWith('\xef\xbb\xbf')) return Buffer.from(bytes.slice(3), 'latin1').toString('utf8');
  return bytes;
}

/** A filled-in form field as "name: value", with the name taken from the field and its parents. */
function fieldLine(pdf: Pdf, widget: Dict): string | undefined {
  const names: string[] = [];
  let value: Value | undefined;
  let node: Dict | undefined = widget;
  for (let depth = 0; node && depth < 32; depth++) {
    const t = pdf.resolve(node.get('T'));
    if (t instanceof Str) names.unshift(textString(t.v));
    if (value === undefined && node.has('V')) value = pdf.resolve(node.get('V'));
    node = pdf.dict(node.get('Parent'));
  }
  const one = (v: Value | undefined) => (v instanceof Str ? textString(v.v) : v instanceof Name && v.v !== 'Off' ? v.v : '');
  const text = (Array.isArray(value) ? value.map((v) => one(pdf.resolve(v))).filter(Boolean).join(', ') : one(value))
    .replace(/\s*[\r\n]+\s*/g, ', ')
    .trim();
  return text ? `${names.join('.') || 'field'}: ${text}` : undefined;
}

/**
 * Text in annotations: filled-in form fields as "name: value" (the name is often a label like "nama_pemohon"), and the
 * appearance of stamps and free text, or a comment's text. A form a customer filled in holds their data only here.
 */
function annotations(pdf: Pdf, page: Dict, writer: TextWriter): void {
  const annots = pdf.resolve(page.get('Annots'));
  if (!Array.isArray(annots)) return;
  for (const ref of annots.slice(0, 5000)) {
    const a = pdf.dict(ref);
    const subtype = a && pdf.nameOf(a.get('Subtype'));
    if (!a || subtype === 'Popup' || subtype === 'Link') continue;
    if (subtype === 'Widget') {
      const field = fieldLine(pdf, a);
      if (field) writer.line(field);
      continue;
    }
    let appearance = pdf.resolve(pdf.dict(a.get('AP'))?.get('N'));
    if (appearance instanceof Map) appearance = pdf.resolve(appearance.get(pdf.nameOf(a.get('AS')) ?? ''));
    if (appearance instanceof Stream) {
      const rect = pdf.resolve(a.get('Rect'));
      const bbox = pdf.resolve(appearance.dict.get('BBox'));
      const at = (arr: Value | undefined, i: number) => (Array.isArray(arr) ? pdf.num(arr[i]) : 0);
      const ctm: Matrix = [1, 0, 0, 1, Math.min(at(rect, 0), at(rect, 2)) - at(bbox, 0), Math.min(at(rect, 1), at(rect, 3)) - at(bbox, 1)];
      writer.breakLine();
      try {
        runContent(pdf, pdf.data(appearance), pdf.dict(appearance.dict.get('Resources')), ctm, writer, 1);
      } catch {
        // Skip a damaged appearance.
      }
      writer.breakLine();
      continue;
    }
    const contents = pdf.resolve(a.get('Contents'));
    if (contents instanceof Str) writer.line(textString(contents.v).replace(/\s*[\r\n]+\s*/g, ' ').trim());
  }
}

function runContent(pdf: Pdf, content: string, resources: Dict | undefined, ctm: Matrix, writer: TextWriter, depth: number): void {
  const lx = new Lexer(content);
  const operands: Value[] = [];
  const stack: Matrix[] = [];
  let tm: Matrix = IDENTITY;
  let lm: Matrix = IDENTITY;
  let font: Font | undefined;
  let size = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let scale = 1;
  let leading = 0;
  let rise = 0;
  const fontsDict = pdf.dict(resources?.get('Font'));
  const xobjects = pdf.dict(resources?.get('XObject'));

  const moveLine = (tx: number, ty: number) => {
    lm = mul([1, 0, 0, 1, tx, ty], lm);
    tm = lm;
  };
  const show = (bytes: string) => {
    if (!font) {
      if (bytes) writer.missingFont = true;
      return;
    }
    const start = mul([1, 0, 0, 1, 0, rise], mul(tm, ctm));
    let text = '';
    for (const code of font.codes(bytes)) {
      text += font.text(code);
      const advance = ((font.width(code) / 1000) * size + charSpacing + (code === ' ' ? wordSpacing : 0)) * scale;
      tm = mul([1, 0, 0, 1, advance, 0], tm);
    }
    const end = mul(tm, ctm);
    const effective = Math.abs(size) * Math.sqrt(start[2] * start[2] + start[3] * start[3]) || 1;
    writer.add(text, start[4], start[5], end[4], end[5], effective);
  };
  const kern = (n: number) => {
    tm = mul([1, 0, 0, 1, (-n / 1000) * size * scale, 0], tm);
  };

  for (let v = lx.value(); v !== undefined; v = lx.value()) {
    if (!(v instanceof Op)) {
      if (operands.length < 64) operands.push(v);
      continue;
    }
    const n = (i: number) => (typeof operands[i] === 'number' ? (operands[i] as number) : 0);
    switch (v.v) {
      case 'q':
        if (stack.length < 64) stack.push(ctm);
        break;
      case 'Q':
        ctm = stack.pop() ?? ctm;
        break;
      case 'cm':
        ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], ctm);
        break;
      case 'BT':
        tm = lm = IDENTITY;
        break;
      case 'Tf':
        font = operands[0] instanceof Name ? pdf.font(fontsDict?.get(operands[0].v)) : undefined;
        size = n(1);
        break;
      case 'Tc':
        charSpacing = n(0);
        break;
      case 'Tw':
        wordSpacing = n(0);
        break;
      case 'Tz':
        scale = n(0) / 100;
        break;
      case 'TL':
        leading = n(0);
        break;
      case 'Ts':
        rise = n(0);
        break;
      case 'Td':
        moveLine(n(0), n(1));
        break;
      case 'TD':
        leading = -n(1);
        moveLine(n(0), n(1));
        break;
      case 'Tm':
        lm = tm = [n(0), n(1), n(2), n(3), n(4), n(5)];
        break;
      case 'T*':
        moveLine(0, -leading);
        break;
      case 'Tj':
        if (operands[0] instanceof Str) show(operands[0].v);
        break;
      case "'":
        moveLine(0, -leading);
        if (operands[0] instanceof Str) show(operands[0].v);
        break;
      case '"':
        wordSpacing = n(0);
        charSpacing = n(1);
        moveLine(0, -leading);
        if (operands[2] instanceof Str) show(operands[2].v);
        break;
      case 'TJ':
        if (Array.isArray(operands[0])) {
          for (const item of operands[0]) {
            if (item instanceof Str) show(item.v);
            else if (typeof item === 'number') kern(item);
          }
        }
        break;
      case 'Do': {
        const xobject = operands[0] instanceof Name ? pdf.resolve(xobjects?.get(operands[0].v)) : undefined;
        if (xobject instanceof Stream && pdf.nameOf(xobject.dict.get('Subtype')) === 'Form' && depth < 8) {
          const matrix = pdf.resolve(xobject.dict.get('Matrix'));
          const m: Matrix = Array.isArray(matrix) && matrix.length === 6 ? (matrix.map((x) => pdf.num(x)) as Matrix) : IDENTITY;
          let data: string | undefined;
          try {
            data = pdf.data(xobject);
          } catch {
            data = undefined;
          }
          if (data !== undefined) runContent(pdf, data, pdf.dict(xobject.dict.get('Resources')) ?? resources, mul(m, ctm), writer, depth + 1);
        }
        break;
      }
      case 'ID': {
        // Inline image data is binary: skip to "EI".
        const end = /\sEI(?=[\s]|$)/g;
        end.lastIndex = lx.pos;
        const m = end.exec(content);
        lx.pos = m ? m.index + m[0].length : content.length;
        break;
      }
    }
    operands.length = 0;
  }
}

/**
 * Each page's text; whether part of the page could not be read (its content is missing, fails to decompress, or
 * breaks off); and whether it draws nothing at all. A page without text that draws something is a scan.
 */
function extractPages(buf: Buffer): Array<{ text: string; damaged: boolean; blank: boolean }> {
  if (buf.subarray(0, 1024).indexOf('%PDF-') < 0) throw new Error('Not a PDF file.');
  const pdf = new Pdf(buf);
  const pages = pdf.pages();
  if (!pages.length) throw new Error('No pages found.');
  return pages.map(({ page, resources }) => {
    let damaged = pdf.truncated.has(page);
    const contents = pdf.resolve(page.get('Contents'));
    const list = Array.isArray(contents) ? contents.map((c) => pdf.resolve(c)) : page.has('Contents') ? [contents] : [];
    const parts: string[] = [];
    for (const s of list) {
      if (!(s instanceof Stream) || s.truncated) damaged = true;
      if (!(s instanceof Stream)) continue;
      try {
        parts.push(pdf.data(s));
      } catch {
        damaged = true;
      }
    }
    const writer = new TextWriter();
    try {
      runContent(pdf, parts.join('\n'), resources, IDENTITY, writer, 0);
    } catch {
      damaged = true; // keep the text before the damage
    }
    annotations(pdf, page, writer);
    if (writer.missingFont) damaged = true;
    const text = writer.out
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/, ''))
      .join('\n')
      .trim();
    return { text, damaged, blank: !damaged && !parts.some((p) => /\S/.test(p)) };
  });
}

/** The text of each page; a page without text (a scan) is an empty string. */
export function readPdfPages(buf: Buffer): string[] {
  return extractPages(buf).map((p) => p.text);
}

/**
 * Pages with text as parts named "Halaman 1", "Halaman 2" …; the numbers of scanned pages and of damaged ones; and
 * the page count. Blank pages are in none of the lists.
 */
export function readPdf(buf: Buffer): { pages: Sheet[]; scanned: number[]; damaged: number[]; total: number } {
  const pages: Sheet[] = [];
  const scanned: number[] = [];
  const damaged: number[] = [];
  const all = extractPages(buf);
  all.forEach(({ text, damaged: broken, blank }, i) => {
    if (text.replace(/\s/g, '')) pages.push({ name: `Halaman ${i + 1}`, csv: text });
    else if (broken) damaged.push(i + 1);
    else if (!blank) scanned.push(i + 1);
  });
  return { pages, scanned, damaged, total: all.length };
}
