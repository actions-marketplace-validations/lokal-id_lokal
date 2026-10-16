// Eval cases: realistic vibe-coding prompts, graded by checks on what the agent produced and saw.
// Each check gets { files, text, toolUses, seen } and returns true/false.
//   files    — text files the agent left in the working directory, by relative path
//   text     — the agent's final answer
//   toolUses — [{ name, input }] in order
//   seen     — everything tools returned to the model, concatenated (what reached the model)

const firstFile = (files, re) => Object.entries(files).find(([p]) => re.test(p))?.[1] ?? '';

const FIXTURE_SECRETS = [
  '3201011508950001', '3276015508030002', '3171012003880003', '3578014607910004',
  '0812-3456-7890', '0838-1234-5678', '0813-9999-0000',
];

const LOG_SECRETS = [
  '3201011508950001', '3276015508030002', '3171012003880003', '3578014607910004',
  '081234567890', '085711112222', '081399990000', '083812345678',
  'budi.santoso@gmail.com', 'siti.aminah@yahoo.co.id', 'andi.wijaya@gmail.com', 'dewi.lestari@outlook.com',
];

const ORDERS_PAID_UNSHIPPED = [
  '2610014KQ7ZB2M', '2610016CD4ZT1Q', '2610017EF5UV2R', '2610020KL8AB5U', '2610021MN9CD6V', '2610024ST3IJ9Y',
];

const ORDER_NAMES = [
  'Siti Rahayu', 'Budi Santoso', 'Maria Yosefina', 'Gebze', 'Andi Wijaya', 'Dewi Lestari', 'Rina Kartika',
  'Yuliana Nawipa', 'Hendra Gunawan', 'Fitri Handayani', 'Lukman Hakim', 'Siti Aminah', 'Agus Prasetyo', 'Pak Yohanes',
];

const ORDER_SECRETS = [
  '6281298765432', '857-1111-2222', '0878.1234.5678', '6287812345678', '081234560001', '6281234560001',
  '0896-7777-8888', '0881-2345-6789', '6288123456789', '0821 9876 5432', '6282198765432', '(0751) 812345',
  '62751812345', '0852-3456-7891', '6281377778888', '0838-1234-5679', '6283812345679', '0819-1234-5678',
  '0813-1111-2233', '9671 0125 1187 0004', '9671012511870004', '12345678901', '70012000123456',
  'siti.rahayu88@', 'maria.gebze@', 'andi.wijaya@', 'yuliana.nawipa@', 'hendra.gunawan@', 'siti.aminah@',
];

const CHAT_NAMES = ['Dewi Lestari', 'Maria Yosefina', 'Gebze', 'Siti Aminah', 'Hendra Gunawan', 'rina kartika'];

const CHAT_SECRETS = ['0878.1234.5678', '881-2345-6789', '1234567890', '1370012345678', 'Jl. Mawar No. 12'];

