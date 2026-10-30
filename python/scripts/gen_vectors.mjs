// Generates the parity vectors in python/tests/vectors from the TypeScript build of @lokal-id/core, and from the
// MCP server's file readers (packages/mcp/src/files.ts and the PDF, Excel, and Word readers it uses).
// The Python test suite replays every input and requires the exact same output.
//
//   npm run build && node python/scripts/gen_vectors.mjs          # rewrite the vectors
//   node python/scripts/gen_vectors.mjs --check                   # CI: fail if they are out of date
//
// Offsets are converted from JavaScript's UTF-16 units to code points, which is what Python strings index.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const core = await import(path.join(ROOT, 'packages/core/dist/index.js').replace(/^/, 'file:///').replace(/\\/g, '/'));
const wil = await import(path.join(ROOT, 'packages/core/dist/wilayah.js').replace(/^/, 'file:///').replace(/\\/g, '/'));
const OUT = path.join(ROOT, 'python', 'tests', 'vectors');
const check = process.argv.includes('--check');

// Deterministic pseudo-random numbers (mulberry32), so the vectors only change when the code does.
let seed = 0x10ca1;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pad = (n, w) => String(n).padStart(w, '0');

const toCodePoint = (text, unit) => [...text.slice(0, unit)].length;
const plain = (v) => JSON.parse(JSON.stringify(v));
const tryCall = (fn) => {
  try {
    return { ok: plain(fn()) };
  } catch (e) {
    return { error: e.constructor.name, message: e.message };
  }
};

const files = {};
const emit = (name, data) => (files[name] = JSON.stringify(data, null, 1) + '\n');

// ---------------------------------------------------------------- NIK, NPWP, phone
const districts = Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'packages/core/data/wilayah.json'), 'utf8')))
  .filter((c) => c.split('.').length === 3);
const nikInputs = [
  '3201011508950001', '3276 01 550803 0002', '12345', '9901011508950001', '3201013108950001', '3201013102950001',
  '3201017508950001', '3201011508950000', '3201991508950001', '3201002908000001', '3200011508950001',
  '32.01.01.150895.0001', '3201-0115-0895-0001', '', 'abc', '32010115089500011', '9301016209950002',
  '3201010101260001', '3201010101270001', '3201012902000001', '3201012902010001', ' 3201011508950001 ',
];
for (let i = 0; i < 400; i++) {
  const d = pick(districts).replace(/\./g, '');
  const female = rand() < 0.5;
  const day = int(0, 32) + (female ? 40 : 0);
  nikInputs.push(`${d}${pad(day, 2)}${pad(int(0, 13), 2)}${pad(int(0, 99), 2)}${pad(int(0, 9999), 4)}`);
}
const ref = new Date('2026-10-15T00:00:00Z');
emit('nik.json', nikInputs.map((input) => ({
  input,
  plain: plain(core.parseNik(input, { referenceDate: ref })),
  withWilayah: plain(core.parseNik(input, { referenceDate: ref, lookupWilayah: wil.wilayahName })),
})));

const npwpInputs = [
  '01.234.567.8-901.000', '0012345678901000', '3201011508950001', '3201011508950000', '123', '012345678901000',
  '01 234 567 8 901 000', '09.254.294.3-407.000', 'x1.234.567.8-901.000', '0012345678901000 ',
];
for (let i = 0; i < 100; i++) npwpInputs.push(Array.from({ length: pick([14, 15, 16, 17]) }, () => int(0, 9)).join(''));
emit('npwp.json', npwpInputs.map((input) => ({ input, out: plain(core.parseNpwp(input)) })));

const prefixes = ['811', '812', '813', '821', '822', '823', '851', '852', '853', '814', '815', '816', '855', '856', '857',
  '858', '895', '896', '897', '898', '899', '817', '818', '819', '859', '877', '878', '831', '832', '833', '838', '881',
  '882', '883', '884', '885', '886', '887', '888', '889', '810', '820', '868', '827'];
const phoneInputs = [
  '0812-3456-7890', '+62 857 1234 5678', '6289612345678', '0881-2345-6789', '+62 (0) 812 3456 7890', '(021) 555-1234',
  '12345', '0812', '62', '+62', '0', '', '08 12 34 56 78 90', '0751 812345', '+62 751 812345', '(0274) 512345',
  '0812.3456.7890', ' 081234567890 ', '62812345678901234', '+6221', '0000812345678', '8123456789', 'abc',
  ' 0812 3456 7890﻿', '0812 3456 7890', '+62-812-3456-7890',
];
for (let i = 0; i < 300; i++) {
  const rest = pick(prefixes) + Array.from({ length: int(5, 10) }, () => int(0, 9)).join('');
  const lead = pick(['0', '62', '+62', '+62 ', '0', '']);
  const sep = pick(['', '-', ' ', '.']);
  phoneInputs.push(lead + rest.replace(/(\d{3})(\d{4})(?=\d)/, `$1${sep}$2${sep}`));
}
for (let i = 0; i < 60; i++) {
  phoneInputs.push(`${pick(['0', '+62', '(0'])}${pick(['21', '22', '24', '31', '61', '251', '274', '361', '411', '751', '778', '411', '999'])}${pick([') ', '', '-'])}${int(1000, 99999999)}`);
}
emit('phone.json', phoneInputs.map((input) => ({ input, out: plain(core.parsePhone(input)), e164: core.normalizePhone(input) ?? null })));

