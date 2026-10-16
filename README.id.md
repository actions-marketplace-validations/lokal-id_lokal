<div align="center">

# Lokal

**Bikin AI agent paham Indonesia.**

Skill, MCP server, dan pelindung privasi yang membantu Claude Code, Cursor, Codex, dan agent lain<br>
membangun aplikasi yang benar untuk Indonesia, sambil menjaga data pribadi pengguna tidak sampai ke model.

[![npm @lokal-id/mcp](https://img.shields.io/npm/v/@lokal-id/mcp?label=%40lokal-id%2Fmcp&color=cb3837)](https://www.npmjs.com/package/@lokal-id/mcp)
[![npm @lokal-id/core](https://img.shields.io/npm/v/@lokal-id/core?label=%40lokal-id%2Fcore&color=cb3837)](https://www.npmjs.com/package/@lokal-id/core)
[![CI](https://github.com/lokal-id/lokal/actions/workflows/ci.yml/badge.svg)](https://github.com/lokal-id/lokal/actions/workflows/ci.yml)
[![Lisensi: MIT](https://img.shields.io/badge/lisensi-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio-6e56cf)](https://modelcontextprotocol.io)

[Mulai cepat](#mulai-cepat) ·
[Fitur](#fitur) ·
[Pemakaian](#pemakaian) ·
[Hasil eval](#hasil-eval) ·
[Batasan](#batasan) ·
[**English**](README.md)

</div>

---

## Kenapa Lokal?

Minta AI agent "bikin form checkout", dan hasilnya hampir selalu bergaya Amerika:

| Tanpa Lokal | Dengan Lokal |
|---|---|
| Field *State* dan *ZIP code* | Provinsi → Kab/Kota → Kecamatan → Kelurahan/Desa dari data resmi Kemendagri |
| `Rp 1,500,000.00` | `Rp1.500.000` |
| Validasi telepon format AS | `0812-3456-7890` → `+6281234567890`, operator terdeteksi |
| Teks "Submit", campur Anda/kamu | "Kirim", satu register yang konsisten |
| Tidak ada QRIS, VA, atau e-wallet | QRIS, Virtual Account, GoPay/OVO/DANA, status lewat webhook |
| Data pelanggan dikirim mentah ke LLM | Disamarkan dulu (`[NIK_1]`, `[PHONE_1]`), lalu dipulihkan |

Masalah kedua jarang disadari. Saat debugging, developer menempel log produksi atau CSV pelanggan ke Claude atau Cursor, dan NIK, nomor HP, serta rekening pelanggan ikut terkirim ke penyedia model. Di bawah **UU PDP (UU 27/2022)**, itu risiko hukum yang nyata.

Lokal menangani keduanya: mengajari agent konvensi Indonesia, memberinya data acuan yang akurat, dan menempatkan **Samaran** di antara data kamu dan model.

## Fitur

- **Konvensi Indonesia untuk agent.** Uang, nomor telepon, NIK/NPWP, alamat berjenjang, WIB/WITA/WIT, metode pembayaran lokal, teks UI, dan UU PDP, dikemas sebagai [Agent Skills](https://agentskills.io).
- **Data acuan akurat, ikut terpasang.** 38 provinsi sampai 83.762 kelurahan/desa, sama persis dengan Kepmendagri 2025, lengkap dengan kode pos setiap desa. Libur nasional dan cuti bersama dari SKB resmi 2026 dan 2027.
- **Penyamaran Samaran.** Mengganti 25 jenis data pribadi Indonesia, termasuk semua kategori di UU PDP Pasal 4, dengan placeholder yang stabil, lalu memulihkannya di jawaban model.
- **Samaran Guard.** Hook Claude Code yang menahan prompt berisi nomor identitas dan mengalihkan pembacaan file data pelanggan (`Read`, `Grep`, `cat`, `Get-Content`, …) ke versi tersamar.
- **Jalan di agent mana pun.** Plugin Claude Code, MCP server stdio untuk Cursor, Claude Desktop, VS Code, Windsurf, dan Codex, plus library TypeScript.
- **Lokal dan offline.** Data ikut di dalam paket. Tidak ada panggilan jaringan, tidak ada telemetri, dan pemulihan data terjadi di komputer kamu.

## Cara kerja

<p align="center">
  <a href="docs/assets/architecture.id.svg"><img src="docs/assets/architecture.id.svg" alt="Arsitektur Lokal: developer memberi prompt ke AI agent di komputernya. Skill memberi agent konvensi Indonesia, Samaran Guard memeriksa prompt dan pembacaan file, dan MCP server Lokal mencari data acuan serta membaca dan menulis file project lewat Samaran, yang menyamarkan dan memulihkan data pribadi. Hanya konteks tersamar yang dikirim ke penyedia LLM." width="100%"></a>
</p>

Saat agent perlu melihat data pelanggan, ia memanggil `read_file_masked` dan melihat `[NAME_1], [NIK_1], [PHONE_1]`, bukan data aslinya. Agent tetap bisa deduplikasi, join, dan debugging, karena nilai yang sama selalu mendapat placeholder yang sama. Saat hasilnya ditulis lewat `write_file_unmasked`, Samaran mengembalikan data aslinya, di komputer kamu.

## Mulai cepat

### Claude Code

Memasang skill, MCP server, dan Samaran Guard sekaligus:

```text
/plugin marketplace add lokal-id/lokal
/plugin install lokal@lokal
```

<details>
<summary><b>Hanya MCP server</b> (tanpa skill dan guard)</summary>

```sh
claude mcp add lokal -- npx -y @lokal-id/mcp
```

</details>

### MCP di client lain

<details>
<summary><b>Cursor, Claude Desktop, Windsurf</b></summary>

Tambahkan ke `.cursor/mcp.json`, `claude_desktop_config.json`, atau `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "lokal": {
      "command": "npx",
      "args": ["-y", "@lokal-id/mcp"],
      "env": { "LOKAL_ROOT": "/path/ke/project" }
    }
  }
}
```

</details>

<details>
<summary><b>VS Code</b></summary>

Tambahkan ke `.vscode/mcp.json`:

```json
{
  "servers": {
    "lokal": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@lokal-id/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Codex CLI</b></summary>

Tambahkan ke `~/.codex/config.toml`:

```toml
[mcp_servers.lokal]
command = "npx"
args = ["-y", "@lokal-id/mcp"]
env = { LOKAL_ROOT = "/path/ke/project" }
```

</details>

Tool file (`scan_pii`, `read_file_masked`, `write_file_unmasked`) hanya bisa mengakses `LOKAL_ROOT`. Defaultnya `CLAUDE_PROJECT_DIR`, lalu folder tempat server dijalankan.

### Skill di agent lain

Folder [`skills/`](skills) mengikuti format terbuka Agent Skills (`SKILL.md`). Salin `skills/lokal-indonesia` dan `skills/samaran` ke folder skill agent kamu, misalnya `~/.claude/skills/` atau `~/.codex/skills/`.

### Library

```sh
npm install @lokal-id/core
```

## Pemakaian

### Library

```ts
import {
  parseNik, parsePhone, formatRupiah, parseRupiah, terbilang, addWorkingDays, isWorkingDay,
} from '@lokal-id/core';
import { listWilayah, searchWilayah, wilayahName, findByPostalCode } from '@lokal-id/core/wilayah';

parseNik('3201011508950001', { lookupWilayah: wilayahName });
// { valid: true, province: 'Jawa Barat', regency: 'Kabupaten Bogor', district: 'Cibinong',
//   gender: 'L', birthDate: '1995-08-15', … }

parsePhone('0812 3456 7890');
// { e164: '+6281234567890', national: '0812-3456-7890', whatsapp: '6281234567890', operator: 'Telkomsel', … }

formatRupiah(1500000);                   // 'Rp1.500.000'
terbilang(1500000, { currency: true });  // 'satu juta lima ratus ribu rupiah'
parseRupiah('2jtan');                    // { amount: 2000000, approximate: true }
parseRupiah('sejuta setengah');          // { amount: 1500000, approximate: false }

listWilayah('32.76');                    // kecamatan di Kota Depok
searchWilayah('kab. bogor')[0].code;     // '32.01'
findByPostalCode('16431');               // kelurahan yang memakai kode pos ini

addWorkingDays('2026-03-17', 1);         // '2026-03-25', melewati Nyepi dan Lebaran
isWorkingDay('2026-12-24', { cutiBersama: false }); // true untuk kantor yang tidak ikut cuti bersama
```

`@lokal-id/core/wilayah` memuat data wilayah sekitar 4,4 MB dan hanya berjalan di Node. Entry utama tidak memuatnya, jadi aman untuk browser.

### Samaran: samarkan sebelum ke LLM, pulihkan setelahnya

```ts
import { Samaran } from '@lokal-id/core';

const samaran = new Samaran();

const { text } = samaran.mask(
  'Nama: Budi Santoso, NIK 3201011508950001, refund ke rek BCA 1234567890, HP 0812-3456-7890',
);
// 'Nama: [NAME_1], NIK [NIK_1], refund ke rek BCA [BANK_ACCOUNT_1], HP [PHONE_1]'

const reply = await llm(text);   // model tidak pernah melihat data asli
samaran.unmask(reply);           // placeholder diganti lagi dengan data asli
```

- Nilai yang sama selalu mendapat placeholder yang sama, termasuk beda format: `0812-…` dan `+62 812…` sama-sama `[PHONE_1]`.
- `mode: 'partial'` untuk log dan layar admin: `3201********0001`, `0812****7890`, `b***@gmail.com`.
- Deteksi memakai label (`Agama: Islam`, `NAMA : BUDI`), header CSV dan Excel (`agama`, `diagnosa`, `gaji`, …), key JSON/YAML dan query string, serta frasa umum di teks bebas (`nama saya budi`, `didiagnosis TBC`, `gaji saya 8 juta`).

<details>
<summary><b>Jenis data yang dideteksi (25)</b></summary>

| Kelompok | Jenis |
|---|---|
| Pengenal | `NIK` (struktur divalidasi), `KK`, `NPWP`, `PASSPORT`, `SIM`, `NIP`, `BPJS`, `PHONE`, `EMAIL`, `BANK_ACCOUNT`, `CARD` (Luhn), `PLATE`, `IP`, `GEO` |
| Siapa dan di mana | `NAME`, `ADDRESS`, `BIRTH_DATE` (tempat/tanggal lahir) |
| Data pribadi umum | `GENDER`, `RELIGION`, `MARITAL_STATUS`, `NATIONALITY` |
| Data pribadi spesifik (UU PDP Pasal 4) | `HEALTH`, `FINANCIAL`, `CRIMINAL_RECORD`, `BIOMETRIC` |

</details>

### MCP tools

| Tool | Kegunaan |
|---|---|
| `parse_nik` | Validasi dan dekode NIK: wilayah, tanggal lahir, jenis kelamin |
| `validate_npwp` | NPWP 15 digit, 16 digit, atau NIK sebagai NPWP |
| `parse_phone` | Normalisasi nomor, format tampilan, link WhatsApp, operator |
| `format_rupiah` | `Rp1.500.000`, `Rp1,5 jt`, terbilang |
| `parse_rupiah` | "2jtan", "goceng", "sejuta setengah" → angka |
| `search_wilayah` | Cari provinsi, kab/kota, kecamatan, dan desa beserta kodenya |
| `list_wilayah` | Anak wilayah untuk dropdown alamat berjenjang, beserta kode pos |
| `lookup_kode_pos` | Kode pos → kelurahan/desa, atau semua kode pos di suatu wilayah |
| `list_holidays` | Libur nasional dan cuti bersama (SKB 2026, 2027) |
| `working_days` | Hari kerja, tenggat SLA, estimasi pengiriman |
| `scan_pii` | Pindai file dan folder (teks, CSV, JSON, log, SQL, `.xlsx`) untuk data pribadi. Hanya menampilkan nilai yang sudah disamarkan sebagian, dan **melaporkan file yang tidak bisa dipindai** (PDF, `.xls`, gambar) |
| `read_file_masked` | Baca file, termasuk sheet `.xlsx`, dengan data pribadi diganti placeholder yang stabil |
| `write_file_unmasked` | Tulis hasil kerja dengan placeholder dipulihkan, di komputer kamu |

### Samaran Guard

Otomatis aktif lewat plugin Claude Code.

- **Prompt** berisi nomor identitas (NIK, KK, NPWP, paspor, SIM, NIP, rekening, BPJS, kartu) atau data kesehatan, catatan kriminal, dan biometrik yang berlabel ditahan sebelum terkirim. Tambahkan `#izinkan-pii` kalau memang disengaja.
- **Pembacaan file data** (CSV, Excel, JSON, log, SQL dump, YAML, …) yang berisi data pribadi diblokir, dan Claude diarahkan ke `read_file_masked`. Ini berlaku untuk tool `Read`, `Grep` mode isi, dan perintah shell seperti `cat`, `head`, `grep`, `sed -n`, `awk`, `cut`, `Get-Content`, dan `Import-Csv | Select-Object`.
- **Yang dihitung hanya bagian yang benar-benar tercetak.** `head -1 data.csv` (header saja), `wc -l`, `grep -c`, dan `sort data.csv > hasil.csv` tetap jalan.
- **Tidak diblokir:** file kode sumber, karena contoh nomor di kode itu wajar dan agent harus bisa membacanya, dan skrip yang dijalankan pada file data (`node olah.js data.csv`), karena begitulah data diolah tanpa ditampilkan ke model.
- File berisi data palsu (fixture, seeder) bisa didaftarkan di `.samaranignore`:

  ```gitignore
  test/fixtures/
  database/seeders/
  *.example.csv
  ```

- `SAMARAN_GUARD=off` mematikan guard.

## Hasil eval

Tugas vibe coding yang sama dijalankan di sesi Claude Code sungguhan di folder kosong, tanpa dan dengan plugin Lokal, masing-masing 3 kali (`npm run eval`, kasus di [`evals/cases.mjs`](evals/cases.mjs)):

| Kasus | Tanpa Lokal | Dengan Lokal |
|---|---|---|
| Form checkout untuk pelanggan Indonesia | 16/18 (alamat berhenti di kota, 2 dari 3 run) | 18/18 |
| Chatbot CS yang memanggil Claude API | 8/12 (data tidak pernah dipulihkan di balasan) | 12/12 |
| Deduplikasi CSV pelanggan | 3/6 (**NIK dan HP terkirim ke model di 3/3 run**) | 6/6 (model hanya melihat placeholder) |
| SLA dengan libur Lebaran 2026 | 3/3 | 3/3 |
| **Total** | **30/39** | **39/39** |

Kasus kelima, **debug `app.log` yang berisi NIK, HP, dan email pelanggan**, ditambahkan belakangan. Tanpa Lokal, agent langsung menjalankan `Get-Content app.log` dan seluruh log sampai ke model. Dengan Lokal, agent memakai `scan_pii` → `read_file_masked`, dan di 2 dari 2 run tidak ada data pelanggan yang sampai ke model. Run pertama kasus ini justru menemukan bug: nilai log `key=value` ikut menelan pasangan berikutnya, sehingga nomor HP lolos lewat preview. Bug itu sudah diperbaiki dan ada tes regresinya.

Ini sampel kecil yang disusun dari keseharian developer Indonesia. Jangan dibaca sebagai benchmark umum.

## Batasan

- **Deteksi berbasis pola dan mengutamakan presisi.** Nama dikenali dari label, header kolom, frasa pengantar ("nama saya budi", "atas nama", "a.n.", "bernama"), dan sapaan ("Pak Joko", "bapak ahmad"), termasuk huruf kecil. Nama yang muncul begitu saja tanpa pengantar ("tadi budi bilang …"), data kesehatan atau keuangan dengan kalimat tidak biasa, dan data anak yang tidak ditandai sebagai data anak masih bisa lolos. Anggap Samaran sebagai jaring pengaman yang kuat, bukan jaminan.
- **Diuji terhadap salah deteksi** di 12 MB kode open source dan teks lengkap UU 27/2022, tanpa satu pun deteksi nama berkeyakinan tinggi. Deteksi nama di chat menangkap 29 dari 29 kalimat uji berisi nama dan tidak salah tangkap di 26 kalimat chat biasa. Kalimatnya disusun untuk tes, jadi akurasi di chat asli bisa lebih rendah.
- **Tidak semua format terbaca.** PDF, `.xls` lama, gambar (foto KTP, selfie), dan arsip tidak dipindai. `scan_pii` melaporkannya sebagai *tidak terpindai*, bukan *bersih*.
- **Validasi NIK dan NPWP hanya struktur.** Tidak bisa memastikan nomornya terdaftar di Dukcapil atau DJP.
- **Deteksi operator memakai prefix nomor**, yang cocok dengan daftar alokasi publik, termasuk merger XLSmart 2025. Indonesia belum punya *number portability* (gugatannya masih di MK, perkara 319/PUU-XXIV/2026), jadi prefix masih bisa diandalkan. Kode area telepon rumah baru mencakup 19 kota besar.
- **Guard mencegat prompt, `Read`, `Grep`, dan perintah shell umum.** Skrip yang sengaja mencetak isi file data, atau perintah seperti `python -c "print(open(...).read())"`, tidak bisa dicegat 100%. Untuk itu skill `samaran` yang mengarahkan agent.
- **Hari libur** hanya tersedia untuk tahun yang SKB-nya sudah terbit (2026, 2027). Tahun lain menghasilkan error, bukan tebakan.
- **ChatGPT** butuh MCP lewat HTTP. Server ini baru mendukung stdio.

## Roadmap

- [x] Libur nasional dan cuti bersama per tahun
- [x] Kode pos untuk setiap kelurahan/desa
- [x] Kategori data UU PDP dan dukungan Excel di Samaran
- [ ] **Kapan**: parser waktu khas Indonesia (`besok abis maghrib`, `lusa jam 7an`, `tanggal muda`) dengan waktu sholat berbasis lokasi
- [ ] **Warga**: generator data uji yang konsisten (NIK sesuai tanggal lahir dan wilayah, nama sesuai daerah)
- [ ] Dukungan PDF dan `.docx` di Samaran
- [ ] Parser alamat bebas → kode wilayah
- [ ] Transport HTTP untuk ChatGPT dan agent berbasis web
- [ ] Library Python (`lokal-id`) dengan API yang sama
- [ ] *Locale pack* untuk negara lain (Malaysia, Filipina, Vietnam)

Punya ide? [Buka issue](https://github.com/lokal-id/lokal/issues).

## Struktur project

```text
packages/core     @lokal-id/core: logika dan data
packages/mcp      @lokal-id/mcp: MCP server dan Samaran Guard
skills/           SKILL.md untuk Claude, Codex, dan agent lain
hooks/            hook Claude Code (hasil bundle, tanpa dependency)
evals/            eval end-to-end ke sesi Claude Code sungguhan
.claude-plugin/   manifest plugin dan marketplace
```

## Kontribusi

Kontribusi sangat diterima, boleh dalam Bahasa Indonesia atau Inggris. Laporan data yang lolos dari deteksi atau salah terdeteksi sangat membantu. Lihat [CONTRIBUTING.md](CONTRIBUTING.md) untuk setup dan panduannya, dan **jangan pernah menyertakan data pribadi asli di issue atau pull request**.

```sh
npm install
npm run build   # core, mcp, dan bundle hook
npm test        # unit test, MCP server end-to-end, guard
npm run eval    # sesi Claude Code sungguhan, dengan dan tanpa plugin
```

## Keamanan

Kalau kamu menemukan cara meloloskan data pribadi melewati Samaran atau guard, laporkan secara privat sesuai [SECURITY.md](SECURITY.md), jangan lewat issue publik.

## Lisensi

Kode dirilis dengan [Lisensi MIT](LICENSE). Data yang ikut terpasang mengikuti ketentuannya masing-masing:

| Data | Sumber | Lisensi |
|---|---|---|
| Wilayah (38 provinsi, 416 kabupaten, 98 kota, 7.285 kecamatan, 8.496 kelurahan, 75.266 desa) | [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah), mengikuti Kepmendagri 300.2.2-2138/2025 yang diubah dengan 300.2.2-2430/2025 | MIT |
| Kode pos (83.762 dari 83.762 kelurahan/desa) | [cahyadsn/wilayah_kodepos](https://github.com/cahyadsn/wilayah_kodepos) | MIT |
| Libur nasional dan cuti bersama | SKB 3 Menteri lewat [setneg.go.id](https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026) | Dokumen resmi pemerintah |

Jumlah wilayah sama persis dengan Kepmendagri dan terakhir diperiksa Oktober 2026. Cara memperbaruinya ada di [`packages/core/data/README.md`](packages/core/data/README.md). Setiap tanggal libur diuji terhadap nama hari di pengumuman resmi. Ringkasan UU PDP di skill dicocokkan dengan teks resmi UU 27/2022.

## Terima kasih

- [cahyadsn](https://github.com/cahyadsn) yang merawat data wilayah dan kode pos Indonesia secara terbuka.
- [Model Context Protocol](https://modelcontextprotocol.io) dan [Agent Skills](https://agentskills.io), standar terbuka yang membuat satu toolkit bisa dipakai di banyak agent.
