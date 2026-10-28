import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { constants as zc, deflateRawSync, deflateSync } from 'node:zlib';
import { Samaran } from '../../core/src/samaran/index.ts';
import { attachmentKind, looksLikeIdPhoto, maskedFiles, MAX_ATTACHMENT_BYTES, readAttachment, type Readable } from '../src/attachments.ts';
import { Buffer as BufferShim } from '../src/shims/buffer.ts';
import { constants, inflateRawSync, inflateSync } from '../src/shims/zlib.ts';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../mcp/test/fixtures/${name}`, import.meta.url)));
const mask = (r: Readable) => {
  const samaran = new Samaran();
  return r.parts.map((p) => samaran.mask(p.csv).text);
};

test('attachmentKind reads documents and text, not images or archives', () => {
  assert.equal(attachmentKind('pelanggan.xlsx'), 'sheets');
  assert.equal(attachmentKind('Surat.DOCX'), 'docx');
  assert.equal(attachmentKind('ktp.pdf'), 'pdf');
  assert.equal(attachmentKind('ekspor.csv'), 'text');
  assert.equal(attachmentKind('seed.sql'), 'text');
  assert.equal(attachmentKind('noext', 'text/plain'), 'text');
  assert.equal(attachmentKind('data', 'application/json'), 'text');
  assert.equal(attachmentKind('ktp.jpg', 'image/jpeg'), undefined);
  assert.equal(attachmentKind('arsip.zip', 'application/zip'), undefined);
  assert.equal(attachmentKind('lama.xls'), undefined, 'the old binary Excel format is not read');
});

test('a text file is masked whole and keeps its name and type', () => {
  const bytes = new TextEncoder().encode('nama,nik\nBudi Santoso,3201011508950001\n');
  const read = readAttachment('ekspor.csv', bytes, 'text/csv');
  assert.ok(read && 'parts' in read);
  const files = maskedFiles('ekspor.csv', 'text/csv', read, mask(read));
  assert.deepEqual(files, [{ name: 'ekspor.csv', type: 'text/csv', text: 'nama,nik\n[NAME_1],[NIK_1]\n' }]);
});

test('a "text" file with NUL bytes is not read', () => {
  assert.equal(readAttachment('data.txt', new Uint8Array([0x4e, 0x49, 0x4b, 0, 1, 2])), undefined);
});

test('a spreadsheet becomes one masked CSV per sheet', () => {
  const read = readAttachment('pelanggan.xlsx', fixture('pelanggan.xlsx'));
  assert.ok(read && 'parts' in read);
  const files = maskedFiles('pelanggan.xlsx', '', read, mask(read));
  assert.deepEqual(
    files.map((f) => f.name),
    ['pelanggan - Pelanggan.csv', 'pelanggan - Medis.csv'],
  );
  assert.ok(files.every((f) => f.type === 'text/csv'));
  const all = files.map((f) => f.text).join('\n');
  for (const secret of ['3201011508950001', 'Budi Santoso', 'Siti Aminah', '0812-3456-7890']) assert.ok(!all.includes(secret), secret);
  assert.match(files[0]!.text, /^nama,nik,no_hp,agama/);
});

test('a Word document becomes one masked text file, its tables after the text', () => {
  const read = readAttachment('surat.docx', fixture('surat.docx'));
  assert.ok(read && 'parts' in read);
  const [file, ...rest] = maskedFiles('surat.docx', '', read, mask(read));
  assert.equal(rest.length, 0);
  assert.equal(file!.name, 'surat.txt');
  assert.match(file!.text, /^SURAT PERNYATAAN\n/);
  assert.match(file!.text, /--- Tabel 1 ---\nNama,NIK,HP\n/);
  assert.ok(!file!.text.includes('3276015508030002'));
});

test('a PDF becomes one masked text file with a heading per page', () => {
  const read = readAttachment('surat-keterangan.pdf', fixture('surat-keterangan.pdf'));
  assert.ok(read && 'parts' in read);
  const [file] = maskedFiles('surat-keterangan.pdf', 'application/pdf', read, mask(read));
  assert.equal(file!.name, 'surat-keterangan.txt');
  assert.match(file!.text, /^--- Halaman 1 ---\n/);
});

test('unreadable and oversized documents say why', () => {
  assert.deepEqual(readAttachment('rusak.xlsx', new TextEncoder().encode('bukan zip')), { kind: 'sheets', reason: 'damaged' });
  assert.deepEqual(readAttachment('rusak.pdf', new TextEncoder().encode('%PDF-1.7\n')), { kind: 'pdf', reason: 'damaged' });
  assert.deepEqual(readAttachment('besar.csv', new Uint8Array(MAX_ATTACHMENT_BYTES + 1)), { kind: 'text', reason: 'too-large' });
});

test('photos named like ID documents are recognised; other images are not', () => {
  for (const name of ['ktp-budi.jpg', 'KTP.png', 'e-ktp_scan.jpeg', 'selfie_siti.heic', 'foto npwp.webp', 'kartu-keluarga.png', 'buku_tabungan.jpg', 'IMG_kyc_01.png'])
    assert.equal(looksLikeIdPhoto(name), true, name);
  for (const name of ['grafik-penjualan.png', 'logo.svg', 'screenshot.png', 'simulasi.png', 'ktp.pdf', 'pelanggan.png'])
    assert.equal(looksLikeIdPhoto(name), false, name);
  assert.equal(looksLikeIdPhoto('ktp', 'image/jpeg'), true, 'a pasted image with no extension');
});

// --- the browser shims, against Node's own zlib and Buffer -----------------------------------------------------

const samples = [
  '',
  'a',
  'nama,nik\nBudi Santoso,3201011508950001\n'.repeat(500),
  Array.from({ length: 5000 }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 95))).join(''),
].map((s) => Buffer.from(s));
// Bytes that do not compress, so deflate writes stored and dynamic blocks.
let seed = 1;
samples.push(Buffer.from(Array.from({ length: 70000 }, () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 24) & 255)));

test('the inflate shim decodes what node:zlib compresses, at every level and strategy', () => {
  for (const data of samples) {
    for (const level of [0, 1, 6, 9]) {
      for (const strategy of [zc.Z_DEFAULT_STRATEGY, zc.Z_FIXED, zc.Z_HUFFMAN_ONLY]) {
        const raw = deflateRawSync(data, { level, strategy });
        assert.deepEqual(Buffer.from(inflateRawSync(raw)), data, `raw level ${level} strategy ${strategy}`);
        assert.deepEqual(Buffer.from(inflateSync(deflateSync(data, { level, strategy }))), data, `zlib level ${level}`);
      }
    }
  }
});

test('the inflate shim keeps what decodes from a cut stream with Z_SYNC_FLUSH, and enforces maxOutputLength', () => {
  const data = samples[4]!;
  const full = deflateSync(data);
  const cut = full.subarray(0, full.length >> 1);
  const part = Buffer.from(inflateSync(cut, { finishFlush: constants.Z_SYNC_FLUSH }));
  assert.ok(part.length > 0 && data.subarray(0, part.length).equals(part));
  assert.throws(() => inflateSync(cut), /unexpected end of file/);
  assert.throws(() => inflateSync(deflateSync(data), { maxOutputLength: 100 }), RangeError);
  assert.throws(() => inflateSync(Buffer.from('not zlib')), /incorrect header check/);
});

test('the Buffer shim matches Node for the calls the readers make', () => {
  const bytes = Buffer.from('%PDF-1.7 caf\xe9 é 12', 'latin1');
  const shim = BufferShim.from(new Uint8Array(bytes));
  assert.equal(shim.toString('latin1'), bytes.toString('latin1'));
  assert.equal(BufferShim.from('Siti Aminah ✓', 'utf8').toString('utf8'), 'Siti Aminah ✓');
  assert.equal(shim.toString('utf8', 2, 6), bytes.toString('utf8', 2, 6));
  assert.equal(shim.readUInt16LE(1), bytes.readUInt16LE(1));
  assert.equal(shim.readUInt32LE(3), bytes.readUInt32LE(3));
  assert.equal(BufferShim.from([0xff, 0xff, 0xff, 0xff]).readUInt32LE(0), 0xffffffff);
  assert.throws(() => shim.readUInt32LE(shim.length - 2), RangeError);
  assert.equal(shim.subarray(0, 1024).indexOf('%PDF-'), 0);
  assert.equal(shim.indexOf('caf'), bytes.indexOf('caf'));
  assert.equal(shim.indexOf('nope'), -1);
  assert.equal(shim.subarray(4).toString('latin1'), bytes.subarray(4).toString('latin1'));
  for (const hex of ['4e494b', '4E494B0', '4e49zz4b', '']) {
    assert.deepEqual([...BufferShim.from(hex, 'hex')], [...Buffer.from(hex, 'hex')], hex);
  }
});
