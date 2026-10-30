import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Samaran, detectPii, maskPii } from '../src/index.ts';

test('placeholder-like text in the input keeps its number; real values never restore into it', () => {
  const s = new Samaran();
  const text = 'Template: "Halo [NAME_1], NIK kamu [NIK_1]". Data: Budi Santoso, NIK 3201011508950001';
  const { text: masked } = s.mask(text);
  assert.equal(masked, 'Template: "Halo [NAME_1], NIK kamu [NIK_1]". Data: [NAME_2], NIK [NIK_2]');
  assert.equal(s.unmask(masked), text);
  // A placeholder this vault made, quoted back by the user, still means that person.
  assert.equal(s.mask('Bagaimana dengan [NAME_2]? Ada juga Siti Aminah.').text, 'Bagaimana dengan [NAME_2]? Ada juga [NAME_3].');
  // Several parts of one request: reserve them all first.
  const r = new Samaran();
  r.reserve('Pelanggan: Joko Susilo ... template: Yth. [NAME_4]');
  assert.equal(r.mask('Pelanggan: Joko Susilo').text, 'Pelanggan: [NAME_5]');
  // Partial mode has no placeholders to collide with; absurd numbers are not reserved.
  assert.equal(new Samaran({ mode: 'partial' }).mask('[NIK_3] 3201011508950001').text, '[NIK_3] 3201********0001');
  assert.equal(new Samaran().mask('[NIK_99999999999] NIK 3201011508950001').text, '[NIK_99999999999] NIK [NIK_1]');
});

const chat = [
  'Halo kak, saya mau komplain. Nama: Budi Santoso',
  'NIK 3201011508950001, NPWP 01.234.567.8-901.000',
  'HP 0812-3456-7890 atau email budi.santoso@gmail.com',
  'Refund ke rek BCA 1234567890 a.n. Budi Santoso ya',
  'Alamat Jl. Mawar No. 5 RT 03/RW 07, motor B 1234 XYZ',
].join('\n');

test('a CSV pasted after a sentence is still read by its columns, and ends where its rows end', () => {
  const pasted = 'Tolong cek data ini ya:\nnama,agama,diagnosa,no_bpjs\nSiti Aminah,Katolik,asma,0001234567890\nAgus Salim,Islam,TBC,0009876543210\n\nmakasih, nanti kabari';
  const { text } = new Samaran().mask(pasted);
  for (const v of ['Siti Aminah', 'Katolik', 'asma', '0001234567890', 'Agus Salim', 'TBC']) assert.ok(!text.includes(v), `${v} leaked`);
  assert.match(text, /^Tolong cek data ini ya:\nnama,agama,diagnosa,no_bpjs\n/);
  assert.match(text, /\n\nmakasih, nanti kabari$/, 'the sentence after the table is not a row');
  // The table ends at a line that is not one of its rows.
  const after = 'Datanya:\nnama,kota\nRina Wati,Depok\nmakasih ya';
  assert.equal(new Samaran().mask(after).text, 'Datanya:\nnama,kota\n[NAME_1],Depok\nmakasih ya');
  // A data row with a field name in it is not a header: labels from an image dataset.
  const labels = 'n01687978\tagama\nn01688243\tfrilled lizard\nn01689811\tChamaeleo oweni';
  assert.deepEqual(detectPii(`daftar label:\n${labels}`).map((m) => m.type), []);
  // A sentence with commas is still not a header.
  assert.equal(new Samaran().mask('Catatan rapat:\nhadir, izin, sakit\n3, 1, 0').text, 'Catatan rapat:\nhadir, izin, sakit\n3, 1, 0');
});

