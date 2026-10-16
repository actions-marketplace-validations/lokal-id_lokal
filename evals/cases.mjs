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
];
