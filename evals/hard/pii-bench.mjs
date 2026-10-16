// Hard PII benchmark for Samaran: real-world Indonesian document formats with fake identities.
// Every `secret` must disappear from the masked text; every `keep` value must survive it (false-positive trap).
// Run after `npm run build`: node evals/hard/pii-bench.mjs [--verbose]

import { Samaran } from '../../packages/core/dist/index.js';

const cases = [
  {
    format: 'KTP hasil OCR',
    text:
      'PROVINSI JAWA BARAT\nKOTA DEPOK\nNIK : 3276014503920003\nNama : SITI RAHAYU\nTempat/Tgl Lahir : DEPOK, 05-03-1992\n' +
      'Jenis Kelamin : PEREMPUAN Gol. Darah : O\nAlamat : JL. MARGONDA RAYA NO. 45\nRT/RW : 003/005\nKel/Desa : DEPOK\n' +
      'Kecamatan : PANCORAN MAS\nAgama : ISLAM\nStatus Perkawinan : KAWIN\nPekerjaan : KARYAWAN SWASTA\nKewarganegaraan : WNI',
    secrets: ['3276014503920003', 'SITI RAHAYU', '05-03-1992', 'JL. MARGONDA RAYA NO. 45', 'ISLAM', 'KAWIN'],
    keep: ['PROVINSI JAWA BARAT', 'KOTA DEPOK'],
  },
  {
    format: 'Chat WhatsApp (export)',
    text:
      'Chat WhatsApp dengan Dewi Lestari\n12/10/26 09.14 - Dewi Lestari: kak mug nya pecah\n' +
      '12/10/26 09.16 - Toko Kopi Senja: Mohon maaf kak Dewi\n[12/10/26 09.20:11] Maria Gebze: paket belum sampai',
    secrets: ['Dewi Lestari', 'Maria Gebze'],
    keep: ['Toko Kopi Senja', '12/10/26 09.14'],
  },
  {
    format: 'Chat bebas, nama tanpa pengantar',
    text: 'halo kak ini rina, pesanan saya dibatalin. tadi budi bilang paketnya udah dikirim',
    secrets: ['rina', 'budi'],
    keep: [],
  },
  {
    format: 'JSON nama terpisah (Midtrans customer_details)',
    text: '{"customer_details":{"first_name":"Siti","last_name":"Rahayu","email":"siti.rahayu88@example.com","phone":"+6281298765432"}}',
    secrets: ['"Siti"', '"Rahayu"', 'siti.rahayu88@example.com', '+6281298765432'],
    keep: ['customer_details'],
  },
  {
    format: 'Kesehatan di teks bebas',
    text: 'tolong dipercepat, isinya obat insulin buat ibu saya (diabetes). Beliau lagi dirawat di RSUD Cibinong karena DBD',
    secrets: ['insulin', 'diabetes', 'DBD'],
    keep: [],
  },
  {
    format: 'Rekening dan transfer',
    text: 'refund ke rek BCA 1234567890 a.n. Dewi Lestari. Atau mandiri 137-00-1234567-8 atas nama rina kartika sari',
    secrets: ['1234567890', 'Dewi Lestari', '137-00-1234567-8', 'rina kartika sari'],
    keep: ['BCA'],
  },
  {
    format: 'Nomor HP aneka format',
    text: 'hub 0812.3456.7890 / +62 857-1111-2222 / 62 878 1234 5678 / wa.me/6281377778888 / (0751) 812345',
    secrets: ['0812.3456.7890', '+62 857-1111-2222', '62 878 1234 5678', '6281377778888', '(0751) 812345'],
    keep: [],
  },
  {
    format: 'Nomor HP di akhir baris, baris berikutnya diawali angka',
    text: 'Chat WhatsApp dengan +62 881-2345-6789\n14/10/26 08.30 - halo\nhp=0812-3456-7890\n2026-10-01 08:12:40 ERROR',
    secrets: ['881-2345-6789', '0812-3456-7890'],
    keep: ['14/10/26 08.30', '2026-10-01 08:12:40'],
  },
  {
    format: 'NIK ditulis aneh',
    text: 'NIK saya 3276 0145 0392 0003, KK: 3276.0101.0101.0005',
    secrets: ['3276 0145 0392 0003', '3276.0101.0101.0005'],
    keep: [],
  },
  {
    format: 'Email disamarkan manual',
    text: 'kirim invoice ke siti.rahayu88 [at] gmail [dot] com ya',
    secrets: ['siti.rahayu88'],
    keep: [],
  },
  {
    format: 'NPWP, BPJS, SIM, paspor, plat',
    text:
      'NPWP 09.254.294.3-407.000, No. BPJS Kesehatan 0001234567890, SIM 1234-5678-901234, ' +
      'paspor C1234567, plat B 1234 XYZ',
    secrets: ['09.254.294.3-407.000', '0001234567890', '1234-5678-901234', 'C1234567', 'B 1234 XYZ'],
    keep: [],
  },
  {
    format: 'Log Laravel dengan payload',
    text:
      '[2026-10-02 13:25:41] production.ERROR: Gagal verifikasi KTP {"order_id":"2610017EF5UV2R","nik":"9671012511870004",' +
      '"nama":"Andi Wijaya","alamat":"Jl. Basuki Rahmat No. 9, Kota Sorong"}',
    secrets: ['9671012511870004', 'Andi Wijaya', 'Jl. Basuki Rahmat No. 9'],
    keep: ['2610017EF5UV2R', '2026-10-02 13:25:41', 'production.ERROR'],
  },
  {
    format: 'SQL dump',
    text:
      "INSERT INTO pelanggan (id, nama, nik, no_hp, alamat) VALUES (17, 'Hendra Gunawan', '1371011010850008', " +
      "'0813-9999-0000', 'Jl. Sudirman No. 20, Padang');",
    secrets: ['Hendra Gunawan', '1371011010850008', '0813-9999-0000', 'Jl. Sudirman No. 20'],
    keep: ['INSERT INTO pelanggan'],
  },
  {
    format: 'Jebakan: nomor yang bukan data pribadi',
    text:
      'Invoice INV/20260316/MPL/3812345678, no. pesanan 2610014KQ7ZB2M, resi SPXID045123456789, JX4417730215, ' +
      'CGK7700123456789. Total Rp1.250.000 (Rp1,25 jt). Timestamp 1773628800000. Hubungi Halo BCA 1500888 atau ' +
      'call center Pos 1500161. SKU 8991002101234.',
    secrets: [],
    keep: [
      'INV/20260316/MPL/3812345678', '2610014KQ7ZB2M', 'SPXID045123456789', 'JX4417730215', 'CGK7700123456789',
      'Rp1.250.000', '1773628800000', '1500888', '1500161', '8991002101234',
    ],
  },
  {
    format: 'Jebakan: tempat, lembaga, dan teks resmi',
    text:
      'Kantor kami di Jl. Jenderal Sudirman Kav. 52-53, Jakarta Selatan. Rapat dengan Bank Mandiri dan Universitas ' +
      'Gadjah Mada di Gedung Sate. Sesuai UU Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi, Pasal 4 ayat (2).',
    secrets: [],
    keep: ['Bank Mandiri', 'Universitas Gadjah Mada', 'Gedung Sate', 'UU Nomor 27 Tahun 2022', 'Pasal 4'],
  },
];

