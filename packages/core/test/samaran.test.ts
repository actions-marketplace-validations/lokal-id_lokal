import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Samaran, detectPii, maskPii } from '../src/index.ts';

const chat = [
  'Halo kak, saya mau komplain. Nama: Budi Santoso',
  'NIK 3201011508950001, NPWP 01.234.567.8-901.000',
  'HP 0812-3456-7890 atau email budi.santoso@gmail.com',
  'Refund ke rek BCA 1234567890 a.n. Budi Santoso ya',
  'Alamat Jl. Mawar No. 5 RT 03/RW 07, motor B 1234 XYZ',
].join('\n');

test('mendeteksi semua jenis PII khas Indonesia dalam satu chat', () => {
  const types = detectPii(chat).map((m) => `${m.type}:${m.value}`);
  assert.deepEqual(types, [
    'NAME:Budi Santoso',
    'NIK:3201011508950001',
    'NPWP:01.234.567.8-901.000',
    'PHONE:0812-3456-7890',
    'EMAIL:budi.santoso@gmail.com',
    'BANK_ACCOUNT:1234567890',
    'NAME:Budi Santoso',
    'ADDRESS:Jl. Mawar No. 5 RT 03/RW 07',
    'PLATE:B 1234 XYZ',
  ]);
});

test('mask → LLM → unmask mengembalikan data asli', () => {
  const samaran = new Samaran();
  const { text } = samaran.mask(chat);
  assert.ok(!text.includes('3201011508950001'));
  assert.ok(!text.includes('Budi'));
  assert.match(text, /Nama: \[NAME_1\]/);
  assert.match(text, /a\.n\. \[NAME_1\]/, 'nama yang sama mendapat placeholder yang sama');

  const llmReply = 'Baik [NAME_1], refund ke [BANK_ACCOUNT_1] diproses. Kami hubungi [PHONE_1].';
  assert.equal(
    samaran.unmask(llmReply),
    'Baik Budi Santoso, refund ke 1234567890 diproses. Kami hubungi 0812-3456-7890.',
  );
});

test('nomor yang sama dengan format berbeda mendapat placeholder yang sama', () => {
  const samaran = new Samaran();
  const { text } = samaran.mask('Hubungi 0812-3456-7890 atau +62 812 3456 7890');
  assert.equal(text, 'Hubungi [PHONE_1] atau [PHONE_1]');
});

test('mode partial untuk log dan layar admin', () => {
  const { text } = maskPii('NIK 3201011508950001 HP 081234567890 email budi@gmail.com', { mode: 'partial' });
  assert.equal(text, 'NIK 3201********0001 HP 0812****7890 email b***@gmail.com');
});

test('tidak salah tangkap angka biasa', () => {
  const benign = [
    'Total belanja Rp1.500.000 dibayar tanggal 2026-10-15 jam 14.30',
    'Order #1234567890123456 sudah dikirim',
    'Ibu Kota Nusantara ada di Kalimantan Timur',
    'Jalan Sudirman macet parah pagi ini',
    'Versi 3.2.1, build 20261015',
  ];
  for (const text of benign) assert.deepEqual(detectPii(text), [], text);
});

test('nomor HP setelah kata transfer tetap terdeteksi sebagai HP (e-wallet)', () => {
  const [m] = detectPii('transfer DANA ke 081234567890 ya');
  assert.equal(m?.type, 'PHONE');
});

test('kartu kredit lolos Luhn, BPJS butuh kata kunci', () => {
  assert.equal(detectPii('kartu 4539 1488 0343 6467')[0]?.type, 'CARD');
  // Published test card numbers are not anyone's card.
  assert.deepEqual(detectPii('kartu uji 4111 1111 1111 1111'), []);
  assert.equal(detectPii('No BPJS 0001234567890')[0]?.type, 'BPJS');
  assert.deepEqual(detectPii('kode 0001234567890'), []);
});

test('gelar dilewati, nama tetap ditangkap', () => {
  const [m] = detectPii('Surat untuk Bapak Dr. Ahmad Fauzi');
  assert.equal(m?.value, 'Ahmad Fauzi');
});

test('allow-list dan filter jenis', () => {
  const samaran = new Samaran({ allow: ['cs@toko.id'], types: ['EMAIL'] });
  const { text } = samaran.mask('Hubungi cs@toko.id, bukan budi@gmail.com, HP 081234567890');
  assert.equal(text, 'Hubungi cs@toko.id, bukan [EMAIL_1], HP 081234567890');
});

test('kolom nama dan alamat di CSV dikenali dari header-nya', () => {
  const csv = 'id;nama_lengkap;alamat;kota\n1;Siti Aminah;Jl. Melati 3;Depok\n2;"Rahmat, S.T.";Gg. Kenari 9;Bogor\n';
  const found = detectPii(csv).map((m) => `${m.type}:${m.value}`);
  assert.deepEqual(found, [
    'NAME:Siti Aminah',
    'ADDRESS:Jl. Melati 3',
    'NAME:Rahmat, S.T.',
    'ADDRESS:Gg. Kenari 9',
  ]);
});