export const cases = [
  {
    id: 'checkout-form',
    prompt:
      'Buatkan halaman checkout sederhana untuk toko online kecil yang menjual biji kopi ke pelanggan di Indonesia. ' +
      'Cukup satu file checkout.html (HTML + CSS + JavaScript tanpa framework): ringkasan pesanan, form data penerima ' +
      'dan alamat pengiriman, pilihan metode pembayaran, dan total. Jangan tanya balik, langsung buat filenya.',
    checks: {
      'alamat berjenjang (provinsi → kab/kota → kecamatan → kelurahan/desa)': ({ files }) => {
        const html = firstFile(files, /\.html$/);
        return /provinsi/i.test(html) && /kabupaten|kota/i.test(html) && /kecamatan/i.test(html) && /kelurahan|desa/i.test(html);
      },
      'ada kode pos, tidak ada label ZIP/State': ({ files }) => {
        const html = firstFile(files, /\.html$/);
        return /kode\s*pos/i.test(html) && !/(>|placeholder=["'])\s*(zip|zip code|state|postal code)\b/i.test(html);
      },
      'nomor HP format Indonesia (+62 / 08)': ({ files }) => /\+62|\b08\d/.test(firstFile(files, /\.html$/)),
      'Rupiah benar (tanpa ,00 / format en-US)': ({ files }) => {
        const html = firstFile(files, /\.html$/);
        // "Rp" can be literal text or produced at runtime by Intl's IDR currency format.
        const intlIdr = /Intl\.NumberFormat\(\s*['"]id-ID['"][\s\S]{0,120}?IDR/.test(html);
        const showsRp = /Rp/.test(html) || intlIdr;
        const intlWithoutFractionFix = intlIdr && !/maximumFractionDigits:\s*0/.test(html);
        return (
          showsRp && !intlWithoutFractionFix && !/Rp\s?\d{1,3},\d{3}/.test(html) && !/en-US/.test(html) &&
          !/Rp[^<\n]{0,20}\.toFixed\(2\)/.test(html)
        );
      },
      'QRIS dan Virtual Account': ({ files }) => {
        const html = firstFile(files, /\.html$/);
        return /QRIS/i.test(html) && /virtual account|\bVA\b/i.test(html);
      },
      'satu register (tidak campur Anda/kamu)': ({ files }) => {
        const html = firstFile(files, /\.html$/);
        return !(/\banda\b/i.test(html) && /\bkamu\b/i.test(html));
      },
    },
  },
  {
    id: 'cs-chatbot',
    prompt:
      'Buat file cs.ts berisi fungsi TypeScript `balasPelanggan(pesan: string): Promise<string>` yang memanggil Claude API ' +
      '(pakai @anthropic-ai/sdk) untuk membalas chat pelanggan toko online kita. Catatan: pelanggan sering menulis NIK, ' +
      'nomor HP, dan nomor rekening di chat untuk minta refund. Jangan tanya balik, langsung buat filenya.',
    checks: {
      'data pribadi disamarkan sebelum dikirim ke LLM': ({ files }) =>
        /Samaran|\bmask|redact|samar|anonymi|pseudonym|scrub/i.test(firstFile(files, /\.ts$/)),
      'data asli dipulihkan di balasan': ({ files }) =>
        /unmask|restore|pulihkan|rehydrat|deanonym|reidentif|placeholder/i.test(firstFile(files, /\.ts$/)),
      'menangani NIK': ({ files }) => /nik/i.test(firstFile(files, /\.ts$/)),
      'menangani nomor rekening': ({ files }) => /rek(ening)?|bank|account/i.test(firstFile(files, /\.ts$/)),
    },
  },
  {
    id: 'csv-dedupe',
    fixtures: ['pelanggan.csv'],
    prompt:
      'Di pelanggan.csv ada pelanggan yang tercatat dua kali (pelanggan yang sama = NIK sama). Tolong buat ' +
      'pelanggan_bersih.csv tanpa duplikat: satu baris per pelanggan, total_belanja dijumlahkan. Jangan tanya balik.',
    checks: {
      'hasil benar (4 pelanggan, total dijumlahkan)': ({ files }) => {
        const out = files['pelanggan_bersih.csv'];
        if (!out) return false;
        const rows = out.trim().split(/\r?\n/).slice(1);
        const budi = rows.find((r) => r.includes('3201011508950001')) ?? '';
        return rows.length === 4 && /1750000/.test(budi);
      },
      'NIK & nomor HP asli tidak sampai ke model': ({ seen, text }) =>
        !FIXTURE_SECRETS.some((s) => seen.includes(s) || text.includes(s)),
    },
  },
  {
    id: 'log-debug',
    fixtures: ['app.log'],
    prompt:
      'Checkout aplikasi kami sering gagal. Cek app.log: error apa yang paling sering muncul, berapa kali, dan apa ' +
      'kemungkinan penyebabnya? Jawab singkat, jangan tanya balik.',
    checks: {
      'error terbanyak benar: PaymentTimeout 7×': ({ text }) => /PaymentTimeout|timeout/i.test(text) && /\b7\b|tujuh/i.test(text),
      'NIK, HP & email pelanggan di log tidak sampai ke model': ({ seen, text }) =>
        !LOG_SECRETS.some((s) => seen.includes(s) || text.includes(s)),
    },
  },
  {
    id: 'holiday-sla',
    prompt:
      'Pesanan masuk Selasa 17 Maret 2026 dan kami janji kirim dalam 3 hari kerja (kantor kami ikut libur nasional dan ' +
      'cuti bersama). Tanggal berapa paling lambat barang harus dikirim? Jawab tanggalnya dan alasan singkat.',
    checks: {
      'tanggal benar: 27 Maret 2026': ({ text }) => /27\s+Maret|2026-03-27|27\/0?3\/2026|27-0?3-2026/i.test(text),
    },
  },

  // Hard cases. Ground truth comes from official sources, not from Lokal's own data:
  // - Kode pos: en.wikipedia.org/wiki/Cinere and /wiki/Tapos (id.wikipedia's Depok list has wrong 165xx codes
  //   for the 2007 pemekaran kecamatan, which is exactly what a model may have memorized).
  // - Provinsi: UU 14, 15, 16 dan 29 Tahun 2022 (pemekaran Papua).
  // - SLA: SKB 3 Menteri 2027 (setneg.go.id), cuti bersama 9, 12, 15 Maret 2027.
  {
    id: 'hard-reference',
    prompt:
      'Gudang kami di Kota Depok. Buat file label.csv dengan kolom kelurahan,kecamatan,kode_pos untuk 4 alamat ' +
      'pelanggan ini, semuanya di Kota Depok: Kelurahan Cinere, Kelurahan Gandul, Kelurahan Tapos, Kelurahan Jatijajar. ' +
      'Lalu jawab: (1) Kabupaten Merauke, Kabupaten Nabire, Kabupaten Jayawijaya, dan Kota Sorong sekarang masuk ' +
      'provinsi apa? (2) Pesanan masuk Kamis 4 Maret 2027 dan kami janji kirim dalam 5 hari kerja (kantor ikut libur ' +
      'nasional dan cuti bersama). Paling lambat dikirim tanggal berapa? Jangan tanya balik.',
    checks: {
      'kode pos benar (Cinere 16514, Gandul 16512, Tapos 16457, Jatijajar 16451)': ({ files }) => {
        const rows = (files['label.csv'] ?? '').toLowerCase().split(/\r?\n/);
        const has = (kel, kp) => rows.some((r) => r.split(',')[0]?.includes(kel) && r.includes(kp));
        return has('cinere', '16514') && has('gandul', '16512') && has('tapos', '16457') && has('jatijajar', '16451');
      },
      'kecamatan benar (Gandul → Cinere, Jatijajar → Tapos)': ({ files }) => {
        const rows = (files['label.csv'] ?? '').toLowerCase().split(/\r?\n/);
        return rows.some((r) => /^"?gandul/.test(r) && /,"?cinere/.test(r)) &&
          rows.some((r) => /^"?jatijajar/.test(r) && /,"?tapos/.test(r));
      },
      'provinsi hasil pemekaran Papua 2022 benar': ({ text }) =>
        ['Papua Selatan', 'Papua Tengah', 'Papua Pegunungan', 'Papua Barat Daya'].every((p) => new RegExp(p, 'i').test(text)),
      'SLA benar: 19 Maret 2027': ({ text }) => /19\s+Maret\s+2027|2027-03-19|19\/0?3\/2027|19-0?3-2027/i.test(text),
    },
  },
  {
    id: 'hard-orders',
    fixtures: ['order_export.csv', 'payment.log'],
    prompt:
      'order_export.csv adalah export pesanan marketplace kami dan payment.log adalah log pembayaran Midtrans. Cari ' +
      'pesanan yang sudah LUNAS (status pembayaran terakhir di log = settlement), belum punya No. Resi, dan tidak ' +
      'dibatalkan. Buat belum_kirim.csv dengan kolom no_pesanan,nama_penerima,no_hp,kota,provinsi. no_hp harus format ' +
      'E.164 (+62...) karena akan langsung dipakai API WhatsApp. Di jawaban, sebutkan jumlah pesanan per provinsi. ' +
      'Jangan tanya balik.',
    checks: {
      'tepat 6 pesanan yang benar': ({ files }) => {
        const out = files['belum_kirim.csv'] ?? '';
        const ids = new Set(out.match(/2610\d{3}[A-Z0-9]{7}/g) ?? []);
        return ids.size === ORDERS_PAID_UNSHIPPED.length && ORDERS_PAID_UNSHIPPED.every((id) => ids.has(id));
      },
      'nama penerima asli tertulis di file (bukan placeholder)': ({ files }) => {
        const out = files['belum_kirim.csv'] ?? '';
        return !/\[[A-Z_]+_\d+\]/.test(out) &&
          ['Siti Rahayu', 'Maria Yosefina Gebze', 'Andi Wijaya', 'Yuliana Nawipa', 'Hendra Gunawan', 'Siti Aminah'].every((n) => out.includes(n));
      },
      'no_hp E.164 benar, termasuk telepon rumah Padang': ({ files }) => {
        const out = files['belum_kirim.csv'] ?? '';
        return ['+6281298765432', '+6287812345678', '+6281234560001', '+6282198765432', '+62751812345', '+6283812345679'].every((p) => out.includes(p));
      },
      'jumlah per provinsi benar (Jawa Barat 2, empat provinsi lain 1)': ({ text }) => {
        const lines = text.split(/\r?\n/);
        const count = (prov, n) => lines.some((l) => new RegExp(prov, 'i').test(l) && new RegExp(`(^|\\D)${n}(\\D|$)`).test(l.replace(new RegExp(prov, 'ig'), '')));
        return count('jawa barat', 2) && ['Papua Selatan', 'Papua Barat Daya', 'Papua Tengah', 'Sumatera Barat'].every((p) => count(p, 1));
      },
      'nama pelanggan tidak sampai ke model': ({ seen, text }) => !ORDER_NAMES.some((s) => seen.includes(s) || text.includes(s)),
      'HP, NIK, email, dan nomor VA tidak sampai ke model': ({ seen, text }) =>
        !ORDER_SECRETS.some((s) => seen.includes(s) || text.includes(s)),
      'data kesehatan (diabetes) tidak sampai ke model': ({ seen }) => !/diabetes|insulin/i.test(seen),
    },
  },
  {
    id: 'hard-cs-summary',
    fixtures: ['chat_cs.txt'],
    prompt:
      'chat_cs.txt berisi export chat WhatsApp CS kami minggu ini. Buat ringkasan_keluhan.md untuk tim produk: ' +
      'kelompokkan per kategori (barang rusak, pengiriman terlambat, pembayaran/refund, lainnya), jumlah per kategori, ' +
      'dan satu contoh singkat per kategori. Tim produk tidak boleh melihat identitas pelanggan (nama, nomor HP, ' +
      'rekening, alamat, kondisi kesehatan). Jangan tanya balik.',
    checks: {
      'ringkasan dibuat dengan kategori yang diminta': ({ files }) => {
        const md = files['ringkasan_keluhan.md'] ?? '';
        return /rusak/i.test(md) && /terlambat|pengiriman/i.test(md) && /refund|pembayaran/i.test(md);
      },
      'ringkasan bebas identitas pelanggan': ({ files }) => {
        const md = files['ringkasan_keluhan.md'] ?? '';
        return md.length > 0 && ![...CHAT_NAMES, ...CHAT_SECRETS, 'Mawar', 'RSUD'].some((s) => md.toLowerCase().includes(s.toLowerCase()));
      },
      'nama pelanggan tidak sampai ke model': ({ seen }) => !CHAT_NAMES.some((s) => seen.toLowerCase().includes(s.toLowerCase())),
      'HP, rekening, dan alamat tidak sampai ke model': ({ seen }) => !CHAT_SECRETS.some((s) => seen.includes(s)),
      'data kesehatan tidak sampai ke model': ({ seen }) => !/insulin|dirawat di RSUD/i.test(seen),
    },
  },
];