// ---------------------------------------------------------------- Rupiah, terbilang
const amounts = [0, 1, 999, 1000, 1500000, -25000, 1500000.5, 0.125, 2.5, -0.4, 1.005, 2.675, 999.5, 1e15, 123456789.987,
  1e21, 0.004, -0.005, 99999.995, 1234.5678, 3.5, 4.5];
for (let i = 0; i < 300; i++) amounts.push(Math.round(rand() * 10 ** int(0, 13) * 100) / 100 * (rand() < 0.1 ? -1 : 1));
emit('rupiah_format.json', amounts.map((amount) => ({
  amount,
  plain: core.formatRupiah(amount),
  decimals: core.formatRupiah(amount, { decimals: true }),
  noSymbol: core.formatRupiah(amount, { symbol: false }),
  short: core.formatRupiahShort(amount),
})));

const rupiahTexts = [
  'Rp 25.000', 'Rp1.500.000,00', '1,500,000', '1,5jt', '1.5 juta', '50k', '50rb', '15ribu', '1jt 500rb', '2jtan',
  '50rb-an', 'sekitar 1 juta', '2 juta lebih', 'goceng', 'goceng aja kak', '2 ceban', 'cepek ceng', 'gopek',
  'sejuta setengah', 'setengah juta', 'dua setengah juta', 'satu setengah juta', 'dua ratus lima puluh ribu',
  'seratus dua belas', 'seribu lima ratus', 'dua puluh lima juta tiga ratus ribu', '1,2 M', 'pisang goreng', '', 'jutaan',
  'constructor', '2 toString', '~2jt', '±500rb', 'Rp.25.000', 'IDR 1.000.000', '1.500', '1,500', '1,5', '1.5', '1.500jt',
  'rb', 'juta', '12 rebu', 'sejuta', 'semiliar', '3 noban', 'jigo', 'gocap ceng', '5 jt-an', '1jt-an', 'kurleb 300rb',
  '2,5 t', '1 triliun', 'sebelas ribu', 'dua belas', 'tujuh puluh', '1.234.567,89', '1,234,567.89', '10.5.3', '1e5',
  '  Rp 1.000  ', 'harga 50rb dong', 'total 1jt', 'sembilan ratus sembilan puluh sembilan', '99999999999999999999',
];
const words = ['satu', 'dua', 'tiga', 'lima', 'sepuluh', 'sebelas', 'belas', 'puluh', 'ratus', 'ribu', 'juta', 'rb',
  'jt', 'setengah', 'sejuta', 'seribu', 'goceng', 'ceban', 'an', 'lebih', 'sekitar', 'rp', '1', '2,5', '100', '1.500',
  'aja', 'kak', 'k', 'm'];
for (let i = 0; i < 300; i++) rupiahTexts.push(Array.from({ length: int(1, 5) }, () => pick(words)).join(pick([' ', '', '-'])));
emit('rupiah_parse.json', rupiahTexts.map((text) => ({ text, out: plain(core.parseRupiah(text)) })));

const terbilangNumbers = [0, 11, 15, 21, 100, 110, 1000, 1001, 11000, 100000, 1000000, 1500000, 2000000000, -5, 2.5,
  1e-7, 0.1 + 0.2, 123456789012345, 9007199254740991, 1.5e-7, 1e16, 999999.999, -0.5, 1001001, 10101010];
for (let i = 0; i < 200; i++) terbilangNumbers.push(Math.floor(rand() * 10 ** int(1, 15)));
emit('terbilang.json', terbilangNumbers.map((n) => ({
  n,
  lower: tryCall(() => core.terbilang(n)),
  title: tryCall(() => core.terbilang(n, { currency: true, case: 'title' })),
  sentence: tryCall(() => core.terbilang(n, { case: 'sentence' })),
  // Python ints are arbitrary-precision, like bigint: compare them with the bigint result.
  ...(Number.isInteger(n) ? { asBigint: {
    lower: tryCall(() => core.terbilang(BigInt(n))),
    title: tryCall(() => core.terbilang(BigInt(n), { currency: true, case: 'title' })),
    sentence: tryCall(() => core.terbilang(BigInt(n), { case: 'sentence' })),
  } } : {}),
})).concat([
  { big: '1000000000000000000', lower: tryCall(() => core.terbilang(10n ** 18n)) },
  { big: '-123456789012345678901', lower: tryCall(() => core.terbilang(-123456789012345678901n)) },
  { big: '1000000000000000000000', lower: tryCall(() => core.terbilang(10n ** 21n)) },
  { n: 1e21, lower: tryCall(() => core.terbilang(1e21)) },
]));

