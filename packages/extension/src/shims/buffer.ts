// The few Buffer methods the .xlsx, .docx, and PDF readers in packages/mcp use, on top of Uint8Array, for the browser
// extension. esbuild injects `Buffer` from here wherever those readers name it (see scripts/build-extension.mjs).

const utf8 = new TextDecoder();

export class Bytes extends Uint8Array {
  override toString(encoding: 'utf8' | 'latin1' = 'utf8', start = 0, end = this.length): string {
    const view = this.subarray(Math.max(0, start), Math.min(this.length, end));
    if (encoding === 'utf8') return utf8.decode(view);
    let out = '';
    for (let i = 0; i < view.length; i += 0x8000) out += String.fromCharCode(...view.subarray(i, i + 0x8000));
    return out;
  }

  override subarray(begin?: number, end?: number): Bytes {
    return super.subarray(begin, end) as Bytes;
  }

  readUInt16LE(at: number): number {
    if (at < 0 || at + 2 > this.length) throw new RangeError('Attempt to access memory outside buffer bounds');
    return this[at]! | (this[at + 1]! << 8);
  }

  readUInt32LE(at: number): number {
    if (at < 0 || at + 4 > this.length) throw new RangeError('Attempt to access memory outside buffer bounds');
    return (this[at]! | (this[at + 1]! << 8) | (this[at + 2]! << 16)) + this[at + 3]! * 0x1000000;
  }

  /** A string is searched for as Latin-1 bytes, which is how the readers use it ("%PDF-"). */
  override indexOf(value: number | string, from = 0): number {
    if (typeof value === 'number') return super.indexOf(value, from);
    const needle = Buffer.from(value, 'latin1');
    if (!needle.length) return Math.min(from, this.length);
    outer: for (let i = Math.max(0, from); i <= this.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (this[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  override includes(value: number | string, from = 0): boolean {
    return this.indexOf(value, from) >= 0;
  }
}

export const Buffer = {
  from(value: string | ArrayLike<number> | ArrayBuffer, encoding: 'utf8' | 'latin1' | 'hex' = 'utf8'): Bytes {
    if (value instanceof ArrayBuffer) return new Bytes(value);
    if (typeof value !== 'string') {
      // A Uint8Array is shared, as Buffer.from(arrayBuffer) shares memory; anything else is copied.
      if (value instanceof Uint8Array) return new Bytes(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength);
      return new Bytes(Array.from(value));
    }
    if (encoding === 'utf8') return Buffer.from(new TextEncoder().encode(value));
    if (encoding === 'latin1') {
      const out = new Bytes(value.length);
      for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
      return out;
    }
    // Like Node: pairs of hex digits, up to the first pair that is not one; a lone last digit is dropped.
    const out: number[] = [];
    for (let i = 0; i + 1 < value.length; i += 2) {
      const pair = value.slice(i, i + 2);
      if (!/^[0-9a-f]{2}$/i.test(pair)) break;
      out.push(Number.parseInt(pair, 16));
    }
    return new Bytes(out);
  },
};
