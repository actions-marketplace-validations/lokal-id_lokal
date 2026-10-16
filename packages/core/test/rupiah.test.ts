import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRupiah, formatRupiahShort, parseRupiah, terbilang } from '../src/index.ts';

test('formatRupiah mengikuti PUEBI', () => {
  assert.equal(formatRupiah(1500000), 'Rp1.500.000');
  assert.equal(formatRupiah(0), 'Rp0');
  assert.equal(formatRupiah(-25000), '-Rp25.000');
  assert.equal(formatRupiah(1500000.5, { decimals: true }), 'Rp1.500.000,50');
  assert.equal(formatRupiah(999, { symbol: false }), '999');
});

test('formatRupiahShort', () => {
  assert.equal(formatRupiahShort(1500000), 'Rp1,5 jt');
  assert.equal(formatRupiahShort(2300000000), 'Rp2,3 M');
  assert.equal(formatRupiahShort(15000), 'Rp15 rb');
  assert.equal(formatRupiahShort(750), 'Rp750');
});

const cases: Array<[string, number, boolean?]> = [
  ['Rp 25.000', 25000],
  ['Rp1.500.000,00', 1500000],
  ['1,500,000', 1500000],
  ['1,5jt', 1500000],
  ['1.5 juta', 1500000],
  ['50k', 50000],
  ['50rb', 50000],
  ['15ribu', 15000],
  ['1jt 500rb', 1500000],
  ['2jtan', 2000000, true],
  ['50rb-an', 50000, true],
  ['sekitar 1 juta', 1000000, true],
  ['2 juta lebih', 2000000, true],
  ['goceng', 5000],
  ['goceng aja kak', 5000],
  ['2 ceban', 20000],
  ['cepek ceng', 100000],
  ['gopek', 500],
  ['sejuta setengah', 1500000],
  ['setengah juta', 500000],
  ['dua setengah juta', 2500000],
  ['satu setengah juta', 1500000],
  ['dua ratus lima puluh ribu', 250000],
  ['seratus dua belas', 112],
  ['seribu lima ratus', 1500],
  ['dua puluh lima juta tiga ratus ribu', 25300000],
  ['1,2 M', 1200000000],
];

for (const [input, amount, approximate = false] of cases) {
  test(`parseRupiah("${input}")`, () => {
    assert.deepEqual(parseRupiah(input), { amount, approximate });
  });
}

test('parseRupiah menolak teks yang bukan nominal', () => {
  assert.equal(parseRupiah('pisang goreng'), null);
  assert.equal(parseRupiah(''), null);
  assert.equal(parseRupiah('jutaan'), null);
});

test('terbilang', () => {
  assert.equal(terbilang(0), 'nol');
  assert.equal(terbilang(11), 'sebelas');
  assert.equal(terbilang(15), 'lima belas');
  assert.equal(terbilang(21), 'dua puluh satu');
  assert.equal(terbilang(100), 'seratus');
  assert.equal(terbilang(110), 'seratus sepuluh');
  assert.equal(terbilang(1000), 'seribu');
  assert.equal(terbilang(1001), 'seribu satu');
  assert.equal(terbilang(11000), 'sebelas ribu');
  assert.equal(terbilang(100000), 'seratus ribu');
  assert.equal(terbilang(1000000), 'satu juta');
  assert.equal(terbilang(1500000), 'satu juta lima ratus ribu');
  assert.equal(terbilang(2000000000), 'dua miliar');
  assert.equal(terbilang(-5), 'minus lima');
  assert.equal(terbilang(2.5), 'dua koma lima');
  assert.equal(terbilang(10n ** 18n), 'satu kuintiliun');
});

test('terbilang untuk kuitansi', () => {
  assert.equal(terbilang(1500000, { currency: true }), 'satu juta lima ratus ribu rupiah');
  assert.equal(terbilang(1500000, { currency: true, case: 'title' }), 'Satu Juta Lima Ratus Ribu Rupiah');
  assert.equal(terbilang(25000, { case: 'sentence' }), 'Dua puluh lima ribu');
});

test('pembulatan yang melewati satuan dan angka sangat besar', () => {
  assert.equal(formatRupiahShort(999999), 'Rp1 jt');
  assert.equal(formatRupiahShort(999.96), 'Rp1 rb');
  assert.equal(formatRupiahShort(950000), 'Rp950 rb');
  assert.equal(formatRupiah(1e21), 'Rp1.000.000.000.000.000.000.000');
  assert.equal(formatRupiah(0.125, { decimals: true }), 'Rp0,13');
  assert.equal(formatRupiah(2.5), 'Rp3');
});

test('parseRupiah tidak tertipu nama properti bawaan objek', () => {
  assert.equal(parseRupiah('constructor'), null);
  assert.equal(parseRupiah('2 toString'), null);
});

test('terbilang angka desimal sangat kecil', () => {
  assert.equal(terbilang(1e-7), 'nol koma nol nol nol nol nol nol satu');
  assert.throws(() => terbilang(1e21), /bigint/);
});