test('label "Nama:" di awal baris tidak menelan field lain di baris yang sama', () => {
  const { text } = maskPii(
    'Nama: Budi Santoso, NIK 3201011508950001, refund ke rek BCA 1234567890, HP 0812-3456-7890',
  );
  assert.equal(text, 'Nama: [NAME_1], NIK [NIK_1], refund ke rek BCA [BANK_ACCOUNT_1], HP [PHONE_1]');
  assert.deepEqual(
    detectPii('alamat: Jl. Mawar No. 5, Depok, HP 0812-3456-7890').map((m) => `${m.type}:${m.value}`),
    ['ADDRESS:Jl. Mawar No. 5, Depok', 'PHONE:0812-3456-7890'],
  );
});

test('kalimat berkoma bukan header CSV', () => {
  assert.deepEqual(detectPii('Nama, alamat, dan NIK wajib diisi.\nTerima kasih, admin'), []);
});

test('nilai JSON/YAML dengan key nama/alamat', () => {
  const json = '{"id": 7, "nama": "Dewi Lestari", "alamat": "Perum Griya Asri Blok C2", "name": "lokal"}';
  assert.deepEqual(
    detectPii(json).map((m) => `${m.type}:${m.value}`),
    ['NAME:Dewi Lestari', 'ADDRESS:Perum Griya Asri Blok C2'],
  );
  assert.deepEqual(detectPii('customer_name: Andi Wijaya\n').map((m) => m.value), ['Andi Wijaya']);
  // Identifiers in code are not people.
  assert.deepEqual(detectPii('this.name = "ZodCompileError"; const x = { name: "Server" };'), []);
});

test('vault bisa diekspor dan diimpor ke proses lain', () => {
  const a = new Samaran();
  const { text } = a.mask('NIK 3201011508950001');
  const b = new Samaran();
  b.importVault(a.exportVault());
  assert.equal(b.unmask(text), 'NIK 3201011508950001');
  assert.equal(b.mask('lagi 3201011508950001').text, 'lagi [NIK_1]');
  assert.equal(b.mask('NIK 3276015508030002').text, 'NIK [NIK_2]');
});

test('nama tanpa label di chat, termasuk huruf kecil', () => {
  const names = (s: string) => detectPii(s, { types: ['NAME'] }).map((m) => m.value);
  const cases: Array<[string, string[]]> = [
    ['nama saya budi santoso mau tanya pesanan', ['budi santoso']],
    ['refund atas nama budi santoso ya', ['budi santoso']],
    ['transfer ke rek BCA a.n. dewi lestari', ['dewi lestari']],
    ['saya Rina Wulandari dari Bekasi', ['Rina Wulandari']],
    ['perkenalkan, saya Andi', ['Andi']],
    ['paket untuk bapak ahmad fauzi', ['ahmad fauzi']],
    ['anak saya bernama Muhammad Rizky', ['Muhammad Rizky']],
    ['halo, dengan Agus Salim di sini', ['Agus Salim']],
    ['nama lengkap saya adalah Nur Aisyah binti Ahmad', ['Nur Aisyah binti Ahmad']],
    ['NAMA SAYA ANDI WIJAYA MAU KOMPLAIN', ['ANDI WIJAYA']],
    ['kak barangnya buat mbak yuni ya', ['yuni']],
    ['sudah transfer a.n. M. Iqbal Ramadhan', ['M. Iqbal Ramadhan']],
  ];
  for (const [text, expected] of cases) assert.deepEqual(names(text), expected, text);
});

test('kalimat chat biasa tidak dianggap nama', () => {
  for (const text of [
    'saya mau refund pesanan kemarin',
    'saya Mau tanya',
    'saya Cuma mau tanya stok',
    'saya Senin depan ambil barangnya',
    'nama saya sudah terdaftar',
    'atas nama perusahaan kami mohon maaf',
    'atas nama manajemen kami mohon maaf atas keterlambatan',
    'diproses atas nama Pengendali Data Pribadi',
    'Bapak Ibu sekalian, terima kasih',
    'Ibu-ibu PKK hadir semua',
    'Ibu Kota Nusantara',
    'kak tolong dicek ya',
    'bu, harga kopinya berapa?',
    'namanya juga usaha kak',
    'saya Customer lama di sini',
    'const fullName = new codegen_1.Name("x")',
  ]) {
    assert.deepEqual(detectPii(text, { types: ['NAME'] }), [], text);
  }
});

test('log logfmt: nilai berhenti di pasangan key=value berikutnya', () => {
  const line = 'ERROR checkout failed user_email=budi.santoso@gmail.com nik=3201011508950001 hp=081234567890 err="PaymentTimeout"';
  assert.deepEqual(
    detectPii(line).map((m) => `${m.type}:${m.value}`),
    ['EMAIL:budi.santoso@gmail.com', 'NIK:3201011508950001', 'PHONE:081234567890'],
  );
  const { text } = new Samaran().mask(line);
  assert.equal(text, 'ERROR checkout failed user_email=[EMAIL_1] nik=[NIK_1] hp=[PHONE_1] err="PaymentTimeout"');
});