// ---------------------------------------------------------------- Holidays
const days = [];
for (let d = new Date('2026-01-01T00:00:00Z'); d <= new Date('2027-12-31T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  days.push(d.toISOString().slice(0, 10));
}
emit('holidays.json', {
  years: core.HOLIDAY_YEARS.map((y) => plain(core.getHolidays(y))),
  days: days.map((iso) => [
    iso, core.isWorkingDay(iso), core.isWorkingDay(iso, { cutiBersama: false }), core.isWorkingDay(iso, { weekend: [0] }),
    core.holidaysOn(iso).length,
  ]),
  add: Array.from({ length: 300 }, () => {
    const from = pick(days.slice(0, 700));
    const n = int(-15, 15);
    const opts = pick([{}, { cutiBersama: false }, { weekend: [0] }, { weekend: [5, 6] }]);
    return { from, n, opts, out: tryCall(() => core.addWorkingDays(from, n, opts)) };
  }),
  count: Array.from({ length: 100 }, () => {
    const a = pick(days.slice(0, 600));
    const b = pick(days);
    return { from: a, to: b, out: core.countWorkingDays(a, b), noCuti: core.countWorkingDays(a, b, { cutiBersama: false }) };
  }),
  errors: ['2028-01-03', '2026-02-30', '2026-13-01', '17-08-2026', '2025-12-31', '2026-2-3'].map((iso) => ({
    iso, out: tryCall(() => core.isWorkingDay(iso)),
  })),
});

// ---------------------------------------------------------------- Wilayah
const allCodes = [];
const walk = (parent) => {
  for (const w of wil.listWilayah(parent)) {
    allCodes.push(w);
    if (w.level < 4) walk(w.code);
  }
};
walk();
const digest = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex');
emit('wilayah.json', {
  count: allCodes.length,
  // Every region, in dropdown order, with its type, path, and kode pos: one hash instead of 91k rows.
  listingSha256: digest(allCodes.map((w) => [w.code, w.name, w.level, w.type, w.path, w.postalCode ?? ''].join('|'))),
  samples: allCodes.filter(() => rand() < 0.002).map((w) => plain(w)),
  get: ['3276', '32.76', '3276011001', '32.76.01.1001', '91.03.01', '91.03.01.3007', '99', '', '32.01', ' 32.01 ', '11']
    .map((code) => ({ code, norm: wil.normalizeWilayahCode(code), name: wil.wilayahName(code) ?? null, out: plain(wil.getWilayah(code) ?? null) })),
  postal: ['32.76.01', '32.76', '32', '93.01', '99', '3276'].map((code) => ({ code, out: wil.postalCodesIn(code) })),
  byPostal: ['16431', '16514', '99999', 'abc', ' 16431 ', '1643'].map((pos) => ({ pos, out: plain(wil.findByPostalCode(pos)) })),
  search: [
    ['depok'], ['Kab. Bogor'], ['jakarta selatan'], ['kec. cibinong', { level: 3 }], ['a', { within: '32', limit: 5 }],
    ['kota baru'], ['sukamaju', { level: 4 }], ['merauke'], ['sorong'], ['Tapos', { within: '32.76' }],
    ['cinere', { within: '32.76.11' }], ['bandung'], ['KOTA'], [''], ['   '], ['kel. depok', { level: 4, limit: 3 }],
    ['provinsi papua'], ["sa'dan"], ['jaya', { limit: 20 }], ['desa sukamaju', { within: '32.01' }],
  ].map(([q, o]) => ({ q, o: o ?? {}, out: plain(wil.searchWilayah(q, o)) })),
});

// ---------------------------------------------------------------- parseAlamat
// Every string literal in the address tests, then addresses built from random villages in the ways people write
// them: with level words or none, capitals, lowercase without commas, levels left out, a wrong kode pos.
const addresses = [];
for (const m of readFileSync(path.join(ROOT, 'packages/core/test/alamat.test.ts'), 'utf8').matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
  addresses.push(m[1].replace(/\\'/g, "'"));
}
// Its own seed, so adding cases here leaves the other vectors as they are.
const savedSeed = seed;
seed = 0xa1a3a7;
const villageCodes = Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'packages/core/data/desa.json'), 'utf8')));
const STREETS = ['Jl. Melati', 'Jl. Kenanga No. 12', 'Gg. Mawar 3', 'Jalan Flamboyan 7', 'Perum Griya Asri Blok C2 No. 7', 'Kp. Rawa Badak'];
for (let i = 0; i < 400; i++) {
  const v = wil.getWilayah(pick(villageCodes));
  const [kel, kec, kab, prov] = [v, ...[3, 2, 1].map((n) => wil.getWilayah(v.code.split('.').slice(0, n).join('.')))];
  const kabName = kab.name.replace(/^(?:Kabupaten|Kota)(?: Administrasi)? /, '');
  const parts = [
    rand() < 0.7 ? pick(STREETS) : '',
    rand() < 0.4 ? `RT ${pad(int(1, 12), int(1, 3))}/RW ${pad(int(1, 9), int(1, 3))}` : '',
    rand() < 0.85 ? `${rand() < 0.4 ? pick(['Kel. ', 'Ds. ', 'Desa ', 'Kelurahan ']) : ''}${kel.name}` : '',
    rand() < 0.7 ? `${rand() < 0.4 ? pick(['Kec. ', 'Kecamatan ']) : ''}${kec.name}` : '',
    rand() < 0.8 ? `${rand() < 0.5 ? (kab.type === 'kota' ? 'Kota ' : pick(['Kab. ', 'Kabupaten '])) : ''}${kabName}` : '',
    rand() < 0.4 ? prov.name : '',
  ].filter(Boolean);
  let text = parts.join(rand() < 0.6 ? ', ' : ' ');
  const postal = rand();
  if (postal < 0.4 && kel.postalCode) text += ` ${kel.postalCode}`;
  else if (postal < 0.5) text += ` ${int(10000, 99999)}`;
  // A typo in one name now and then: a letter dropped, doubled, or changed.
  if (rand() < 0.3) {
    const long = [...text.matchAll(/[A-Za-z]{5,}/g)];
    if (long.length) {
      const m = pick(long);
      const at = m.index + int(1, m[0].length - 2);
      const kind = int(0, 2);
      text = text.slice(0, at) + (kind === 0 ? '' : kind === 1 ? text[at] + text[at] : 'a') + text.slice(at + 1);
    }
  }
  const cased = rand();
  addresses.push(cased < 0.2 ? text.toUpperCase() : cased < 0.4 ? text.toLowerCase() : text);
}
emit('alamat.json', addresses.map((input) => ({ input, out: plain(wil.parseAlamat(input)) })));
seed = savedSeed;

