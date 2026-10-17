// Minimal .xlsx reader: enough to turn each sheet into CSV text for scanning and masking.
// An .xlsx file is a ZIP of XML parts; this reads the ZIP central directory with node:zlib,
// then the shared strings and the cell values. Formatting, formulas and dates-as-serials are ignored.
import { inflateRawSync } from 'node:zlib';

export interface Sheet {
  name: string;
  csv: string;
}

/** A file inside the ZIP may not decompress to more than this: a small .xlsx can hide gigabytes. */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

export function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP/xlsx file.');
  // Offsets come from the file; one that points outside it means the ZIP is damaged.
  const corrupt = () => new Error('Corrupt ZIP central directory.');
  const u16 = (at: number) => {
    if (at < 0 || at + 2 > buf.length) throw corrupt();
    return buf.readUInt16LE(at);
  };
  const u32 = (at: number) => {
    if (at < 0 || at + 4 > buf.length) throw corrupt();
    return buf.readUInt32LE(at);
  };
  const entries = u16(eocd + 10);
  let p = u32(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (u32(p) !== 0x02014b50) throw corrupt();
    const method = u16(p + 10);
    const compressed = u32(p + 20);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const local = u32(p + 42);
    const name = buf.toString('utf8', p + 46, Math.min(buf.length, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    const dataStart = local + 30 + u16(local + 26) + u16(local + 28);
    const data = buf.subarray(dataStart, dataStart + compressed);
    if (method === 0) files.set(name, data);
    else if (method === 8) {
      try {
        files.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
      } catch (e) {
        throw new Error(e instanceof RangeError ? 'A file in the ZIP is too large to decompress.' : 'Corrupt ZIP data.');
      }
    }
  }
  return files;
}

export function decodeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (all, name: string, dec?: string, hex?: string) => {
    if (dec || hex) {
      const cp = dec ? Number(dec) : parseInt(hex!, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()] ?? all;
  });
}

function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('');
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function readXlsx(buf: Buffer): Sheet[] {
  const files = unzip(buf);
  const read = (name: string) => files.get(name)?.toString('utf8');

  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));

  const rels = new Map<string, string>();
  for (const m of (read('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }

  const sheets: Sheet[] = [];
  for (const m of (read('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet');
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const xml = rid ? read(rels.get(rid) ?? '') : undefined;
    if (!xml) continue;

    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const body = c[2] ?? '';
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = '';
        if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (v !== undefined) value = decodeXml(v);
        const idx = ref ? columnIndex(ref) : cells.length;
        while (cells.length < idx) cells.push('');
        cells[idx] = value;
      }
      rows.push(cells);
    }
    // Excel omits trailing empty cells; pad so every row has as many fields as the widest one.
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    const csv = rows.map((r) => [...r, ...Array(width - r.length).fill('')].map(csvCell).join(',')).join('\n');
    sheets.push({ name, csv });
  }
  return sheets;
}
