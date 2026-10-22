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

test('nomor HP di akhir baris tidak menelan angka di baris berikutnya', () => {
  // WhatsApp export: the header ends with the number and the next line starts with a date.
  const chat = 'Chat WhatsApp dengan +62 881-2345-6789\n14/10/26 08.30 - +62 881-2345-6789: halo';
  assert.equal(new Samaran().mask(chat).text, 'Chat WhatsApp dengan [PHONE_1]\n14/10/26 08.30 - [PHONE_1]: halo');
  assert.deepEqual(detectPii('hp 0812-3456-7890\n2026-10-01 error').map((m) => m.value), ['0812-3456-7890']);
  assert.deepEqual(detectPii('kirim 0812-3456-7890 2 pcs').map((m) => m.value), ['0812-3456-7890']);
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
  // A new sentence that opens with a field name ends the address; "Kel." and "Kec." do not.
  assert.deepEqual(
    detectPii('Alamat: Jl. Melati No. 12, Kel. Sukamaju, Kec. Cibeunying, Bandung. Rekening BCA 1234567890.').map(
      (m) => `${m.type}:${m.value}`,
    ),
    ['ADDRESS:Jl. Melati No. 12, Kel. Sukamaju, Kec. Cibeunying, Bandung', 'BANK_ACCOUNT:1234567890'],
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

const values = (text: string, types?: Parameters<typeof detectPii>[1]['types']) =>
  detectPii(text, types ? { types } : {}).map((m) => `${m.type}:${m.value}`);

test('nama yang dipecah per bagian di JSON payment gateway', () => {
  const json = '{"customer_details":{"first_name":"Siti","last_name":"Rahayu","email":"siti@gmail.com"}}';
  assert.deepEqual(values(json, ['NAME']), ['NAME:Siti', 'NAME:Rahayu']);
  // Form labels and schemas are not people.
  assert.deepEqual(values('first_name: "First Name"\nlast_name: "string"\nfamily_name: "Nama Belakang"', ['NAME']), []);
});

test('pengirim di export chat WhatsApp, kecuali akun bisnis dan baris log', () => {
  const chat = [
    'Chat WhatsApp dengan Dewi Lestari',
    '12/10/26 09.14 - Dewi Lestari: kak mug nya pecah',
    '12/10/26 09.16 - Toko Kopi Senja: Mohon maaf',
    '[12/10/26 09.20:11] Maria Gebze: paket belum sampai',
    '10/12/26, 9:14 AM - Budi: ok',
  ].join('\n');
  assert.deepEqual(values(chat, ['NAME']), [
    'NAME:Dewi Lestari', 'NAME:Dewi Lestari', 'NAME:Maria Gebze', 'NAME:Budi',
  ]);
  assert.deepEqual(values('12/10/26 09.14 - ERROR: koneksi gagal', ['NAME']), []);
});

test('data kesehatan di teks bebas: obat, rawat inap, penyakit dalam kurung', () => {
  const text = 'isinya obat insulin buat ibu saya (diabetes). Beliau dirawat di RSUD Cibinong karena DBD';
  assert.deepEqual(values(text, ['HEALTH']), [
    'HEALTH:insulin', 'HEALTH:diabetes', 'HEALTH:dirawat di RSUD Cibinong', 'HEALTH:DBD',
  ]);
  for (const benign of ['minum oat tiap pagi', 'beli obat batuk', 'mobilnya dirawat di bengkel', 'karena macet']) {
    assert.deepEqual(values(benign, ['HEALTH']), [], benign);
  }
});

test('dump SQL: nilai dicocokkan dengan kolomnya', () => {
  const sql =
    "INSERT INTO pelanggan (id, nama, nik, no_hp) VALUES (17, 'Hendra Gunawan', '1371011010850008', '0813-9999-0000'),\n" +
    "(18, 'O''Brien Siregar', 3201011508950001, NULL);";
  assert.deepEqual(values(sql), [
    'NAME:Hendra Gunawan', 'NIK:1371011010850008', 'PHONE:0813-9999-0000', "NAME:O''Brien Siregar", 'NIK:3201011508950001',
  ]);
  assert.deepEqual(values("INSERT INTO produk (nama, harga) VALUES ('Kopi Gayo', 85000);"), []);
});

test('dump SQL tanpa nama kolom: mysqldump membaca kolom dari CREATE TABLE', () => {
  const sql =
    'CREATE TABLE `pelanggan` (\n' +
    '  `id` int NOT NULL AUTO_INCREMENT,\n' +
    "  `nama` varchar(100) DEFAULT 'tanpa, nama',\n" +
    "  `telepon` varchar(20) COMMENT 'nomor (hp)',\n" +
    '  `nik` char(16),\n' +
    '  PRIMARY KEY (`id`),\n' +
    '  KEY `idx_nik` (`nik`)\n' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n' +
    "INSERT INTO `pelanggan` VALUES (1,'Budi Santoso','081234567890','3201011508950001'),(2,'Siti Aminah',NULL,'3201014408960002');\n" +
    'CREATE TABLE `produk` (`id` int, `nama` varchar(50));\n' +
    "INSERT INTO `produk` VALUES (1,'Kopi Susu Gula Aren');\n" +
    "INSERT INTO `log` VALUES (1,'Hendra Gunawan');\n";
  assert.deepEqual(values(sql), [
    'NAME:Budi Santoso', 'PHONE:081234567890', 'NIK:3201011508950001', 'NAME:Siti Aminah', 'NIK:3201014408960002',
  ]);
  // pg_dump --inserts, with a schema and the table name in quotes.
  const pg = 'CREATE TABLE public."Pasien" (\n    id integer,\n    nama_lengkap text,\n    diagnosa text\n);\n' +
    "INSERT INTO public.\"Pasien\" VALUES (1, 'Rina Wati', 'Diabetes tipe 2');\n";
  assert.deepEqual(values(pg), ['NAME:Rina Wati', 'HEALTH:Diabetes tipe 2']);
});

test('dump SQL: blok COPY dari pg_dump', () => {
  const sql =
    'COPY public.pelanggan (id, nama, alamat, no_hp) FROM stdin;\n' +
    '1\tBudi Santoso\tJl. Melati No. 5\t081234567890\n' +
    '2\t\\N\tJl. Mawar No. 3\t\\N\n' +
    '\\.\n' +
    'COPY public.produk (id, nama) FROM stdin;\n' +
    '1\tKopi Gayo\n' +
    '\\.\n' +
    '3\tBukan Baris COPY\tx\tx\n';
  assert.deepEqual(values(sql), ['NAME:Budi Santoso', 'ADDRESS:Jl. Melati No. 5', 'PHONE:081234567890', 'ADDRESS:Jl. Mawar No. 3']);
});

test('email yang dieja manual dan nama tanpa label di chat', () => {
  assert.deepEqual(values('kirim ke siti.rahayu88 [at] gmail [dot] com ya'), ['EMAIL:siti.rahayu88 [at] gmail [dot] com']);
  assert.deepEqual(values('halo kak ini rina, pesanan saya batal', ['NAME']), ['NAME:rina']);
  assert.deepEqual(values('tadi budi bilang udah dikirim', ['NAME']), ['NAME:budi']);
  for (const benign of ['halo kak ini mau tanya', 'halo ini stok ready?', 'tadi kurir bilang nyasar', 'kemarin mama nanya']) {
    assert.deepEqual(values(benign, ['NAME']), [], benign);
  }
});

test('nama berlabel berhenti di kata obrolan, emoji, dan kalimat berikutnya', () => {
  const cases: Array<[string, string]> = [
    ['Nama: Budi Santoso ya kak', 'Budi Santoso'],
    ['Nama: Budi Santoso kak, mau tanya cicilan', 'Budi Santoso'],
    ['nama: budi santoso dong', 'budi santoso'],
    ['Nama: Budi Santoso 🙏', 'Budi Santoso'],
    ['Nama: Budi Santoso🙏 makasih', 'Budi Santoso'],
    ['Nama: Budi Santoso. Saya mau tanya', 'Budi Santoso'],
    ['Nama: Siti Aminah! tolong dibantu', 'Siti Aminah'],
    ['Nama: Budi Santoso terima kasih', 'Budi Santoso'],
    ['Pemesan: Rina Wati sudah transfer kak', 'Rina Wati'],
    ['Pembeli: Rina Wati', 'Rina Wati'],
    ['A/N: Budi Santoso', 'Budi Santoso'],
    // Not chat words: titles, initials, and name parts that look like them stay inside the name.
    ['Nama: M. Rizki Ramadhan', 'M. Rizki Ramadhan'],
    ['Nama: Dr. Ir. H. Ahmad Fauzi', 'Dr. Ir. H. Ahmad Fauzi'],
    ['Nama: Lee Dong Hae', 'Lee Dong Hae'],
    ['Nama: Ahmad bin Abdullah', 'Ahmad bin Abdullah'],
    // A nickname in brackets is part of the name; it used to make the whole value look like code.
    ['Nama: Siti Aminah (Ami)', 'Siti Aminah (Ami)'],
  ];
  for (const [text, name] of cases) assert.deepEqual(values(text, ['NAME']), [`NAME:${name}`], text);
  assert.deepEqual(values('nama_pemesan,hp\nRina Wati (Rin),0812-3456-7890', ['NAME']), ['NAME:Rina Wati (Rin)']);
  // Still code, not a name.
  for (const code of ['nama: getName(user)', 'name: fullName (string)', 'pembeli: User']) {
    assert.deepEqual(values(code, ['NAME']).filter((v) => v.includes('(')), [], code);
  }
});

test('tabel ber-tab di tengah teks: salinan Excel/Word dan teks PDF', () => {
  assert.deepEqual(values('Nama Pelanggan\tBudi Santoso\nNIK\t3201011508950001\nNo. HP\t0812-3456-7890'), [
    'NAME:Budi Santoso', 'NIK:3201011508950001', 'PHONE:0812-3456-7890',
  ]);
  assert.deepEqual(values('Daftar peserta:\nNama\tNIK\tTelepon\nRina Wati\t3276014503920002\t0813-9999-0000\nHendra Gunawan\t1371011010850008\nTotal 2 orang'), [
    'NAME:Rina Wati', 'NIK:3276014503920002', 'PHONE:0813-9999-0000', 'NAME:Hendra Gunawan', 'NIK:1371011010850008',
  ]);
  assert.deepEqual(values('Rekap nilai\r\nNo\tNama\tNilai\r\n1\tSiti Aminah\t90\r\n2\tDewi Lestari\t85', ['NAME']), [
    'NAME:Siti Aminah', 'NAME:Dewi Lestari',
  ]);
  // "Nama<TAB>: Budi" is a labeled field; the tab table must not add a second, overlapping match.
  assert.deepEqual(values('Nama\t: Budi Santoso\nAgama\t:\tIslam'), ['NAME:Budi Santoso', 'RELIGION:Islam']);
  // Data files with tabs: an ID and a word that happens to be a field name, lowercase key-value pairs, code lists.
  for (const benign of [
    'n01687978\tagama\nn01688243\tfrilled lizard\nn01688961\tChamaeleo oweni',
    '\t\t\tuser\tuser name\n\t\t\thost\thost name\n\t\t\tpid\tPID of the Vim process',
    'dna\tUpper Grand Valley Dani\ndnb\tDumpu',
    '|:wn|\t   :wn[ext][!]\t\twrite file and edit next file',
  ]) {
    // In the middle of a file; a header on the first line is a TSV header (detectCsvColumns).
    assert.deepEqual(values(`...\n${benign}`), [], benign);
  }
});

test('file dengan nomor baris (tool Read agent, cat -n): header tetap dikenali', () => {
  assert.deepEqual(values('1\u2192nama,nik,kota\n2\u2192Budi Santoso,3201011508950001,Bogor\n3\u2192Siti Aminah,3276015508030002,Depok', ['NAME']), [
    'NAME:Budi Santoso', 'NAME:Siti Aminah',
  ]);
  assert.deepEqual(values('     1\tnama,nik\n     2\tBudi Santoso,3201011508950001', ['NAME']), ['NAME:Budi Santoso']);
  assert.deepEqual(values('1\tNama\tNIK\n2\tRina Wati\t3276014503920002', ['NAME']), ['NAME:Rina Wati']);
  // Numbers that do not count up are data, not line numbers.
  assert.deepEqual(values('12\tnama,nik\n7\tBudi Santoso,3201011508950001', ['NAME']), []);
});

test('nilai yang ditemukan selalu sama persis dengan teks di posisinya', () => {
  // Rejoining "Siti   Aminah" with single spaces once made the mask stop short and leave "ah" visible.
  const texts = [
    'Pasien: Siti   Aminah dan suami', 'Nama: Budi  Santoso', 'nama: Budi Santoso', 'Nama: Budi\tSantoso, HP 0812',
    'NAMA :  BUDI   SANTOSO  NIK: 3201011508950001', 'alamat:  Jl. Mawar  No. 5,  Depok',
  ];
  for (const text of texts) {
    for (const m of detectPii(text)) assert.equal(text.slice(m.start, m.end), m.value, text);
    const s = new Samaran();
    const { text: masked } = s.mask(text);
    assert.ok(!/Aminah|Santoso|SANTOSO|Mawar/.test(masked), masked);
    assert.equal(s.unmask(masked), text);
  }
});

test('JSON satu baris yang besar tetap cepat (guard punya batas waktu 10 detik)', () => {
  // Scanning the whole line before every ":" once took minutes here, and a timed-out guard lets the read through.
  const json = `[${Array.from({ length: 20000 }, (_, i) => `{"id":${i},"nama":"Budi Santoso","nik":"3201011508950001"}`).join(',')}]`;
  const started = Date.now();
  const found = detectPii(json);
  assert.equal(found.length, 40000);
  assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
});

test('exclude: data keuangan dan nama tetap terbaca untuk simulasi kredit', () => {
  const text = 'gaji saya 8 juta, mau ambil cicilan 3 juta per bulan, a.n. Budi Santoso, HP 0812-3456-7890';
  assert.equal(
    new Samaran({ exclude: ['FINANCIAL', 'NAME'] }).mask(text).text,
    'gaji saya 8 juta, mau ambil cicilan 3 juta per bulan, a.n. Budi Santoso, HP [PHONE_1]',
  );
  assert.throws(() => detectPii(text, { exclude: ['FINANSIAL' as never] }), /Unknown PII type "FINANSIAL"/);
});

test('nomor yang menempel pada kode (INV-, ORD/) bukan nomor HP', () => {
  for (const id of ['INV-081234567890', 'ORD/081234567890', 'TRX-6281234567890', 'inv.2026-081234567890']) {
    assert.deepEqual(detectPii(id), [], id);
  }
  for (const phone of ['hp-081234567890', 'no-081234567890', 'wa.me/6281377778888', 'https://wa.me/6281234567890']) {
    assert.equal(detectPii(phone)[0]?.type, 'PHONE', phone);
  }
  assert.deepEqual(detectPii('081234567890/081298765432').map((m) => m.value), ['081234567890', '081298765432']);
});

test('penyakit setelah kata ganti: "saya diabetes"', () => {
  assert.deepEqual(detectPii('saya diabetes, rutin obat insulin').map((m) => m.value), ['diabetes', 'insulin']);
  assert.deepEqual(detectPii('ibu saya hipertensi').map((m) => m.value), ['hipertensi']);
  assert.deepEqual(detectPii('saya siap, dia datang besok'), []);
});