// ---------------------------------------------------------------- Samaran
const docs = [];
const add = (text) => docs.push(text);
for (const f of readdirSync(path.join(ROOT, 'evals', 'fixtures'))) add(readFileSync(path.join(ROOT, 'evals', 'fixtures', f), 'utf8'));
// Docs and skills change often, so they are not part of the vectors; development compared them separately.
// Every string literal in the TypeScript test suites and the hard benchmark.
for (const f of [
  ...readdirSync(path.join(ROOT, 'packages/core/test')).map((f) => `packages/core/test/${f}`),
  'packages/mcp/test/mcp.test.ts', 'evals/hard/pii-bench.mjs', 'evals/cases.mjs',
]) {
  const src = readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
    try {
      add(JSON.parse(`"${m[1].replace(/"/g, '\\"').replace(/\\'/g, "'")}"`));
    } catch {
      add(m[1]);
    }
  }
}
// Fuzz: personal data in every format, glued with noise, emoji, NBSP, CRLF, and line separators.
const fragments = [
  'NIK 3201011508950001', 'nik: 3276 0145 0392 0003', 'KK 3201010101200001', 'NPWP 09.254.294.3-407.000', 'Paspor: A1234567',
  'No SIM 950812345678', 'NIP 19950815 202012 1 001', 'BPJS 0001234567890', 'HP 0812-3456-7890', '+62 857-1111-2222',
  '62 878 1234 5678', 'wa.me/6281377778888', '(0751) 812345', 'budi.santoso@gmail.com', 'siti [at] gmail [dot] com',
  'rek BCA 1234567890', 'kartu 4539 1488 0343 6467', 'plat B 1234 XYZ', 'login 182.253.10.15', 'lokasi -6.200000, 106.816666',
  'Nama: Budi Santoso', 'nama saya rina', 'a.n. Dewi Lestari', 'Bapak Dr. Ahmad Fauzi', 'halo kak ini rina,', 'tadi budi bilang',
  'Alamat: Jl. Mawar No. 5 RT 03/RW 07', 'lahir 15 Agustus 1995', 'Agama: Islam', 'beragama Katolik', 'didiagnosis TBC',
  'obat insulin (diabetes)', 'dirawat di RSUD Cibinong karena DBD', 'gaji saya 8 juta', 'Catatan Kriminal: pernah ditahan',
  '12/10/26 09.14 - Dewi Lestari: halo', 'Chat WhatsApp dengan Siti Aminah', '{"first_name":"Siti","last_name":"Rahayu"}',
  "INSERT INTO pelanggan (nama, nik) VALUES ('Hendra Gunawan', '1371011010850008');", 'nama,nik,hp\nBudi,3201011508950001,0812-3456-7890',
  'order 2610014KQ7ZB2M resi SPXID045123456789',
  'INV-081234567890', 'ORD/081234567890', 'TRX-6281234567890', 'hp-081234567890', 'no-0812 3456 7890',
  'saya diabetes, rutin obat insulin', 'ibu saya hipertensi', 'saya siap, dia datang besok',
  'gaji saya 8 juta, mau ambil cicilan 3 juta per bulan, budget saya 300 juta',
  `INSERT INTO pelanggan (id, nama, nik, no_hp) VALUES (17, 'Hendra Gunawan', '1371011010850008', '0813-9999-0000'),
(18, 'O''Brien Siregar', 3201011508950001, NULL);`,
  "INSERT INTO `pelanggan` (`nama`,`nik`) VALUES\r\n('Siti Aminah','3276015508030002'),\r\n('Dewi', 3578014607910004);",
  "INSERT INTO produk (nama, harga) VALUES ('Kopi Gayo', 85000), ('Arabika', 90000);",
  'level=error nik=3201011508950001 hp=081234567890 err="PaymentTimeout"',
  `customer:
  first_name: Siti
  last_name: Rahayu
  phone: "+6281298765432"`,
  'GET /cari?nama=Budi%20Santoso&nik=3201011508950001&email=budi@gmail.com',
  'Nama Pelanggan\tBudi Santoso', 'Nama\tNIK\tTelepon\nRina Wati\t3276014503920002\t0813-9999-0000', 'No\tNama\n1\tSiti Aminah',
  'Nama: Budi Santoso ya kak', 'Pemesan: Rina Wati sudah transfer', 'Nama: Siti Aminah (Ami)', 'Nama: Lee Dong Hae!',
  'Pasien:   Siti   Aminah, diagnosa: Hipertensi', 'Rp1.250.000', 'Versi 3.2.1', 'Ibu Kota Nusantara', 'call 1500888',
  // Unlabeled names, odd places, and casual sensitive data.
  'Pelanggan Budi Santoso minta refund', 'Halo Budi,', 'Dear Mr. Hendra Gunawan,', 'Salam,\nRina Kartika Sari',
  'From: Budi Santoso <budi.s@gmail.com>', 'Tamu: I Made Wirawan', 'koh Lim Swie Hong', 'Togar Simanjuntak',
  'BI-FAST CR SITI RAHAYU 75000.00', 'Penerima\nDEWI LESTARI', 'cek DM dari @siti.rahayu88', 'kepala keluarga Bambang',
  'KTP_3201011508950001.jpg', 'NIK3201011508950001', 'wa081234567890', '08 12 34 56 78 90', '+62 (812) 3456-7890',
  'rumah 0251 8321234', 'nol delapan satu dua tiga empat lima enam tujuh delapan sembilan', 'cvv 123', 'motor b3456xyz',
  '<input name="nama" value="Budi Santoso">', '<tr><th>Nama</th></tr><tr><td>Siti Aminah</td></tr>',
  'Komplek Taman Asri blok B no 9', 'Dusun Krajan RT 02 RW 01', 'jl mawar 5 cibinong', 'TTL Bogor, 17-08-1995',
  'saya muslim', 'suami saya kristen protestan', 'saya sudah cerai', 'ayah stroke', 'riwayat hipertensi dan diabetes melitus',
  'alergi penisilin', 'keluhan demam', 'utang pinjol 12 juta', 'udah galbay 3 bulan', 'mantan napi kasus narkoba',
  'pernah dipenjara 3 tahun', 'Pelanggan Setia', 'Masjid Agung', 'Universitas Ahmad Dahlan', 'Budi Pekerti', 'Halo Bandung,',
  'Sinar Pagi, Bogor', 'Lumban Siregar', '/** @param options.abortSignal */', 'b***@gmail.com', 'SK No. 100.3.3.1-6117', 'Range: IPv4 192.168.2.1-192.168.2.10',
];
const noise = [' ', ', ', '. ', '\n', '\r\n', ' 😭 ', ' ', ' ', ' — ', '\t', ': ', ' | ', '; ', ' 🇮🇩 ', '﻿'];
for (let i = 0; i < 1500; i++) {
  let t = '';
  for (let j = int(1, 6); j > 0; j--) t += pick(noise) + pick(fragments);
  add(t);
}
// SQL dumps as mysqldump and pg_dump write them: rows without column names under a CREATE TABLE, and COPY blocks.
const createPelanggan = [
  'CREATE TABLE `pelanggan` (',
  '  `id` int NOT NULL AUTO_INCREMENT,',
  "  `nama` varchar(100) DEFAULT 'tanpa, nama',",
  "  `telepon` varchar(20) COMMENT 'nomor (hp)',",
  '  `nik` char(16),',
  '  `diagnosa` text,',
  '  PRIMARY KEY (`id`),',
  '  KEY `idx_nik` (`nik`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
].join('\n');
const sqlRows = [
  "(1,'Budi Santoso','081234567890','3201011508950001','Diabetes tipe 2')",
  "(2,'Siti Aminah',NULL,3201014408960002,NULL)",
  "(3,'O''Brien Siregar','+62 812-9876-5432','3578014607910004','hipertensi')",
];
for (const eol of ['\n', '\r\n']) {
  add([createPelanggan, `INSERT INTO \`pelanggan\` VALUES ${sqlRows.join(',')};`, ''].join(eol));
  add([createPelanggan, ...sqlRows.map((r) => `INSERT IGNORE INTO pelanggan VALUES ${r};`)].join(eol));
  add(
    [
      'CREATE TABLE public."Pasien" (',
      '    id integer NOT NULL,',
      '    nama_lengkap text,',
      '    alamat text,',
      '    no_hp character varying(20),',
      '    CONSTRAINT pasien_pkey PRIMARY KEY (id)',
      ');',
      'COPY public."Pasien" (id, nama_lengkap, alamat, no_hp) FROM stdin;',
      '1\tRina Wati\tJl. Melati No. 5 RT 03/RW 07\t081234567890',
      '2\t\\N\tJl. Mawar No. 3\t\\N',
      '3\tDewi Lestari\t\\N\t0813-9999-0000',
      '\\.',
      'COPY public.produk (id, nama) FROM stdin;',
      '1\tKopi Gayo',
      '\\.',
      "INSERT INTO public.\"Pasien\" VALUES (4, 'Hendra Gunawan', 'Gg. Kenari No. 12', '0812-1111-2222');",
      "INSERT INTO log VALUES (1, 'Agus Salim');",
      '',
    ].join(eol),
  );
}

