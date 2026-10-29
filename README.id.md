<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo/lokal-wordmark-white.svg">
    <img src="docs/assets/logo/lokal-wordmark.svg" alt="Lokal" height="72">
  </picture>
</h1>

**Bikin AI agent paham Indonesia.**

Skill, MCP server, dan pelindung privasi yang membantu Claude Code, Cursor, Codex, dan agent lain<br>
membangun aplikasi yang benar untuk Indonesia, sambil menjaga data pribadi pengguna tidak sampai ke model.

[![npm @lokal-id/mcp](https://img.shields.io/npm/v/@lokal-id/mcp?label=%40lokal-id%2Fmcp&color=cb3837)](https://www.npmjs.com/package/@lokal-id/mcp)
[![npm @lokal-id/core](https://img.shields.io/npm/v/@lokal-id/core?label=%40lokal-id%2Fcore&color=cb3837)](https://www.npmjs.com/package/@lokal-id/core)
[![PyPI lokal-id](https://img.shields.io/pypi/v/lokal-id?label=lokal-id&color=3775a9)](https://pypi.org/project/lokal-id/)
[![CI](https://github.com/lokal-id/lokal/actions/workflows/ci.yml/badge.svg)](https://github.com/lokal-id/lokal/actions/workflows/ci.yml)
[![npm provenance](https://img.shields.io/badge/npm-provenance-2ea44f?logo=npm)](SECURITY.md#how-releases-are-protected)
[![Third-party dependencies: 0](https://img.shields.io/badge/third--party%20dependencies-0-2ea44f)](SECURITY.md#how-releases-are-protected)
[![Lisensi: MIT](https://img.shields.io/badge/lisensi-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%7C%20HTTP-6e56cf)](https://modelcontextprotocol.io)

[Mulai cepat](#mulai-cepat) ·
[Fitur](#fitur) ·
[Pemakaian](#pemakaian) ·
[Hasil eval](#hasil-eval) ·
[Batasan](#batasan) ·
[**English**](README.md)

<br>

<img src="docs/assets/demo.id.gif" alt="Agent AI membaca pelanggan.csv dua kali. Tanpa Lokal, nama, NIK, dan nomor HP asli terkirim ke penyedia model. Dengan Lokal, file dibaca lewat read_file_masked, penyedia hanya menerima [NAME_1], [NIK_1], dan [PHONE_1], lalu write_file_unmasked menulis perbaikannya dengan nilai asli di komputermu." width="100%">

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

### Apa yang *bukan* Lokal

Samaran adalah jaring pengaman, bukan batas keamanan.

- **Masih ada data yang lolos.** Deteksi memakai pola, label, dan daftar nama. Di teks bebas yang belum pernah dilihat, sekitar 12 sampai 18% nilai pribadi masih lolos (lihat [Batasan](#batasan)).
- **Tidak bisa membaca gambar.** Foto KTP dan PDF hasil scan dilaporkan atau ditanyakan, tidak pernah disamarkan.
- **Hanya melindungi jalur yang melewatinya.** File yang dikirim editor ke model atas inisiatifnya sendiri, atau skrip buatan agent yang mencetak data pelanggan, tidak disamarkan.
- **Tidak otomatis membuat sistem patuh UU PDP.** Lokal menurunkan peluang kebocoran yang tidak disengaja; kontrol akses, minimisasi data, dan perjanjian dengan penyedia model tetap perlu kamu atur.

Untuk data yang sama sekali tidak boleh sampai ke penyedia model, tambahkan kontrol di [Pertahanan berlapis](#pertahanan-berlapis).

## Fitur

- **Konvensi Indonesia untuk agent.** Uang, nomor telepon, NIK/NPWP, alamat berjenjang, WIB/WITA/WIT, metode pembayaran lokal, teks UI, dan UU PDP, dikemas sebagai [Agent Skills](https://agentskills.io).
- **Data acuan akurat, ikut terpasang.** 38 provinsi sampai 83.762 kelurahan/desa, sama persis dengan Kepmendagri 2025, lengkap dengan kode pos setiap desa. Libur nasional dan cuti bersama dari SKB resmi 2026 dan 2027.
- **Penyamaran Samaran.** Mengganti 27 jenis data pribadi Indonesia, termasuk semua kategori di UU PDP Pasal 4, dengan placeholder yang stabil, lalu memulihkannya di jawaban model.
- **Samaran Guard.** Hook untuk Claude Code, Codex CLI, Cursor, dan Gemini CLI yang menahan prompt berisi nomor identitas dan mengalihkan pembacaan file data pelanggan (`Read`, `Grep`, `cat`, `Get-Content`, …) ke versi tersamar.
- **Kembaran.** Menyalin dump dan ekspor produksi untuk staging dengan setiap orang diganti kembaran yang realistis: NIK valid di kecamatan yang sama, nomor HP di operator yang sama, konsisten antartabel.
- **Samaran Proxy.** Endpoint yang kompatibel dengan OpenAI dan Anthropic. Proxy menyamarkan data pribadi di setiap panggilan LLM dari aplikasimu dan memulihkannya di jawaban, termasuk saat streaming. Cukup ganti base URL, kodenya tidak perlu diubah. Untuk aplikasi serverless, penyamaran yang sama tersedia sebagai middleware [Vercel AI SDK](https://ai-sdk.dev).
- **Lokal Scan.** GitHub Action dan pre-commit hook yang mencegah data pribadi ter-commit. Hanya baris yang ditambahkan pull request yang diperiksa, dan setiap nilai ditandai di baris yang berubah.
- **Ekstensi browser.** Menyamarkan data pribadi yang ditempel atau diketik ke ChatGPT, Claude, Gemini, dan chat AI lain, lalu memulihkannya saat jawaban disalin.
- **Jalan di agent mana pun.** Plugin Claude Code, MCP server stdio untuk Cursor, Claude Desktop, VS Code, Windsurf, dan Codex, server HTTP untuk konektor ChatGPT dan Claude.ai, plus library TypeScript dan Python yang hasilnya identik.
- **Lokal dan offline.** Data ikut di dalam paket. Tidak ada panggilan jaringan, tidak ada telemetri, dan pemulihan data terjadi di komputer kamu. Ada test yang menjalankan semua tool MCP, guard, pemindai, dan library Python dengan akses jaringan diblokir, dan gagal pada satu percobaan pun.

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

<details>
<summary><b>ChatGPT dan Claude.ai (konektor remote)</b></summary>

ChatGPT dan Claude.ai versi web hanya bisa tersambung ke MCP server remote lewat HTTPS. Jalankan server dalam mode HTTP:

```sh
npx @lokal-id/mcp serve --http --port 3000                  # http://127.0.0.1:3000/mcp
npx @lokal-id/mcp serve --http --host 0.0.0.0 --port $PORT  # di hosting Node seperti Render atau Fly.io
```

Pasang di belakang HTTPS (domain dari hosting kamu, atau `cloudflared tunnel --url http://localhost:3000` untuk mencoba), lalu tambahkan `https://<domain-kamu>/mcp` sebagai konektor kustom: di ChatGPT lewat developer mode (tergantung paket langganan), di Claude.ai lewat Settings → Connectors. Mode HTTP hanya menyediakan tool data (NIK, NPWP, nomor HP, Rupiah, wilayah, kode pos, hari libur, QRIS). Tool file sengaja tidak disertakan: server remote tidak bisa melihat file kamu, dan tidak boleh membuka file miliknya sendiri.

</details>

Tool file (`scan_pii`, `read_file_masked`, `write_file_unmasked`) hanya bisa mengakses `LOKAL_ROOT`. Defaultnya `CLAUDE_PROJECT_DIR`, lalu folder tempat server dijalankan.

### Hanya skill, untuk agent mana pun

```sh
npx skills add lokal-id/lokal
```

Perintah ini memasang `lokal-indonesia` dan `samaran` lewat [skills CLI](https://github.com/vercel-labs/skills) ke Claude Code, Codex, Cursor, dan agent lain yang didukungnya. Tambahkan `-g` untuk memasang di level user, bukan di project yang sedang dibuka.

Skill mengajari agent konvensinya. Untuk data wilayah, kode pos, dan hari libur yang akurat serta pembacaan file tersamar, pasang juga MCP server-nya (lihat di atas). Samaran Guard berupa hook: ikut otomatis lewat plugin Claude Code, dan [bisa dipasang](#di-codex-cli-cursor-dan-gemini-cli) di Codex CLI, Cursor, dan Gemini CLI.

Folder di [`skills/`](skills) juga bisa disalin manual. Formatnya mengikuti standar terbuka Agent Skills (`SKILL.md`).

### Library

```sh
npm install @lokal-id/core     # TypeScript / JavaScript
pip install lokal-id           # Python 3.10+
```

Paket Python adalah port dari `@lokal-id/core` dengan aturan dan data yang sama, dan sudah diverifikasi terhadap ribuan hasil versi TypeScript. Versi Python juga mendukung nominal `Decimal`, objek `date`, hasil berupa dataclass, filter `logging` untuk backend, dan `lokal.files`, yaitu pembaca file milik server MCP, untuk memindai folder upload (`scan_pii` versi backend) atau menyamarkan PDF sebelum dikirim ke LLM. Lihat [`python/`](python#readme).

## Pemakaian

### Library

```ts
import {
  parseNik, parsePhone, formatRupiah, parseRupiah, terbilang, addWorkingDays, isWorkingDay, parseQris, setQrisAmount,
} from '@lokal-id/core';
import { listWilayah, searchWilayah, wilayahName, findByPostalCode, parseAlamat } from '@lokal-id/core/wilayah';

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
parseAlamat('jl margonda raya no 100 rt 3/5 kemiri muka beji depok 16423');
// { street: 'jl margonda raya no 100', rt: '003', rw: '005', postalCode: '16423',
//   kelurahanDesa: { code: '32.76.06.1004', name: 'Kemiri Muka', … }, kecamatan: { name: 'Beji', … },
//   kabupatenKota: { name: 'Kota Depok', … }, provinsi: { name: 'Jawa Barat', … }, confidence: 'high', issues: [] }

addWorkingDays('2026-03-17', 1);         // '2026-03-25', melewati Nyepi dan Lebaran
isWorkingDay('2026-12-24', { cutiBersama: false }); // true untuk kantor yang tidak ikut cuti bersama

parseQris(payload);                      // { valid, type: 'static', merchantName, nmid, criteriaLabel: 'Usaha Mikro', … }
setQrisAmount(payload, 25000);           // QRIS merchant yang sama, versi dinamis Rp25.000, dengan CRC baru
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
- `exclude` membiarkan tipe yang memang perlu dibaca aplikasi. Simulasi kredit di dealer butuh penghasilan dan cicilan, jadi `new Samaran({ exclude: ['FINANCIAL'] })` membiarkan "gaji saya 8 juta, cicilan 3 juta" tetap utuh, sementara NIK dan nomor HP tetap disamarkan. Salah ketik nama tipe menghasilkan error, bukan diam-diam menyamarkan lebih sedikit.
- `mode: 'partial'` untuk log dan layar admin: `3201********0001`, `0812****7890`, `b***@gmail.com`.
- **Tipe data milik sendiri.** Untuk format yang tidak mungkin diketahui Samaran, seperti ID karyawan atau kolom nomor member, tambahkan aturan di `.samaran.json` di root proyek. Server MCP, guard, `lokal-mcp scan`, proxy, dan `lokal.files.scan_path` membacanya; file yang rusak menghentikan tool file, bukan diam-diam menyamarkan lebih sedikit:

  ```json
  {
    "custom": [
      { "label": "EMPLOYEE_ID", "pattern": "\\bEMP-\\d{6}\\b" },
      { "label": "MEMBER", "fields": ["no_member", "Kode Member"] }
    ],
    "allow": ["0800-1-500-500"]
  }
  ```

  `pattern` berupa regular expression; `fields` adalah key JSON, label `key: value`, dan kolom CSV. Hasilnya `[EMPLOYEE_ID_1]` dan `[MEMBER_1]`, dipulihkan seperti placeholder lain. `allow` berisi nilai yang tidak pernah disamarkan, misalnya nomor hotline sendiri. Di kode, berikan aturan yang sama: `new Samaran({ custom: [...] })`, atau `Samaran(custom=[...])` di Python.
- Deteksi memakai label (`Agama: Islam`, `NAMA : BUDI`), header CSV dan Excel (`agama`, `diagnosa`, `gaji`, …), key JSON/YAML dan query string (termasuk `first_name` / `last_name` yang terpisah), dump SQL (`INSERT` dengan atau tanpa nama kolom seperti keluaran mysqldump, dan blok `COPY` dari pg_dump), export chat WhatsApp, serta frasa umum di teks bebas (`nama saya budi`, `didiagnosis TBC`, `obat insulin`, `gaji saya 8 juta`).

<details>
<summary><b>Jenis data yang dideteksi (25)</b></summary>

| Kelompok | Jenis |
|---|---|
| Pengenal | `NIK` (struktur divalidasi), `KK`, `NPWP`, `PASSPORT`, `SIM`, `NIP`, `BPJS`, `NISN`, `AKTA` (nomor akta kelahiran, perkawinan, dan kematian), `PHONE`, `EMAIL`, `BANK_ACCOUNT`, `CARD` (Luhn), `PLATE`, `IP`, `GEO` |
| Siapa dan di mana | `NAME`, `ADDRESS`, `BIRTH_DATE` (tempat/tanggal lahir) |
| Data pribadi umum | `GENDER`, `RELIGION`, `MARITAL_STATUS`, `NATIONALITY` |
| Data pribadi spesifik (UU PDP Pasal 4) | `HEALTH`, `FINANCIAL`, `CRIMINAL_RECORD`, `BIOMETRIC` |

</details>

### Samaran Proxy: lindungi panggilan LLM di aplikasi

Menyamarkan secara manual berarti setiap tempat yang memanggil LLM harus ingat melakukannya. Proxy melakukannya untuk seluruh aplikasi: jalankan di samping backend, lalu arahkan base URL SDK ke sana.

```sh
npx @lokal-id/mcp proxy                 # http://127.0.0.1:8787
```

```python
from openai import OpenAI
from anthropic import Anthropic

client = OpenAI(base_url='http://127.0.0.1:8787/v1')   # Chat Completions, Responses, embeddings
claude = Anthropic(base_url='http://127.0.0.1:8787')   # Messages
```

- Semua teks di request disamarkan sebelum keluar dari server kamu: riwayat percakapan, system prompt, hasil tool, dan argumen tool call. Gambar, ID, dan blok thinking yang bertanda tangan tidak diubah.
- Jawaban kembali dengan nilai asli, baik streaming maupun tidak, termasuk argumen tool call, sehingga tool yang dijalankan aplikasi menerima data asli.
- Setiap request punya vault sendiri. Karena seluruh percakapan disamarkan berurutan, orang yang sama selalu mendapat placeholder yang sama di setiap giliran.
- API lain yang kompatibel dengan OpenAI juga bisa: `--openai https://openrouter.ai/api/v1`, Groq, DeepSeek, Ollama, atau endpoint OpenAI milik Gemini. `--exclude FINANCIAL` membiarkan model melihat angka penghasilan untuk simulasi kredit.
- Hanya mendengarkan di 127.0.0.1, meneruskan API key tanpa menyimpannya, dan mencatat satu baris per request berisi jumlah, bukan nilai. Setiap respons punya header `x-samaran-masked: NIK=1,NAME=2`. Unggahan file tidak bisa disamarkan sehingga ditolak, kecuali proxy dijalankan dengan `--allow-unmasked`. Gambar, audio, dan file di dalam request JSON (foto KTP untuk model vision) juga tidak bisa dicek: request tetap diteruskan, responsnya membawa `x-samaran-status: partial` dengan jumlahnya di `x-samaran-unchecked`, dan baris log mencatatnya. Jalankan proxy dengan `--strict` untuk menolak request seperti itu.

Sudah diuji end-to-end dengan Claude Code sendiri yang dijalankan lewat proxy: model hanya pernah melihat placeholder, dan file yang ditulisnya lewat tool berisi nilai asli.

### Samaran untuk Vercel AI SDK: penyamaran di dalam aplikasi

Untuk tempat yang tidak bisa menjalankan proxy, seperti fungsi serverless dan edge, atau untuk API yang tidak didukung proxy, seperti API native Gemini dan Bedrock, bungkus modelnya saja. Middleware ini melakukan pekerjaan yang sama di dalam proses, untuk semua provider yang didukung [AI SDK](https://ai-sdk.dev):

```ts
import { generateText, wrapLanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { samaranMiddleware } from '@lokal-id/core/ai-sdk';

const model = wrapLanguageModel({ model: openai('gpt-5'), middleware: samaranMiddleware() });

const { text } = await generateText({ model, prompt: tiket });   // model melihat [NAME_1], kamu menerima nama asli
```

- Prompt disamarkan berurutan di setiap panggilan: system, pesan, tool call, dan hasil tool. Hasil tool disamarkan sebagai JSON, jadi `{ "nama": "Budi Santoso" }` tertangkap lewat key-nya.
- Jawaban kembali dengan nilai asli, baik streaming maupun tidak. Placeholder yang terpotong di antara chunk ditahan sampai utuh, jadi `useChat` tidak pernah menampilkan potongannya. Input tool dipulihkan sebagai JSON yang valid, sehingga tool berjalan dengan data asli, dan `Output.object` menerima nilai yang di-escape dengan benar.
- `samaranMiddleware({ exclude: ['FINANCIAL'], allow: ['0800-1-500-888'] })` menerima opsi yang sama dengan `Samaran`. `onMask` menerima jumlah per jenis, bukan nilainya, untuk log audit.
- Bawaannya untuk AI SDK 7; untuk AI SDK 6 tambahkan `specificationVersion: 'v3'`. Tanpa dependency tambahan.
- Reasoning dibiarkan seperti yang ditulis model, karena provider menandatanganinya. Gambar dan file dikirim apa adanya, jadi ambil dan samarkan teks dokumen sebelum melampirkannya.

### Kembaran: data produksi untuk staging, tanpa orang sungguhan

Menyalin data produksi ke staging atau laptop developer adalah penyebab kebocoran data pribadi yang paling umum. Kembaran membuat salinan yang setiap orangnya diganti dengan "kembaran" yang realistis, sehingga datanya tetap berperilaku seperti produksi:

```sh
npx @lokal-id/mcp kembaran prod.sql ekspor.csv -o staging/ --secret staging-2026
python -m lokal.kembaran prod.sql -o staging.sql          # sama, dari backend Python
```

```
nama,nik,tgl_lahir,hp,email
Budi Santoso,3201011508950001,15-08-1995,0812-3456-7890,budi.santoso@gmail.com
↓
Slamet Matondang,3201012409953895,24-09-1995,0812-8655-8077,rini.pertiwi10@example.com
```

| Data | Yang dipertahankan |
|---|---|
| NIK, KK | Kecamatan, jenis kelamin, tahun lahir; tetap NIK yang valid |
| Tanggal lahir | Tahunnya; di baris yang sama, mengikuti tanggal di NIK palsunya |
| Nomor HP | Operator dan format: `0812-…` tetap Telkomsel |
| Nama | Jumlah kata, huruf besar/kecil, gelar (`Dr. Ir. H. …`) |
| Alamat | RT/RW, kelurahan, kecamatan, kota; nama jalan dan nomor rumah berganti |
| Email | Tidak ada: `…@example.com`, jadi staging tidak bisa mengirim email ke siapa pun |
| Kartu, rekening | Panjangnya; kartu tetap berawalan penerbit yang sama dan lolos Luhn |

- Nilai yang sama mendapat kembaran yang sama di semua file dalam satu kali jalan, jadi JOIN dan foreign key tetap jalan. `0812-3456-7890` dan `+62 812 3456 7890` dianggap satu orang. NPWP orang pribadi tetap sama dengan NIK-nya.
- Kembaran dibuat dengan HMAC-SHA256 dan sebuah kunci. Tanpa `--secret`, kuncinya acak setiap kali jalan; dengan kunci, refresh staging mingguan menghasilkan orang palsu yang sama. NIK, nomor HP, dan nomor rekening palsu tidak pernah bertabrakan.
- Jenis kelamin, agama, status perkawinan, dan kewarganegaraan dibiarkan secara default; `--keep FINANCIAL` membiarkan lebih banyak. `--keep-birth-date` mempertahankan tanggal lahir lengkap.
- Di agent, tool `anonymize_file` melakukannya di komputer kamu dan hanya mengembalikan jumlah. TypeScript: `new Kembaran({ secret }).text(text)` dari `@lokal-id/core/kembaran`; Python: `Kembaran(secret=…).text(text)` dari `lokal.kembaran`, dengan hasil yang sama untuk kunci yang sama.

Nomor HP palsu tetap bisa kebetulan milik orang lain, jadi cegah staging mengirim SMS atau WhatsApp. Hanya file teks (SQL dump, CSV, JSON, log) sampai 100 MB; sekitar 2 MB/detik di TypeScript.

### Ekstensi browser: untuk ChatGPT, Claude, dan Gemini versi web

Tidak semua orang menempel data pelanggan lewat agent. Tim CS, HR, dan finance menempelnya ke ChatGPT atau Claude di browser. Ekstensi Lokal menyamarkan data pribadi saat ditempel atau sebelum pesan dikirim, jadi situs hanya menerima `[NIK_1]` dan `[PHONE_1]`:

<img src="docs/assets/extension-demo.id.gif" alt="Data pelanggan ditempel ke chat AI. Ekstensi menyamarkan nama, NIK, dan nomor HP sebelum pesan dikirim, AI menjawab dengan placeholder, mengarahkan kursor ke placeholder menampilkan nilai aslinya, dan menyalin jawaban mengembalikan nilai asli." width="100%">

- Placeholder di jawaban disorot; arahkan kursor ke placeholder untuk melihat nilai aslinya.
- Menyalin jawaban, dengan Ctrl+C atau tombol salin milik situs, mengembalikan nilai asli.
- Nilai asli tidak pernah ditulis ke halaman situs, tempat skrip situs bisa membacanya, dan dilupakan saat browser ditutup. Tanpa server, tanpa request jaringan.

Berjalan di ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok, dan Le Chat, di Chrome, Edge, dan browser Chromium lain. Belum ada di Chrome Web Store: unduh `lokal-extension-<versi>.zip` dari [rilis terbaru](https://github.com/lokal-id/lokal/releases/latest), ekstrak, lalu muat foldernya lewat **Load unpacked** (lihat [packages/extension](packages/extension/README.md), termasuk batasannya). Lampiran CSV, Excel, Word, dan PDF berteks ikut disamarkan. Yang tidak bisa diperiksa (foto bernama seperti KTP atau selfie, PDF hasil scan atau berkata sandi, file di atas 20 MB) ditahan, dan baru diunggah kalau kamu mengizinkan.

### Lokal Scan: data pribadi tidak masuk repository

Seeder, fixture, dan dump yang disalin dari production sering ikut ter-commit, lalu tersebar ke setiap clone, fork, dan log CI. `lokal-mcp scan` menemukan data pribadi Indonesia sebelum di-commit. Dengan `--staged` atau `--diff`, yang diperiksa hanya baris yang ditambahkan commit atau pull request, jadi repository yang sudah berisi data tes bisa langsung memakainya.

**GitHub Actions.** Setiap nilai ditandai di baris yang berubah pada pull request, dan job gagal ([lihat contoh pull request](https://github.com/lokal-id/action-test/pull/1/files)):

```yaml
# .github/workflows/pii.yml
name: PII
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: lokal-id/lokal@v0.8.3
        # with:
        #   scope: all              # semua file yang dilacak git, bukan hanya perubahan
        #   min-confidence: medium  # termasuk nilai tanpa label atau nama kolom
        #   types: NIK,KK,PHONE     # hanya jenis ini
        #   fail: false             # beri anotasi tanpa menggagalkan job
```

**Pre-commit hook.** Dengan [pre-commit](https://pre-commit.com):

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: lokal-scan
        name: Data pribadi Indonesia
        entry: lokal-mcp scan --staged
        language: node
        additional_dependencies: ['@lokal-id/mcp@0.8.3']
        pass_filenames: false
```

Dengan Husky, tulis `npx lokal-mcp scan --staged` di `.husky/pre-commit` setelah `npm i -D @lokal-id/mcp`. Tanpa keduanya, baris yang sama di `.git/hooks/pre-commit` juga bisa.

**Command line:**

```console
$ npx @lokal-id/mcp scan --staged
seed/pelanggan.csv:14: NIK 3201********0001
seed/pelanggan.csv:14: PHONE 0812****7890

Found 2 personal data value(s) in 1 file(s).
```

- `scan [path…]` memeriksa semua file yang dilacak git (atau semua file, di luar repository); `--diff origin/main` memeriksa satu branch; `--format json` dan `--format github` untuk tool lain. Exit code 1 berarti ada temuan.
- Temuan hanya menampilkan nilai yang disamarkan sebagian, karena log CI sering publik. Tidak ada data yang keluar dari mesin.
- File yang hanya berisi data karangan dicantumkan di `.samaranignore`. Satu baris dilewati kalau berisi `samaran-ignore`, misalnya `const nik = '3201011508950001'; // samaran-ignore`.
- Spreadsheet, dokumen Word, dan PDF dalam perubahan diperiksa utuh. File yang tidak bisa dibaca (PDF terenkripsi, `.xls`, arsip) dilaporkan sebagai peringatan, atau menggagalkan pemeriksaan dengan `--strict`.

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
| `parse_alamat` | Alamat bebas → jalan, RT/RW, kode pos, serta kelurahan, kecamatan, kota, dan provinsi beserta kodenya; menandai kode pos yang tidak cocok |
| `list_holidays` | Libur nasional dan cuti bersama (SKB 2026, 2027) |
| `working_days` | Hari kerja, tenggat SLA, estimasi pengiriman |
| `parse_qris` | Baca dan periksa payload QRIS: merchant, NMID, kriteria, nominal, CRC |
| `set_qris_amount` | Jadikan QRIS merchant dinamis untuk nominal tertentu, dengan CRC baru |
| `scan_pii` | Pindai file dan folder (teks, CSV, JSON, log, SQL, `.xlsx`, `.docx`, PDF berbasis teks, sampai 100 MB per file) untuk data pribadi. Hanya menampilkan nilai yang sudah disamarkan sebagian, dan **melaporkan file dan halaman yang tidak bisa dipindai** (PDF hasil scan atau terenkripsi, `.xls`, `.doc`, gambar) |
| `read_file_masked` | Baca file, termasuk sheet `.xlsx`, dokumen `.docx` (teks dan tabel), dan PDF (teks halaman, tabel, dan isian formulir), dengan data pribadi diganti placeholder yang stabil |
| `write_file_unmasked` | Tulis hasil kerja dengan placeholder dipulihkan, di komputer kamu |
| `anonymize_file` | Salin dump dan ekspor dengan kembaran realistis untuk setiap orang (Kembaran), hanya mengembalikan jumlah |

Tool data juga bekerja pada data tersamar. `parse_alamat`, `parse_nik`, `parse_phone`, dan `validate_npwp` menerima placeholder dari `read_file_masked`, seperti `[ADDRESS_3]` atau `[NIK_1]`, lalu membaca nilai aslinya di komputer kamu. Model menerima kelurahan, kecamatan, kota, dan kodenya, atau apakah NIK atau nomornya valid; nama jalan, RT/RW, dan tanggal lahir kembali sebagai placeholder baru yang dipulihkan oleh `write_file_unmasked`. Agent bisa merapikan kolom alamat pelanggan tanpa melihat satu alamat pun.

### Samaran Guard

Otomatis aktif lewat plugin Claude Code.

- **Prompt** berisi nomor identitas (NIK, KK, NPWP, paspor, SIM, NIP, NISN, akta, rekening, BPJS, kartu) atau data kesehatan, catatan kriminal, dan biometrik yang berlabel ditahan sebelum terkirim. Tambahkan `#izinkan-pii` kalau memang disengaja.
- **Pembacaan file data** (CSV, Excel, JSON, log, SQL dump, YAML, …) yang berisi data pribadi diblokir, dan Claude diarahkan ke `read_file_masked`. Ini berlaku untuk tool `Read`, `Grep` mode isi, dan perintah shell seperti `cat`, `head`, `grep`, `sed -n`, `awk`, `cut`, `Get-Content`, dan `Import-Csv | Select-Object`.
- **Foto dan PDF yang tidak bisa dibaca Samaran ditanyakan dulu.** `Read` mengirim gambar dan PDF ke model apa adanya. Untuk foto yang nama atau foldernya seperti dokumen orang (`ktp-budi.jpg`, `selfie_siti.png`, apa pun di `media/`, `uploads/`, atau `storage/` kecuali `assets/` dan `images/` milik aplikasi) dan untuk PDF hasil scan, terenkripsi, atau rusak, Claude Code menampilkan dialog izin beserta alasannya. PDF yang teksnya berisi data pribadi diblokir seperti file data.
- **Yang dihitung hanya bagian yang benar-benar tercetak.** `head -1 data.csv` (header saja), `wc -l`, `grep -c`, dan `sort data.csv > hasil.csv` tetap jalan.
- **Tidak diblokir:** file kode sumber, karena contoh nomor di kode itu wajar dan agent harus bisa membacanya, dan skrip yang dijalankan pada file data (`node olah.js data.csv`), karena begitulah data diolah tanpa ditampilkan ke model.
- File berisi data palsu (fixture, seeder) bisa didaftarkan di `.samaranignore`:

  ```gitignore
  test/fixtures/
  database/seeders/
  *.example.csv
  ```

- `SAMARAN_GUARD=off` mematikan guard.
- `SAMARAN_GUARD=strict` untuk tim yang ingin guard gagal dalam keadaan tertutup. Error di guard, misalnya `.samaran.json` yang rusak, akan memblokir alih-alih meloloskan. Kode yang dijalankan langsung dari command line dan menyebut file data berisi data pribadi diblokir seperti `cat`: `python -c "…open('data.csv')…"`, `node -e`, heredoc ke `python3 -`, dan `[IO.File]::ReadAllText` di PowerShell. Skrip yang disimpan di file tetap jalan.

#### Di Codex CLI, Cursor, dan Gemini CLI

Guard yang sama bisa dipasang sebagai hook di agent lain: `lokal-mcp guard` mengenali event setiap agent dan menjawab dalam formatnya. Pasang sekali secara global supaya hook cepat jalan (`npx` di setiap pembacaan file terlalu lambat):

```sh
npm install -g @lokal-id/mcp
```

<details>
<summary><b>Codex CLI</b>: <code>.codex/hooks.json</code></summary>

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "lokal-mcp guard" }] }],
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "lokal-mcp guard" }] }]
  }
}
```

Codex meminta kamu meninjau hook baru lewat `/hooks` sebelum dijalankan. Codex membaca file lewat shell, jadi yang diperiksa guard adalah `cat`, `sed -n`, dan sejenisnya.

</details>

<details>
<summary><b>Cursor</b>: <code>.cursor/hooks.json</code></summary>

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [{ "command": "lokal-mcp guard" }],
    "beforeReadFile": [{ "command": "lokal-mcp guard" }],
    "beforeShellExecution": [{ "command": "lokal-mcp guard" }]
  }
}
```

Pembacaan file di Cursor tidak bisa bertanya dulu, jadi foto atau PDF hasil scan yang di Claude Code akan ditanyakan, di Cursor langsung ditahan. Masukkan ke `.samaranignore` kalau berkas itu tidak berisi data asli.

</details>

<details>
<summary><b>Gemini CLI</b> (eksperimental): <code>.gemini/settings.json</code></summary>

```json
{
  "hooks": {
    "BeforeAgent": [{ "hooks": [{ "type": "command", "command": "lokal-mcp guard" }] }],
    "BeforeTool": [{ "matcher": "read_file|run_shell_command", "hooks": [{ "type": "command", "command": "lokal-mcp guard" }] }]
  }
}
```

Hook di Gemini CLI masih eksperimental; aktifkan sesuai dokumentasi Gemini CLI untuk versimu.

</details>

### Pertahanan berlapis

Guard menangkap cara-cara umum agent melihat data. Guard bukan sandbox: agent yang bisa menjalankan kode apa pun bisa menemukan cara mencetak isi file. Kalau data pelanggan asli ada di komputer developer, tambahkan kontrol yang tidak bergantung pada tertangkap atau tidaknya:

1. **Jauhkan data produksi dari workspace.** Beri agent salinan Kembaran (`anonymize_file` atau `lokal-mcp kembaran`), bukan dump aslinya.
2. **Tolak folder berisi data asli** di izin milik agent itu sendiri, misalnya di `.claude/settings.json` Claude Code:

   ```json
   {
     "permissions": {
       "deny": ["Read(./data/production/**)", "Read(./storage/uploads/**)", "Bash(cat:./data/production/*)"]
     },
     "env": { "SAMARAN_GUARD": "strict" }
   }
   ```

3. **Jalankan agent di container atau sandbox** tanpa kredensial dan data produksi, dengan lalu lintas keluar hanya ke penyedia model.
4. **Hentikan data di repository** dengan [Lokal Scan](#lokal-scan-data-pribadi-tidak-masuk-repository) di CI dan pre-commit.
5. **Untuk aplikasi yang memanggil LLM**, lewatkan setiap panggilan melalui [proxy](#samaran-proxy-lindungi-panggilan-llm-di-aplikasi) atau SDK, dan jangan simpan prompt mentah di log maupun error tracker.

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

### Kasus sulit

Tiga tugas yang lebih sulit memakai kunci jawaban yang dicocokkan dengan sumber resmi, bukan dengan data Lokal sendiri, dan format dokumen sungguhan dengan identitas palsu (masing-masing 2 run):

| Kasus | Tanpa Lokal | Dengan Lokal |
|---|---|---|
| Kode pos kelurahan di Depok, provinsi hasil pemekaran Papua 2022, SLA di sekitar Lebaran 2027 | 6/8 (**SLA salah di 2/2 run**: SKB 2027 lebih baru dari pengetahuan model) | 8/8 |
| Gabungkan export marketplace dengan log Midtrans, cari pesanan lunas yang belum ada resi, HP dalam format E.164 | 8/14 (jawaban benar, data semua pelanggan terkirim ke model) | 14/14 (jawaban benar, model hanya melihat placeholder) |
| Ringkas export chat WhatsApp CS untuk tim produk tanpa identitas pelanggan | 4/10 | 10/10 |

Run pertama tugas-tugas ini menemukan satu bug dan empat celah deteksi, semuanya sudah diperbaiki di 0.2.1: nomor HP di akhir baris bocor kalau baris berikutnya diawali angka, serta nama yang dipecah jadi `first_name` / `last_name`, pengirim chat WhatsApp, obat, dan rawat inap belum terdeteksi. Daftar kode pos Depok di id.wikipedia ternyata keliru untuk 32 kelurahan; data Lokal cocok dengan [en.wikipedia](https://en.wikipedia.org/wiki/Cinere) dan sumber lain.

### Test kebocoran

Satu orang karangan dengan semua jenis data pribadi yang dikenal Samaran ([`canary.json`](packages/core/test/canary.json)) dikirim, sebagai formulir, JSON, baris log, CSV, dan JSON di dalam JSON, lewat semua jalur Lokal meneruskan teks: library TypeScript dan Python, middleware AI SDK, hasil setiap tool MCP, pesan guard, setiap bentuk API proxy (Chat Completions, streaming, tool call, Responses, Messages), `lokal-mcp scan` di semua format output, Kembaran, filter logging Python, dan tempelan di ekstensi browser. Test gagal kalau ada satu nilai, atau sebagian nama atau nama jalannya, yang keluar. Saat menulis test ini ditemukan empat celah, semuanya diperbaiki di rilis ini: CSV yang ditempel setelah sebuah kalimat, label setelah baris baru yang di-escape (`\n` di JSON), JSON di dalam string JSON (body request di log, argumen tool call), dan header CSV setelah awalan log.

Guard sengaja meloloskan satu nilai biasa, misalnya satu nomor HP di hasil `grep`, dan memblokir nomor identitas, data kesehatan, serta tiga nilai atau lebih. `SAMARAN_GUARD=strict` tidak mengubah aturan itu; yang diubah adalah apa yang terjadi kalau guard tidak bisa memeriksa.

### Benchmark held-out

`npm run bench` menilai detektor per jenis data pada 1.200 dokumen karangan yang tidak dipakai untuk menyetelnya: template dan nama berbeda dari set pengembangan, dalam sebelas format mulai dari formulir dan chat sampai JSON, log, dan hasil OCR ([metode](evals/bench/README.md)). Pada 0.8.3:

| | Precision | Recall | Terlindungi |
|---|---|---|---|
| Semua 2.800 nilai | 99,5% | 93,6% | 95,0% |
| Terlemah: teks OCR | | | 77,0% |

*Terlindungi* artinya setiap huruf dan angka dari nilai itu tersamar, oleh deteksi jenis apa pun. Celah yang terlihat: agama dan NIK pada hasil OCR yang salah baca, dan nama tanpa label di depannya. Sepuluh dari 200 dokumen jebakan punya false positive, semuanya nomor call center yang sama yang terbaca sebagai nomor HP. CI gagal kalau sebuah rilis mendapat skor di bawah baseline terakhir.

`npm run eval:pii` menjalankan benchmark formatnya saja: 618 dari 618 data pribadi tersamar di 418 format, dan 338 dari 338 nilai yang mirip tetap utuh, dan setiap temuan dicek berada tepat di posisinya. Formatnya mulai dari KTP hasil OCR, export WhatsApp, JSON Midtrans, log Laravel, pesan HL7, dan dump SQL sampai teks tanpa label sama sekali: tiket CS, tanda tangan email, mutasi rekening, bukti transfer, form HTML, URL, nama file, chat berbahasa Sunda dan Jawa, dan chat santai soal kesehatan, genetika, utang, agama, pernikahan, dan catatan kriminal. Nilai yang mirip meliputi nomor resi, ID invoice, timestamp, nama lembaga, nama produk bank, tempat yang memakai nama orang, dan kata yang juga nama orang. **Angka 100% itu diukur pada kasus yang sudah dipakai untuk menyetel aturan.** Delapan kelompok kasus masing-masing ditulis setelah aturan saat itu jadi dan dijalankan sekali sebelum ada perbaikan: hasilnya 40 dari 49, 21 dari 24, 59 dari 90, 57 dari 65, 48 dari 57, 55 dari 67, 46 dari 55, dan 51 dari 61. Pada teks bebas yang belum pernah dilihat, perkirakan sekitar 82 sampai 88% data pribadi tertangkap. Dijalankan pada teks resmi UU 27/2022 (64.000 karakter), yang tersamar hanya nama Presiden di bagian tanda tangan.

Ini sampel kecil yang disusun dari keseharian developer Indonesia. Jangan dibaca sebagai benchmark umum.

## Batasan

- **Deteksi berbasis pola dan mengutamakan presisi.** Nama dikenali dari label, header kolom dan key JSON, pengirim di export chat, frasa pengantar ("nama saya budi", "a.n.", "nami abdi"), sapaan dan gelar ("Pak Joko", "Dr. Ir. H. Bambang"), peran ("Pelanggan Budi Santoso", "Tergugat Joko Susilo"), salam pembuka dan penutup, nama tampilan email, handle media sosial, umur dalam kurung ("Kevin (19)"), daftar hadir dan kontak, serta daftar sekitar 680 nama depan dan nama keluarga Indonesia yang umum, marga Batak, dan pola nama Bali, Tionghoa-Indonesia, dan Jawa. Pada teks bebas yang belum pernah dilihat, sekitar 82 sampai 88% data pribadi tertangkap: nama yang juga kata sehari-hari tanpa penanda ("pesanan budi belum sampai"), nama yang tidak ada di daftar tanpa penanda apa pun, data sensitif dengan kalimat yang baru, dan data anak yang tidak ditandai sebagai data anak masih bisa lolos. Anggap Samaran sebagai jaring pengaman yang kuat, bukan jaminan.
- **Diuji terhadap salah deteksi** di 22,5 MB kode dan dokumentasi open source: aturan nama tidak menambah satu pun salah deteksi di sana, dan setiap temuan baru adalah nama asli penulis package. Pada teks lengkap UU 27/2022, yang tersamar hanya nama penanda tangan. Dari 91.599 nama kecamatan dan desa di data Kemendagri, sendiri maupun dalam kalimat alamat, 0,15% masih terbaca sebagai nama orang, kebanyakan desa yang memakai nama marga Batak ("Pintu Pohan") atau nama orang ("Jati Utomo"). Deteksi nama di chat menangkap 29 dari 29 kalimat uji berisi nama dan tidak salah tangkap di 26 kalimat chat biasa. Kalimatnya disusun untuk tes, jadi akurasi di data asli bisa lebih rendah.
- **Tidak semua format terbaca.** PDF terbaca kalau punya lapisan teks, seperti invoice, surat, rekening koran, dan formulir dari browser, Word, atau library PDF. Halaman hasil scan, PDF terenkripsi, `.xls` dan `.doc` lama, gambar (foto KTP, selfie), dan arsip tidak dipindai. `scan_pii` melaporkannya sebagai *tidak terpindai*, bukan *bersih*, termasuk halaman scan di dalam PDF yang selebihnya terbaca. Semua integrasi memakai empat status yang sama untuk apa yang terlihat: `scanned`, `partial` (halaman scan di PDF, gambar di request lewat proxy), `unsupported` (jenis input yang tidak dibaca Lokal), dan `failed` (jenis yang didukung tetapi gagal dibaca, misalnya PDF terenkripsi). Guard bertanya dulu sebelum `Read` mengirim PDF seperti itu, atau foto yang tampak seperti dokumen orang, ke model; guard tidak bisa membedakan foto KTP dari gambar lain, jadi foto dinilai dari nama dan foldernya. File di atas 100 MB juga dilaporkan. Untuk file data di atas 5 MB, guard memeriksa 5 MB pertamanya, dan spreadsheet, dokumen Word, serta PDF di atas 20 MB dilaporkan alih-alih diurai, supaya tetap di bawah batas waktu hook 10 detik.
- **Validasi NIK dan NPWP hanya struktur.** Tidak bisa memastikan nomornya terdaftar di Dukcapil atau DJP.
- **Deteksi operator memakai prefix nomor**, yang cocok dengan daftar alokasi publik, termasuk merger XLSmart 2025. Indonesia belum punya *number portability* (gugatannya masih di MK, perkara 319/PUU-XXIV/2026), jadi prefix masih bisa diandalkan. Kode area telepon rumah baru mencakup 19 kota besar.
- **Guard mencegat prompt, `Read`, `Grep`, dan perintah shell umum.** Skrip yang sengaja mencetak isi file data, atau perintah seperti `python -c "print(open(...).read())"`, tidak bisa dicegat 100%. Untuk itu skill `samaran` mengarahkan agent, `SAMARAN_GUARD=strict` memblokir one-liner semacam itu, dan [Pertahanan berlapis](#pertahanan-berlapis) menutup sisanya.
- **Hari libur** hanya tersedia untuk tahun yang SKB-nya sudah terbit (2026, 2027). Tahun lain menghasilkan error, bukan tebakan.

## Roadmap

- [x] Libur nasional dan cuti bersama per tahun
- [x] Kode pos untuk setiap kelurahan/desa
- [x] Kategori data UU PDP dan dukungan Excel di Samaran
- [ ] **Kapan**: parser waktu khas Indonesia (`besok abis maghrib`, `lusa jam 7an`, `tanggal muda`) dengan waktu sholat berbasis lokasi
- [ ] **Warga**: generator data uji yang konsisten (NIK sesuai tanggal lahir dan wilayah, nama sesuai daerah)
- [x] Dukungan `.docx` di Samaran (teks dan tabel)
- [x] Dukungan PDF berbasis teks di Samaran (teks halaman, tabel, isian formulir)
- [ ] OCR untuk PDF hasil scan dan foto KTP
- [x] Parser alamat bebas → kode wilayah
- [x] Transport HTTP untuk ChatGPT dan agent berbasis web
- [x] Library Python (`lokal-id`) dengan hasil yang sama dengan TypeScript
- [ ] *Locale pack* untuk negara lain (Malaysia, Filipina, Vietnam)

Punya ide? [Buka issue](https://github.com/lokal-id/lokal/issues).

## Struktur project

```text
packages/core       @lokal-id/core: logika dan data
packages/mcp        @lokal-id/mcp: MCP server dan Samaran Guard
packages/extension  ekstensi browser untuk ChatGPT, Claude, Gemini, dan chat AI lain
python/             lokal-id: port Python, dengan tes paritas terhadap TypeScript
skills/             SKILL.md untuk Claude, Codex, dan agent lain
hooks/              hook Claude Code (hasil bundle, tanpa dependency)
evals/              eval end-to-end ke sesi Claude Code sungguhan
.claude-plugin/     manifest plugin dan marketplace
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

Rilis dibangun dari tag oleh GitHub Actions dan diterbitkan lewat Trusted Publishing dengan provenance. `@lokal-id/core` dan paket Python tidak punya dependency, dan `@lokal-id/mcp` membundel dependency-nya sendiri, jadi memasang Lokal tidak menarik paket pihak ketiga apa pun. [SECURITY.md](SECURITY.md#how-releases-are-protected) menjelaskan cara rilis dilindungi dan cara memverifikasi paket yang kamu pasang.

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