test('text from JSON or a log keeps its labels across escaped line breaks and quotes', () => {
  const values = (t: string) => detectPii(t).map((m) => `${m.type}:${m.value}`);
  // One round of JSON ("\n"), and two (a tool call's arguments: "\\n").
  const form = 'Nama: Kenanga Purbasari\nPaspor: C7788120\nAgama: Konghucu\nDiagnosa: hipertensi';
  const expected = ['NAME:Kenanga Purbasari', 'PASSPORT:C7788120', 'RELIGION:Konghucu', 'HEALTH:hipertensi'];
  assert.deepEqual(values(JSON.stringify({ data: form })), expected);
  assert.deepEqual(values(JSON.stringify(JSON.stringify({ data: form }))), expected);
  // The value ends where its string does: the closing quote stays, so masked JSON is still JSON.
  const masked = new Samaran().mask('{"catatan":"Agama: Konghucu","nama":"Budi \\"Bob\\" Santoso"}').text;
  assert.equal(masked, '{"catatan":"Agama: [RELIGION_1]","nama":"[NAME_1]"}');
  assert.doesNotThrow(() => JSON.parse(masked));
  // A Windows path is not a line break, and its text is left as it was.
  assert.deepEqual(values('path C:\\new\\data, Nama: Budi Santoso'), ['NAME:Budi Santoso']);
});

test('JSON and CSV inside a JSON string are read with their field names', () => {
  // A log line with the request body as a string, and a tool call's arguments carrying a CSV export.
  const body = JSON.stringify({ level: 'info', body: JSON.stringify({ nama: 'Siti Aminah', agama: 'Katolik', diagnosa: 'asma' }) });
  const csv = JSON.stringify({ data: 'nama,agama\n"Agus Salim","Islam"\n' });
  for (const t of [body, csv, JSON.stringify({ args: body })]) {
    const s = new Samaran();
    const out = s.mask(t).text;
    for (const v of ['Siti Aminah', 'Katolik', 'asma', 'Agus Salim', 'Islam']) assert.ok(!out.includes(v), `${v} leaked from ${t}`);
    assert.doesNotThrow(() => JSON.parse(out), 'still JSON');
    assert.equal(s.unmask(out), t);
  }
  // Many bodies are read in one pass, and a match never joins two of them.
  const many = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ body: JSON.stringify({ id: i, nama: 'Rina Wati' }) })));
  assert.doesNotThrow(() => JSON.parse(new Samaran().mask(many).text));
  assert.ok(!new Samaran().mask(many).text.includes('Rina'));
  // A CSV header after a log prefix.
  assert.equal(new Samaran().mask('import csv: nama,kota\nDewi Lestari,Depok').text, 'import csv: nama,kota\n[NAME_1],Depok');
});

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