const detected = docs.map((text) => ({
  text,
  matches: core.detectPii(text).map((m) => [m.type, toCodePoint(text, m.start), toCodePoint(text, m.end), m.value, m.confidence]),
}));
emit('samaran_detect.json', detected);
const masked = docs.slice(0, 600).map((text) => {
  const s = new core.Samaran();
  const placeholder = s.mask(text).text;
  return {
    text,
    placeholder,
    vault: s.exportVault(),
    partial: core.maskPii(text, { mode: 'partial' }).text,
    noFinanceNoName: core.maskPii(text, { exclude: ['FINANCIAL', 'NAME'] }).text,
    high: core.detectPii(text, { minConfidence: 'high' }).map((m) => m.value),
  };
});
emit('samaran_mask.json', masked);
const keys = ['nama', 'NAMA_IBU_KANDUNG', 'customer_phone', 'alamat_pengiriman', 'first_name', 'Billing First Name', 'nik',
  'no. ktp', 'tgl lahir', 'Tempat/Tgl Lahir', 'jk', 'agama', 'diagnosa', 'gaji', 'foto_ktp', 'name', 'title', 'id', 'kota',
  'email_address', 'x-forwarded-for', 'remote_addr', 'lat', 'Nomor Rekening', 'va', '', '_', 'a'.repeat(41), 'surname',
  'pasien', 'owner', 'penerima_baru', 'no_hp_2', 'ttl', 'status_perkawinan', 'kewarganegaraan', 'skck', 'ttd'];
