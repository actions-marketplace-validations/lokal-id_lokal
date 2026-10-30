# Quickstart: Lokal dalam 5 menit

[English](quickstart.md)

Yang dibutuhkan hanya Node.js 20 atau lebih baru. Semua nama, NIK, dan nomor HP di data contoh adalah karangan.

```sh
git clone --depth 1 https://github.com/lokal-id/lokal
cd lokal/examples/quickstart
```

Folder ini berisi dua file: `pelanggan.csv`, hasil ekspor data pelanggan, dan `tiket.log`, log customer support.

## 1. Temukan data pribadinya (30 detik)

```console
$ npx @lokal-id/mcp scan .
pelanggan.csv:2: NAME K*** P***
pelanggan.csv:2: NIK 3201********0001
pelanggan.csv:2: PHONE 0812****7890
…
tiket.log:2: BANK_ACCOUNT ************7890 (UU PDP: spesifik)

Found 30 personal data value(s) in 2 file(s).
```

Nilai yang ditemukan ditampilkan sebagian tersamar, dan tidak ada yang keluar dari perangkat Anda. Di dalam repository, `scan --staged` hanya memeriksa apa yang akan di-commit.

## 2. Buat salinan untuk staging (1 menit)

```console
$ npx @lokal-id/mcp kembaran pelanggan.csv tiket.log --dry-run
pelanggan.csv: would replace NAME=5, NIK=5, PHONE=5, EMAIL=5, ADDRESS=5, HEALTH=1, BANK_ACCOUNT=1
tiket.log: would replace NIK=2, PHONE=1, BANK_ACCOUNT=1
Dry run: nothing was written.

$ npx @lokal-id/mcp kembaran pelanggan.csv tiket.log -o staging/
```

Sekarang `staging/` berisi orang-orang karangan yang terlihat nyata, misalnya NIK yang valid di kecamatan yang sama dan nomor HP dari operator yang sama. Pelanggan yang sama mendapat pengganti yang sama di kedua file, jadi datanya tetap bisa di-join.

## 3. Siapkan project (30 detik)

```console
$ npx @lokal-id/mcp init --profile team
  .samaran.json                wrote
  .samaranignore               wrote
  .github/workflows/pii.yml    wrote

$ npx @lokal-id/mcp check
```

Pilihan profil:

- `personal`: menyiapkan file konfigurasi dan file ignore.
- `team`: menambahkan audit log dan workflow GitHub yang menggagalkan pull request berisi data pribadi.
- `strict`: menambahkan guard yang menahan apa pun yang tidak bisa diperiksanya, dan menolak data kesehatan, kriminal, serta biometrik, bahkan yang sudah disamarkan.

`init --dry-run` menampilkan isi file tanpa menulisnya. `check` menjelaskan apa yang dilakukan konfigurasi Anda dan memberi peringatan untuk pengaturan yang berisiko.

## 4. Biarkan agent bekerja dengan datanya (2 menit)

Di Claude Code, dari dalam `examples/quickstart`:

```text
/plugin marketplace add lokal-id/lokal
/plugin install lokal@lokal
```

Lalu minta: *"Pelanggan mana saja yang komplain? Tulis daftarnya ke keluhan.csv beserta nomor HP-nya."*

- Samaran Guard mencegah Claude membaca `pelanggan.csv` mentah-mentah dan mengarahkannya ke `read_file_masked`.
- Claude hanya melihat `[NAME_2]`, `[PHONE_2]`, dan `[NIK_2]`, bukan nilai aslinya.
- `write_file_unmasked` menulis `keluhan.csv` beserta nomor HP asli di perangkat Anda.
- Dengan profil `team`, `npx @lokal-id/mcp audit` menampilkan apa saja yang disamarkan dan dipulihkan, dalam bentuk jumlah saja.

Untuk Cursor, Codex CLI, Gemini CLI, dan VS Code, lihat [Mulai cepat di README](../README.id.md#mulai-cepat).

## 5. Lindungi panggilan LLM dari aplikasi (1 menit)

```sh
npx @lokal-id/mcp proxy          # http://127.0.0.1:8787
```

Arahkan client OpenAI atau Anthropic ke proxy (`base_url="http://127.0.0.1:8787/v1"`). Request sampai ke penyedia model dalam keadaan tersamar, dan jawabannya kembali dengan nilai asli. Supaya data kesehatan tetap di model lokal, lihat [contoh Docker Compose dengan Ollama](../examples/proxy-ollama).

## Selanjutnya

- [Apa yang tetap di perangkat Anda, dan apa yang bisa mengakses jaringan](network.id.md)
- [Policy, routing lokal, dan audit log](../README.id.md#policy-routing-lokal-dan-audit-log)
- [Cakupan tiap integrasi](../README.id.md#cakupan-tiap-integrasi), termasuk apa yang tidak terlihat olehnya
