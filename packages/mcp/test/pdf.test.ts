import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readPdf, readPdfPages } from '../src/pdf.ts';
import { samples } from './pdf-builder.ts';

// Hand-built PDFs (pdf-builder.ts) for the structures real generators use, plus real files in fixtures/:
// invoice.pdf (Chrome: Type0 fonts with ToUnicode, tables), surat-keterangan.pdf (ReportLab: Helvetica, a page
// without text, an embedded TrueType subset), and formulir.pdf (ReportLab: a filled-in form). All data is made up.
const SAMPLES = samples();
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name));

test('PDF: baris, spasi antarkata, kolom, dan escape string dari font standar', () => {
  assert.deepEqual(readPdfPages(SAMPLES.standard!), [
    'Nama: Budi Santoso\nNIK: 3201011508950001\nAgama: Islam\tKawin\nBudi Santoso\nRp1.250.000 (lunas) caf\xe9 oksip',
  ]);
});

test('PDF: font dengan /Differences dan nama glyph', () => {
  assert.deepEqual(readPdfPages(SAMPLES.differences!), ['Nama Sit\xed \xe910']);
});

test('PDF: font Type0 dengan ToUnicode (bfchar dan bfrange), seperti keluaran Chrome dan Word', () => {
  assert.deepEqual(readPdfPages(SAMPLES.type0!), ['Budi Se']);
});

test('PDF: font satu byte yang ToUnicode-nya menyatakan kode dua byte (keluaran Acrobat)', () => {
  assert.deepEqual(readPdfPages(SAMPLES.toUnicodeOneByte!), ['Nama']);
});

test('PDF 1.5: objek di dalam object stream, xref stream, dan pembaruan inkremental', () => {
  assert.deepEqual(readPdfPages(SAMPLES.objectStream!), ['Pasien: Siti Aminah']);
});

test('PDF: teks di Form XObject dibaca, data biner gambar inline dilewati', () => {
  assert.deepEqual(readPdfPages(SAMPLES.formXObject!), ['Pasien: Siti Aminah\nHP 0812-3456-7890']);
});

test('PDF: filter berantai ASCII85 + Flate, dan Flate tanpa header zlib', () => {
  assert.deepEqual(readPdfPages(SAMPLES.ascii85!), ['NIK 3201011508950001']);
  assert.deepEqual(readPdfPages(SAMPLES.rawDeflate!), ['Nama: Rina Wati']);
});

test('PDF: halaman hasil scan dilaporkan kosong, PDF terenkripsi dan rusak ditolak', () => {
  const { pages, scanned, damaged } = readPdf(SAMPLES.scanned!);
  assert.deepEqual(pages, [{ name: 'Halaman 1', csv: 'Nama: Budi Santoso' }]);
  assert.deepEqual([scanned, damaged], [[2, 3], []]);

  const broken = readPdf(SAMPLES.damagedPages!);
  assert.deepEqual([broken.pages.length, broken.scanned, broken.damaged], [1, [], [2, 3]]);

  assert.throws(() => readPdfPages(SAMPLES.encrypted!), /encrypted/);
  assert.throws(() => readPdfPages(SAMPLES.noPages!), /No pages/);
  assert.throws(() => readPdfPages(SAMPLES.notPdf!), /Not a PDF/);
  assert.deepEqual(readPdfPages(SAMPLES.cutOff!), ['NIK 3201011508950001']);
  assert.deepEqual(readPdfPages(SAMPLES.hostile!), ['HP 0812-3456-7890']);
});

test('PDF: field formulir yang diisi, stempel, dan komentar ikut terbaca', () => {
  assert.deepEqual(readPdfPages(SAMPLES.annotations!), [
    [
      'FORMULIR PENGAJUAN KREDIT',
      'nama_pemohon: Budi Santoso',
      'pemohon.nik: 3201011508950001',
      'alamat: Jl. Mawar No. 5, Cibinong',
      'Cek ulang HP pemohon 0812-3456-7890',
      'Agama: Islam',
    ].join('\n'),
  ]);
  assert.deepEqual(readPdfPages(fixture('formulir.pdf')), [
    'FORMULIR PENDAFTARAN\nNama lengkap\nNIK\nnama_lengkap: Siti Aminah\nnik: 3276015508030002\nsetuju: Yes',
  ]);
});

test('PDF asli: invoice dari Chrome dan surat dari ReportLab', () => {
  const [invoice] = readPdfPages(fixture('invoice.pdf'));
  assert.ok(invoice!.startsWith('INVOICE INV/2026/10/00123\nPT Maju Jaya Motor \u2014 Jl. Sudirman No. 10, Jakarta\n'), invoice);
  assert.match(invoice!, /\nNama Pelanggan\tBudi Santoso\nNIK\t3201011508950001\nNo\. HP\t0812-3456-7890\n/);
  assert.match(invoice!, /\nNama\tNIK\tTelepon\nRina Wati\t3276014503920002\t0813-9999-0000\n/);
  assert.match(invoice!, /Kode diskon \u201cHEMAT10\u201d/);

  const { pages, scanned } = readPdf(fixture('surat-keterangan.pdf'));
  assert.deepEqual(scanned, [2]);
  assert.deepEqual(pages.map((p) => p.name), ['Halaman 1', 'Halaman 3']);
  assert.match(pages[0]!.csv, /^SURAT KETERANGAN\nNama: Budi Santoso\nNIK: 3201011508950001\n/);
  assert.equal(pages[1]!.csv, 'Penerima: Dewi Lestari \u2013 \u201cIbu Dewi\u201d, Rp1.250.000\nNo. Rekening: BCA 1234567890 a.n. Dewi Lestari');
});