emit('samaran_fields.json', keys.map((key) => ({ key, out: core.fieldType(key) ?? null })));
emit('samaran_partial.json', core.PII_TYPES.flatMap((type) =>
  ['3201011508950001', '0812-3456-7890', 'budi@gmail.com', 'B 1234 XYZ', '182.253.10.15', '-6.200000, 106.816666',
    'Budi Santoso', 'Jl. Mawar No. 5', 'A1234567', '19950815 202012 1 001', '1234567890', '🌸 Dewi Lestari',
    '😀budi@gmail.com'].map((value) => ({
    type, value, out: core.partialMask(type, value),
  }))));

// A team's own rules (.samaran.json): patterns and fields in both ports, over the same texts and some of their own.
{
  const rules = [
    { label: 'EMPLOYEE_ID', pattern: String.raw`\bEMP-\d{6}\b` },
    { label: 'ORDER_REF', pattern: String.raw`INV/\d{4}/[A-Z]+/\d+` },
    { label: 'MEMBER', fields: ['no_member', 'Kode Member', 'member_id'] },
    // Overlaps built-in fields on purpose: the longer match, then the team's rule, wins.
    { label: 'NOTE', fields: ['catatan', 'nik'] },
    { label: 'TICKET', pattern: String.raw`\b(?:TKT|tkt)-\d+\s?[A-Z]?` },
  ];
  const own = [
    'Tiket dari EMP-004211 soal EMP-000317, lalu EMP-004211 lagi. emp-004211 huruf kecil tidak cocok.',
    'member no_member=M-0042 minta reset. member_id: Siti Aminah Putri dan lain-lain',
    '{"no_member": "M-0099", "nik": "3201011508950001", "catatan": "telepon 0812-3456-7890"}',
    "kode member: M-1234\nKODE MEMBER = 'M 77'\nno_member:\nno_member: \"\"",
    'nama,Kode Member,kota\r\nSiti Aminah,"M, 77",Bogor\r\nBudi Santoso,M-0042,Depok\r\n\r\nkota,catatan\r\nDepok,bukan kolom member',
    'id\tmember_id\tnama\n1\tA-1\tDewi Lestari\n2\t\tJoko Widodo\n3\tA-3',
    'no;no_member;hp\n1;"M ""kutip"" 5";0812-1111-2222',
    'Invoice INV/2026/BDG/00042 untuk TKT-889 B, 🌸 TKT-12 dan tkt-7.',
    'HP 0812-3456-7890, nik: 3201011508950001, no_member: 3201011508950002',
  ];
  emit('samaran_custom.json', {
    rules,
    cases: [...own, ...docs.slice(0, 300)].map((text) => {
      const s = new core.Samaran({ custom: rules });
      return {
        text,
        matches: core.detectPii(text, { custom: rules }).map((m) => [m.type, m.label ?? null, toCodePoint(text, m.start), toCodePoint(text, m.end), m.value]),
        placeholder: s.mask(text).text,
        vault: s.exportVault(),
        partial: core.maskPii(text, { custom: rules, mode: 'partial' }).text,
      };
    }),
  });
}