const verbose = process.argv.includes('--verbose');
let caught = 0, totalSecrets = 0, kept = 0, totalKeep = 0;
const rows = [];
for (const c of cases) {
  const { text } = new Samaran().mask(c.text);
  const leaked = c.secrets.filter((s) => text.includes(s));
  const broken = c.keep.filter((k) => !text.includes(k));
  caught += c.secrets.length - leaked.length; totalSecrets += c.secrets.length;
  kept += c.keep.length - broken.length; totalKeep += c.keep.length;
  rows.push({ c, leaked, broken, text });
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
console.log(`Samaran hard benchmark: ${cases.length} formats`);
console.log(`  terdeteksi : ${caught}/${totalSecrets} data pribadi (${pct(caught, totalSecrets)})`);
console.log(`  utuh       : ${kept}/${totalKeep} nilai bukan data pribadi (${pct(kept, totalKeep)})\n`);
for (const { c, leaked, broken, text } of rows) {
  const ok = !leaked.length && !broken.length;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.format}`);
  if (leaked.length) console.log(`      lolos     : ${leaked.join(' | ')}`);
  if (broken.length) console.log(`      salah samar: ${broken.join(' | ')}`);
  if (verbose && !ok) console.log(`      hasil     : ${text.replace(/\n/g, '\n                  ')}`);
}
