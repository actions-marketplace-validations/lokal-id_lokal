// Synchronous inflate (RFC 1950 and 1951) in place of node:zlib, so the browser extension can use the .xlsx, .docx,
// and PDF readers from packages/mcp. The browser's DecompressionStream is asynchronous, and those readers are not.
// Only what the readers call is here: inflateSync, inflateRawSync, finishFlush, and maxOutputLength.
import { Buffer, type Bytes } from './buffer.ts';

export const constants = { Z_SYNC_FLUSH: 2, Z_FINISH: 4 } as const;

export interface InflateOptions {
  /** Z_SYNC_FLUSH keeps what decompresses from a stream that breaks off, as node:zlib does. */
  finishFlush?: number;
  /** Throws a RangeError when the output would grow past this, as node:zlib does. */
  maxOutputLength?: number;
}

class Truncated extends Error {}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: how many codes of each length, and the symbols in code order. */
interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function huffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16);
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]!]!++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let len = 1; len < 16; len++) offsets[len] = offsets[len - 1]! + counts[len - 1]!;
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offsets[lengths[i]!]!++] = i;
  return { counts, symbols };
}

const FIXED_LITERALS = huffman(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)));
const FIXED_DISTANCES = huffman(new Array<number>(30).fill(5));

class Inflater {
  private readonly data: Uint8Array;
  private readonly max: number;
  private pos: number;
  private bitBuffer = 0;
  private bitCount = 0;
  private out: Uint8Array;
  length = 0;

  constructor(data: Uint8Array, start: number, max: number) {
    this.data = data;
    this.max = max;
    this.pos = start;
    this.out = new Uint8Array(Math.min(max, Math.max(1024, data.length * 4)));
  }

  output(): Uint8Array {
    return this.out.subarray(0, this.length);
  }

  private bits(n: number): number {
    while (this.bitCount < n) {
      if (this.pos >= this.data.length) throw new Truncated();
      this.bitBuffer |= this.data[this.pos++]! << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << n) - 1);
    this.bitBuffer >>>= n;
    this.bitCount -= n;
    return value;
  }

  private decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.bits(1);
      const count = h.counts[len]!;
      if (code - count < first) return h.symbols[index + (code - first)]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('invalid code');
  }

  private push(byte: number): void {
    if (this.length === this.out.length) {
      if (this.length >= this.max) throw new RangeError('Cannot create a Buffer larger than maxOutputLength');
      const bigger = new Uint8Array(Math.min(this.max, this.out.length * 2));
      bigger.set(this.out);
      this.out = bigger;
    }
    this.out[this.length++] = byte;
  }

  private stored(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
    if (this.pos + 4 > this.data.length) throw new Truncated();
    const len = this.data[this.pos]! | (this.data[this.pos + 1]! << 8);
    const nlen = this.data[this.pos + 2]! | (this.data[this.pos + 3]! << 8);
    if (len !== (~nlen & 0xffff)) throw new Error('invalid stored block lengths');
    this.pos += 4;
    for (let i = 0; i < len; i++) {
      if (this.pos >= this.data.length) throw new Truncated();
      this.push(this.data[this.pos++]!);
    }
  }

  private codes(literals: Huffman, distances: Huffman): void {
    for (;;) {
      const symbol = this.decode(literals);
      if (symbol < 256) this.push(symbol);
      else if (symbol === 256) return;
      else {
        const i = symbol - 257;
        if (i >= 29) throw new Error('invalid literal/length code');
        const len = LENGTH_BASE[i]! + this.bits(LENGTH_EXTRA[i]!);
        const d = this.decode(distances);
        if (d >= 30) throw new Error('invalid distance code');
        const dist = DIST_BASE[d]! + this.bits(DIST_EXTRA[d]!);
        if (dist > this.length) throw new Error('invalid distance too far back');
        for (let k = 0; k < len; k++) this.push(this.out[this.length - dist]!);
      }
    }
  }

  private dynamic(): void {
    const nlen = this.bits(5) + 257;
    const ndist = this.bits(5) + 1;
    const ncode = this.bits(4) + 4;
    if (nlen > 286 || ndist > 30) throw new Error('too many length or distance symbols');
    const codeLengths = new Uint8Array(19);
    for (let i = 0; i < ncode; i++) codeLengths[CODE_LENGTH_ORDER[i]!] = this.bits(3);
    const lengthCode = huffman(codeLengths);
    const lengths = new Uint8Array(nlen + ndist);
    for (let i = 0; i < nlen + ndist; ) {
      const symbol = this.decode(lengthCode);
      if (symbol < 16) {
        lengths[i++] = symbol;
        continue;
      }
      let repeat: number;
      let value = 0;
      if (symbol === 16) {
        if (i === 0) throw new Error('invalid bit length repeat');
        value = lengths[i - 1]!;
        repeat = 3 + this.bits(2);
      } else if (symbol === 17) repeat = 3 + this.bits(3);
      else repeat = 11 + this.bits(7);
      if (i + repeat > nlen + ndist) throw new Error('invalid bit length repeat');
      while (repeat--) lengths[i++] = value;
    }
    if (!lengths[256]) throw new Error('invalid code -- missing end-of-block');
    this.codes(huffman(lengths.subarray(0, nlen)), huffman(lengths.subarray(nlen)));
  }

  run(): void {
    let last = 0;
    while (!last) {
      last = this.bits(1);
      const type = this.bits(2);
      if (type === 0) this.stored();
      else if (type === 1) this.codes(FIXED_LITERALS, FIXED_DISTANCES);
      else if (type === 2) this.dynamic();
      else throw new Error('invalid block type');
    }
  }
}

function inflate(data: Uint8Array, start: number, options: InflateOptions): Bytes {
  const inflater = new Inflater(data, start, options.maxOutputLength ?? 2 ** 31 - 1);
  try {
    inflater.run();
  } catch (e) {
    if (!(e instanceof Truncated)) throw e;
    if (options.finishFlush !== constants.Z_SYNC_FLUSH) throw new Error('unexpected end of file');
  }
  return Buffer.from(inflater.output());
}

export function inflateRawSync(data: Uint8Array, options: InflateOptions = {}): Bytes {
  return inflate(data, 0, options);
}

/** Zlib-wrapped deflate: a two-byte header, then raw deflate. The Adler-32 checksum at the end is not checked. */
export function inflateSync(data: Uint8Array, options: InflateOptions = {}): Bytes {
  if (data.length < 2) throw new Error('unexpected end of file');
  const cmf = data[0]!;
  const flg = data[1]!;
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0) throw new Error('incorrect header check');
  if (flg & 0x20) throw new Error('need dictionary');
  return inflate(data, 2, options);
}