// ---------------------------------------------------------------- Kembaran
{
  const { Kembaran } = await import(path.join(ROOT, 'packages/core/dist/kembaran.js').replace(/^/, 'file:///').replace(/\\/g, '/'));
  const variants = [
    { secret: 'vektor-1' },
    { secret: 'vektor-2', keepBirthDate: true },
    { secret: 'vektor-3', keep: ['NAME', 'GENDER'], minConfidence: 'high' },
  ];
  // One instance per variant over many texts: stand-ins must stay consistent across texts, and collisions resolve
  // the same way in both ports.
  emit('kembaran.json', variants.map((options) => {
    const k = new Kembaran(options);
    return { options, results: docs.slice(0, 500).map((text) => plain(k.text(text))) };
  }));
  // Several texts as one database: values found in one are looked up in the others, and stand-ins avoid real values.
  const dump = [
    'CREATE TABLE pelanggan (id int, nama varchar(100), nik char(16), hp varchar(20), email varchar(80));',
    "INSERT INTO pelanggan VALUES (1,'Kenanga Purbasari','3201014508950001','081377881290','kenanga.p@example.com');",
    "INSERT INTO pesanan VALUES (77,'081377881290','kenanga purbasari minta kirim sore, cc KENANGA.P@EXAMPLE.COM');",
  ].join('\n');
  const groups = [[dump, 'kontak,catatan\n6281377881290,refund ke Kenanga Purbasari\n']];
  for (let i = 0; i < 400; i += 8) groups.push(docs.slice(i, i + 8));
  emit('kembaran_texts.json', variants.map((options) => {
    const k = new Kembaran(options);
    return { options, groups: groups.map((texts) => ({ texts, result: plain(k.texts(texts)) })) };
  }));
}

// ---------------------------------------------------------------- QRIS
{
  const f = (tag, value) => tag + String(value.length).padStart(2, '0') + value;
  const withCrc = (fields) => `${fields}6304${core.qrisCrc(`${fields}6304`)}`;
  const account = f('26', f('00', 'COM.CONTOH.WWW') + f('01', '936000000000000001') + f('02', '000000000000001') + f('03', 'UMI'));
  const national = (id = 'ID1026000000001', criteria = 'UMI') => f('51', f('00', 'ID.CO.QRIS.WWW') + f('02', id) + f('03', criteria));
  const merchant = (name = 'KOPI CONTOH', city = 'BOGOR') => f('52', '5812') + f('53', '360') + f('58', 'ID') + f('59', name) + f('60', city) + f('61', '16914');
  const bases = [
    withCrc(f('00', '01') + f('01', '11') + account + national() + merchant() + f('62', f('01', 'INV-77') + f('07', 'A01'))),
    withCrc(f('00', '01') + f('01', '12') + national('ID20230000001', 'UKE') + merchant('Toko Ümit Café', 'Denpasar') + f('54', '15000.5') + f('55', '01')),
    withCrc(f('00', '01') + account + merchant() + f('55', '03') + f('57', '2.5') + f('64', f('00', 'ID') + f('01', 'KOPI'))),
    withCrc(f('00', '01') + f('01', '13') + national('', 'URE') + merchant('', 'A'.repeat(16)) + f('54', '1,5') + f('55', '09')),
  ];
  const inputs = [...bases, '', '0002', 'https://example.com', '000201010211', `  ${bases[0]}\n`, bases[0].toLowerCase()];
  for (const b of bases.slice(0, 2)) {
    for (let i = 0; i < 40; i++) {
      const at = int(0, b.length - 1);
      inputs.push(b.slice(0, at) + pick(['0', '9', 'A', ' ', '']) + b.slice(at + 1));
      inputs.push(b.slice(0, int(0, b.length)));
    }
  }
  emit('qris_parse.json', inputs.map((input) => ({ input, out: plain(core.parseQris(input)) })));
  const amounts = [25000, '25000', 1500.5, '1500.50', 0, -5, 1.234, '12,000', '1e5', '12345678901234', ' 9000 ', 1e21, 0.1 + 0.2];
  const tips = [undefined, { fixed: 2500 }, { percent: 0.7 }, { percent: 150 }, { fixed: '0' }];
  const sets = [];
  for (const input of [...bases, bases[0].slice(0, -1) + '0']) {
    for (const amount of amounts) {
      for (const tip of tips) sets.push({ input, amount, tip: tip ?? null, out: tryCall(() => core.setQrisAmount(input, amount, tip ? { tip } : {})) });
    }
  }
  emit('qris_set_amount.json', sets);
}