test('placeholder() memberi placeholder untuk nilai yang sudah diketahui pribadi', () => {
  const s = new Samaran();
  const { text } = s.mask('HP 0812-3456-7890');
  assert.equal(s.placeholder('PHONE', '+62 812 3456 7890'), '[PHONE_1]', 'the same number as mask found');
  const street = s.placeholder('ADDRESS', 'Jl. Melati No. 5');
  assert.equal(street, '[ADDRESS_1]');
  assert.equal(s.placeholder('ADDRESS', 'Jl. Melati No. 5'), street);
  assert.equal(s.unmask(`${text}, ${street}`), 'HP 0812-3456-7890, Jl. Melati No. 5');
  assert.throws(() => s.placeholder('ALAMAT' as never, 'x'), /Unknown PII type/);
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
  // (A name the gazetteer does not know, so only the header could make it a name.)
  assert.deepEqual(values('12\tnama,nik\n7\tWiro Sableng,3201011508950001', ['NAME']), []);
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

test('nama tanpa label: peran, sapaan, gelar, tanda tangan, dan pengirim email', () => {
  assert.deepEqual(values('Pelanggan Budi Santoso minta refund, Kurir Supardi sudah antar', ['NAME']), [
    'NAME:Budi Santoso', 'NAME:Supardi',
  ]);
  assert.deepEqual(values('Dear Mr. Hendra Gunawan,\nThank you.', ['NAME']), ['NAME:Hendra Gunawan']);
  assert.deepEqual(values('Halo Budi,\nPesanan kamu sudah dikirim.', ['NAME']), ['NAME:Budi']);
  assert.deepEqual(values('Mohon dibantu.\n\nSalam,\nRina Kartika Sari\nFinance', ['NAME']), ['NAME:Rina Kartika Sari']);
  assert.deepEqual(values('From: Budi Santoso <budi.s@gmail.com>', ['NAME']), ['NAME:Budi Santoso']);
  assert.deepEqual(values('/*! ws. MIT License. Einar Otto Stangvik <einaros@gmail.com> */', ['NAME']), ['NAME:Einar Otto Stangvik']);
  assert.deepEqual(values('aku andi yg td chat', ['NAME']), ['NAME:andi']);
  assert.deepEqual(values('No. KK: 3201012345678901 (kepala keluarga Bambang)', ['NAME']), ['NAME:Bambang']);
  // Not names: a role with an adjective, a greeting to a group or a city, a business signing off.
  assert.deepEqual(
    values('Pelanggan Setia dapat diskon. Kurir JNE datang. Halo Semua, Halo Bandung, Hai Kakak!\n\nSalam,\nTim Lokal', ['NAME']),
    [],
  );
});

test('nama dikenali dari bagiannya: nama depan umum, marga, nama Bali dan Tionghoa', () => {
  assert.deepEqual(
    values('Yang bertanggung jawab Togar Simanjuntak. Tamu: I Made Wirawan dan Ni Luh Putu Ayu. Pemilik koh Lim Swie Hong.', ['NAME']),
    ['NAME:Togar Simanjuntak', 'NAME:I Made Wirawan', 'NAME:Ni Luh Putu Ayu', 'NAME:Lim Swie Hong'],
  );
  // A bank statement in capitals: the name starts at SITI, not at the transaction code.
  assert.deepEqual(values('22/10 BI-FAST CR TRANSFER DR 014 SITI RAHAYU 75000.00', ['NAME']), ['NAME:SITI RAHAYU']);
  // Places and organizations named after people, and words that are also given names.
  assert.deepEqual(
    values('Masjid Agung, Universitas Ahmad Dahlan, RS Siti Khadijah, Toko Budi Jaya, Jl. Ahmad Yani. Pendidikan Budi Pekerti. Permata Intan, Mekar Sari, Lumban Siregar.', ['NAME']),
    [],
  );
});

test('identitas di tempat aneh: nama file, URL, HTML, handle, label bertumpuk', () => {
  assert.deepEqual(values('upload KTP_3201011508950001.jpg, NIK3201011508950001', ['NIK']), [
    'NIK:3201011508950001', 'NIK:3201011508950001',
  ]);
  assert.deepEqual(values('?name=Siti%20Rahayu&email=siti%40gmail.com'), ['NAME:Siti%20Rahayu', 'EMAIL:siti%40gmail.com']);
  assert.deepEqual(values('<input name="nik" value="3201011508950001"><input name="nama" value="Budi Santoso">'), [
    'NIK:3201011508950001', 'NAME:Budi Santoso',
  ]);
  assert.deepEqual(values('<tr><th>Nama</th><th>HP</th></tr><tr><td>Budi Santoso</td><td>081234567890</td></tr>'), [
    'NAME:Budi Santoso', 'PHONE:081234567890',
  ]);
  assert.deepEqual(values('cek DM dari @siti.rahayu88', ['NAME']), ['NAME:siti.rahayu88']);
  assert.deepEqual(values('Transfer berhasil\r\nPenerima\r\nDEWI LESTARI\r\nNominal Rp 250.000', ['NAME']), ['NAME:DEWI LESTARI']);
  // Code: JSDoc tags, decorators, npm scopes, CSS, and the domain of a masked address.
  assert.deepEqual(
    values('/** @param options.abortSignal */\n@pytest.fixture\nnpm i @types/node; @media print; b***@gmail.com'),
    [],
  );
});

test('nomor HP dan alamat dalam format yang tidak baku', () => {
  assert.deepEqual(values('Telp: +62 (812) 3456-7890, no wa 08 12 34 56 78 90, wa081234567890, rumah 0251 8321234', ['PHONE']), [
    'PHONE:+62 (812) 3456-7890', 'PHONE:08 12 34 56 78 90', 'PHONE:081234567890', 'PHONE:0251 8321234',
  ]);
  assert.deepEqual(values('nomor gue nol delapan satu dua tiga empat lima enam tujuh delapan sembilan', ['PHONE']), [
    'PHONE:nol delapan satu dua tiga empat lima enam tujuh delapan sembilan',
  ]);
  assert.deepEqual(values('Komplek Taman Asri blok B no 9, deket masjid', ['ADDRESS']), ['ADDRESS:Komplek Taman Asri blok B no 9']);
  assert.deepEqual(values('Dusun Krajan RT 02 RW 01 Desa Sukamaju', ['ADDRESS']), ['ADDRESS:Dusun Krajan RT 02 RW 01']);
  assert.deepEqual(values('alamat jl mawar 5 cibinong ya', ['ADDRESS']), ['ADDRESS:jl mawar 5']);
  // Not phones or addresses.
  assert.deepEqual(values('kode pos 16911, harga 0251 8321, jalan kaki 5 menit, jl. raya macet 2 jam, SK No. 100.3.3.1-6117'), []);
});

test('data sensitif UU PDP dalam bahasa sehari-hari', () => {
  assert.deepEqual(values('saya muslim, suami saya kristen protestan', ['RELIGION']), [
    'RELIGION:muslim', 'RELIGION:kristen protestan',
  ]);
  assert.deepEqual(values('saya sudah cerai sejak 2020, sekarang janda', ['MARITAL_STATUS']), [
    'MARITAL_STATUS:cerai', 'MARITAL_STATUS:janda',
  ]);
  assert.deepEqual(values('ayah stroke, riwayat hipertensi dan diabetes melitus, alergi penisilin, keluhan demam', ['HEALTH']), [
    'HEALTH:stroke', 'HEALTH:hipertensi dan diabetes melitus', 'HEALTH:penisilin', 'HEALTH:demam',
  ]);
  assert.deepEqual(values('utang pinjol 12 juta, udah galbay 3 bulan', ['FINANCIAL']), ['FINANCIAL:12 juta', 'FINANCIAL:galbay']);
  assert.deepEqual(values('dia mantan napi kasus narkoba, pernah dipenjara 3 tahun', ['CRIMINAL_RECORD']), [
    'CRIMINAL_RECORD:mantan napi kasus narkoba', 'CRIMINAL_RECORD:pernah dipenjara 3 tahun',
  ]);
  // The same words about groups, institutions, or the news.
  assert.deepEqual(
    values('Makanan halal untuk umat Muslim. Gereja Kristen Jawa. Hari Kanker Sedunia. Kasus narkoba meningkat menurut BNN. Risiko gagal bayar obligasi. Saya menikah tahun depan.'),
    [],
  );
});

test('KTP tanpa titik dua, HL7, rekening di baris bawah bank', () => {
  assert.deepEqual(values('Jenis Kelamin LAKI-LAKI\nAgama KRISTEN\nStatus Perkawinan KAWIN', ['GENDER', 'RELIGION', 'MARITAL_STATUS']), [
    'GENDER:LAKI-LAKI', 'RELIGION:KRISTEN', 'MARITAL_STATUS:KAWIN',
  ]);
  assert.deepEqual(values('PID|1||RM-00123||SUSANTO^BUDI||19800412|M\nDG1|1||E11.9^Diabetes melitus tipe 2'), [
    'NAME:SUSANTO^BUDI', 'BIRTH_DATE:19800412', 'GENDER:M', 'HEALTH:E11.9^Diabetes melitus tipe 2',
  ]);
  assert.deepEqual(values('Penerima\nANDI PRATAMA\nBank BNI\n0123456789'), ['NAME:ANDI PRATAMA', 'BANK_ACCOUNT:0123456789']);
  assert.deepEqual(values("'name' => 'Ahmad Fauzan', 'phone' => '081277665544'"), ['NAME:Ahmad Fauzan', 'PHONE:081277665544']);
  // A JavaScript arrow function is not a field.
  assert.deepEqual(values('const f = phone => format(phone); names.map(name => name.trim())'), []);
});

test('nama dari konteks: umur, absensi, pasangan, log, bahasa daerah', () => {
  assert.deepEqual(values('Pelaku Kevin (19) ditangkap. Tidak hadir: Wahyu (sakit), Dinda (izin).', ['NAME']), [
    'NAME:Kevin', 'NAME:Wahyu', 'NAME:Dinda',
  ]);
  assert.deepEqual(values('Akad nikah Dimas & Anggun', ['NAME']), ['NAME:Dimas', 'NAME:Anggun']);
  assert.deepEqual(values('login ok user=dimas.anggara ip=10.1.2.3', ['NAME']), ['NAME:dimas.anggara']);
  assert.deepEqual(values('[10:21] rizky_pratama: deploy jam 3', ['NAME']), ['NAME:rizky_pratama']);
  assert.deepEqual(values('Punten, nami abdi Asep Saepudin', ['NAME']), ['NAME:Asep Saepudin']);
  assert.deepEqual(values('Dodi masih punya utang ke aku', ['NAME']), ['NAME:Dodi']);
  // Accounts, code, headings, and products.
  assert.deepEqual(
    values('user=root user=postgres. new Array(16), Map (2). Pasal 5 (2). Paket Hemat Ramadhan. tinggal di Wina.', ['NAME']),
    [],
  );
});

test('kesehatan, keuangan, dan status dalam kalimat sehari-hari', () => {
  assert.deepEqual(values('sudah 3 hari demam dan batuk. Hasil MCU: tekanan darah 150/95, kolesterol tinggi.', ['HEALTH']), [
    'HEALTH:demam dan batuk', 'HEALTH:tekanan darah 150/95', 'HEALTH:kolesterol tinggi',
  ]);
  assert.deepEqual(values('Saldo tabungan saya per hari ini Rp 45.300.000, gaji pokok Rp 5.100.000', ['FINANCIAL']), [
    'FINANCIAL:Rp 45.300.000', 'FINANCIAL:Rp 5.100.000',
  ]);
  assert.deepEqual(values('Bu Kartini itu janda anak dua. Pemohon status cerai hidup. Kami pisah ranjang.', ['MARITAL_STATUS']), [
    'MARITAL_STATUS:janda', 'MARITAL_STATUS:cerai hidup', 'MARITAL_STATUS:pisah ranjang',
  ]);
  assert.deepEqual(values('aku katolik, pacarku muslim. Dia baru pindah agama, sekarang Kristen.', ['RELIGION']), [
    'RELIGION:katolik', 'RELIGION:muslim', 'RELIGION:Kristen',
  ]);
  // Ads, articles, and policy text.
  assert.deepEqual(
    values('Deposito mulai Rp 10 juta, bunga 5%. Gejala diabetes antara lain sering haus. Kami tidak menyimpan riwayat penyakit yang Anda masukkan.'),
    [],
  );
});

test('kata konteks: NIK hasil OCR, tanggal lahir di baris data, marga Tionghoa di akhir nama', () => {
  // OCR reads 0 as O and 1 as l on a card photo; the label says what the number is.
  assert.deepEqual(values('NIK : 33O521 6805000l43\nNama : WULAN HARTONO', ['NIK', 'KK']), ['NIK:33O521 6805000l43']);
  assert.deepEqual(values('No. KK: 32O1O12OO1OOOO17', ['NIK', 'KK']), ['KK:32O1O12OO1OOOO17']);
  // Digits only stay with the digit-run detector, and a word is not a number.
  assert.deepEqual(values('NIK : 3201011508950001', ['NIK']), ['NIK:3201011508950001']);
  assert.deepEqual(values('NIK : lolos verifikasi ok', ['NIK', 'KK']), []);
  // A record with the birth date after the name, but not a dated letter or a date in the future.
  assert.deepEqual(values('Sinta Wibowo, 12-03-1960, Jl. Cempaka No. 120', ['BIRTH_DATE']), ['BIRTH_DATE:12-03-1960']);
  assert.deepEqual(values('Jakarta Selatan, 12-03-2024, perihal undangan', ['BIRTH_DATE']), []);
  assert.deepEqual(values('Sinta Wibowo, 12-03-2999, Jl. Cempaka', ['BIRTH_DATE']), []);
  assert.deepEqual(values('Sinta Wibowo, 31-02-1960, Jl. Cempaka', ['BIRTH_DATE']), []);
  assert.deepEqual(values('Peserta: Dewi Lim dan Ayu Tan hadir. Wati Rahayu izin.', ['NAME']), [
    'NAME:Dewi Lim', 'NAME:Ayu Tan', 'NAME:Wati Rahayu',
  ]);
  assert.deepEqual(values('Ia seorang muslim taat. religion - Islam. Ybs nonmuslim.', ['RELIGION']), [
    'RELIGION:muslim', 'RELIGION:Islam', 'RELIGION:nonmuslim',
  ]);
  // About a group, not a person.
  assert.deepEqual(values('umat Hindu di desa itu, pendidikan agama-Islam', ['RELIGION']), []);
});