// ---------------------------------------------------------------- documents (the MCP server's file readers)
// lokal.files ports packages/mcp/src/{files,pdf,xlsx,docx}.ts. Each document goes through loadDocument under its
// file name; Python writes the same bytes under the same name and must load the same thing.
{
  const toUrl = (p) => `file:///${path.join(ROOT, p).replace(/\\/g, '/')}`;
  const { loadDocument } = await import(toUrl('packages/mcp/src/files.ts'));
  const { samples } = await import(toUrl('packages/mcp/test/pdf-builder.ts'));
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const fixtures = path.join(ROOT, 'packages/mcp/test/fixtures');
  const docsIn = [];
  for (const f of readdirSync(fixtures).sort()) docsIn.push([f, readFileSync(path.join(fixtures, f))]);
  for (const [name, buf] of Object.entries(samples())) docsIn.push([`${name}.pdf`, buf]);
  // Damaged copies: cut off at several points, and with bytes overwritten inside compressed data.
  for (const [name, buf] of Object.entries(samples()).slice(0, 8)) {
    for (const cut of [0.35, 0.7, 0.9]) docsIn.push([`${name}-cut${cut * 100}.pdf`, buf.subarray(0, Math.floor(buf.length * cut))]);
    const flipped = Buffer.from(buf);
    for (let i = 200; i < flipped.length; i += 97) flipped[i] ^= 0x5a;
    docsIn.push([`${name}-flipped.pdf`, flipped]);
  }
  const formulir = readFileSync(path.join(fixtures, 'formulir.pdf'));
  for (const cut of [0.5, 0.8]) docsIn.push([`formulir-cut${cut * 100}.pdf`, formulir.subarray(0, Math.floor(formulir.length * cut))]);
  docsIn.push(['pelanggan-bom.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('nama,nik\nBudi,3201011508950001\n')])]);
  docsIn.push(['rusak.log', Buffer.from([0x6e, 0x69, 0x6b, 0x3d, 0xc3, 0x28, 0x31, 0xe2, 0x82, 0x0a, 0xf0, 0x9f, 0x98, 0x80, 0xed, 0xa0, 0x80, 0x0a])]);
  docsIn.push(['data.bin', Buffer.from([1, 2, 0, 3])]);
  docsIn.push(['ktp.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00])]);
  docsIn.push(['lama.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0])]);
  docsIn.push(['bukan.xlsx', Buffer.from('bukan zip')]);
  docsIn.push(['bukan.docx', Buffer.from('PK\x03\x04 rusak')]);

  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-vectors-'));
  const documents = docsIn.map(([name, buf]) => {
    const file = path.join(dir, name);
    writeFileSync(file, buf);
    return { name, data: buf.toString('base64'), out: plain(loadDocument(file)) };
  });
  rmSync(dir, { recursive: true, force: true });
  emit('documents.json', documents);
}

// ---------------------------------------------------------------- write / check
mkdirSync(OUT, { recursive: true });
let stale = 0;
for (const [name, content] of Object.entries(files)) {
  const file = path.join(OUT, name);
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {}
  if (current === content) continue;
  // Hand-built PDFs are deflated by this Node's zlib, whose bytes can differ between builds and CPUs. What the
  // readers make of them is what has to stay the same.
  if (name === 'documents.json' && current) {
    const outs = (json) => JSON.stringify(JSON.parse(json).map(({ name: n, out }) => [n, out]));
    if (outs(current) === outs(content)) continue;
  }
  stale++;
  if (check) console.error(`out of date: ${name}`);
  else writeFileSync(file, content);
}
if (check && stale) process.exit(1);
const total = Object.values(files).reduce((n, c) => n + c.length, 0);
console.log(`${Object.keys(files).length} vector files, ${(total / 1e6).toFixed(1)} MB, ${docs.length} Samaran texts${check ? ', up to date' : ''}`);
