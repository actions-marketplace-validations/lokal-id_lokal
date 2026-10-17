# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **PDF support** in `scan_pii`, `read_file_masked`, and the guard, without new dependencies. Text-based PDFs (invoices, letters, statements, and reports from browsers, Word, or PDF libraries) are read page by page: table columns are kept apart by tabs, and filled-in form fields come out as `field_name: value`, so a credit application's `nama_pemohon` and `nik` are masked. Comments and stamps are read too. Scanned pages have no text layer and are reported as needing OCR, also when only some pages of a PDF are scanned; encrypted PDFs are reported as such. On 60 PDFs made with Apache FOP, Acrobat Distiller, Word, InDesign, and Illustrator, the extracted words match Poppler's `pdftotext` 99.2–100% on 58; on the other two, one-line templates, Lokal reads an "fi" ligature that `pdftotext` splits. A 1,000-page PDF is checked by the guard in under 2 seconds.
- The guard checks `Read` of `.pdf` and `.docx` files, since Claude Code sends a PDF's pages to the model, and `pdftotext file.pdf -`.
- **The guard asks before `Read` sends what Samaran cannot check.** A photo named or filed like someone's document (`ktp-budi.jpg`, `selfie_siti.png`, images under `media/`, `uploads/`, or `storage/`, but not the app's `assets/` or `images/`) and a scanned, encrypted, or damaged PDF now bring up Claude Code's permission prompt with the reason, instead of going to the model unseen. Previously a KTP photo in an upload folder was read without a word.
- **`lokal.files` for Python**: the MCP server's file readers, with the same results, for backends. `scan_path('var/media')` reports personal data per file, sheet, and page with partially masked previews, and lists what it could not read (photos, scanned pages, encrypted PDFs); `load_document()` turns a CSV, Excel, Word, or PDF file into text parts to mask. Parity vectors cover the fixtures, hand-built PDFs, and damaged copies; 63 real PDFs of up to 1,000 pages gave identical text.
- Samaran reads tab-separated tables anywhere in a text, as copied from Excel or Word or extracted from a PDF: `Nama Pelanggan<TAB>Budi Santoso`, and a `Nama<TAB>NIK<TAB>Telepon` header followed by rows. Tested against 64,000 files from Git for Windows and a Python installation, 1,300 of them with tabs: no new matches.

### Fixed

- A small `.xlsx` or `.docx` built to decompress to gigabytes could exhaust memory in `scan_pii`, `read_file_masked`, or the guard. Each file inside the ZIP is now limited to 256 MB, and damaged ZIPs are reported with a clear reason.
- A list of labels and values at the start of a text (`Nama<TAB>Budi` then `NIK<TAB>3201…`) was read as a table with a header, so the labels below it were masked as names.
- **A name with a nickname in brackets was not masked at all**: `Nama: Siti Aminah (Ami)` and a CSV cell `Rina Wati (Rin)` looked like a function call and were skipped. A trailing `(Nickname)` now counts as part of the name.
- `Pemesan:`, `Pembeli:`, `Buyer:`, `Konsumen:`, `Atas nama:`, and `A/N:` are name labels, as are columns like `nama_pemesan` and `alamat_pembeli`. Marketplace and CRM exports use them for the customer.
- A labeled name no longer swallows the chat around it: `Nama: Budi Santoso ya kak 🙏` masks only `Budi Santoso`. The value ends at an emoji, `!` or `?`, a lowercase chat word (`ya`, `kak`, `dong`, `sudah`, `tadi` …), or the start of the next sentence (`Saya`, `Mohon`, `Terima kasih` …). Titles, initials, and names such as `Lee Dong Hae` and `Ahmad bin Abdullah` are kept whole.

### Changed

- npm releases are built, tested, and published by GitHub Actions from the release tag with Trusted Publishing, and carry provenance attestations. The same workflow lists the server in the official MCP Registry as `io.github.lokal-id/lokal`.

## [0.2.3] - 2026-10-16 (Python only)

- `lokal-id` on PyPI, with the same code as 0.2.2 below. The `lokal-id` 0.2.2 upload on PyPI was built from an earlier checkout and lacks `exclude`, the `INV-…` phone fix, and the pronoun health rule; it is yanked. From this release on, PyPI uploads are built and tested by GitHub Actions from the release tag (`py-v*`) with Trusted Publishing.

## [0.2.2] - 2026-10-16

### Added

- **`lokal-id` for Python** (`pip install lokal-id`, Python 3.10+): a dependency-free port of `@lokal-id/core` with the same rules and data. Its test suite replays vectors generated from the TypeScript build (NIK, NPWP, phone, Rupiah, terbilang, every day of 2026–2027, all 91,000 regions with postal codes, and 2,700 Samaran texts) and requires identical output. Python extras: exact `Decimal` amounts, `date`/`datetime` input and output, dataclass results with `to_dict()`, and `SamaranFilter` for the `logging` module. Install 0.2.3 or later; see above.
- `exclude` option (`exclude: ['FINANCIAL', 'NAME']`, Python `exclude=[...]`) for types an app has to read, such as income and installments in a dealer's credit simulation. Unknown type names in `types` or `exclude` now throw.
- `scan_pii` and `read_file_masked` read `.docx` files: the text, headers, and footers, with each table as its own CSV part so a "Nama" column is masked like a spreadsheet column.
- `scan_pii` and `read_file_masked` read files up to 100 MB (was 5 MB).

### Fixed

- **The guard let large data files through.** A CSV or log over 5 MB was skipped instead of checked, so `Read` or `cat` passed it to the model. The guard now checks the first 5 MB. A `cat` of such a file then crashed the guard with a stack overflow (a 240,000-element spread), which also let it through, and partial outputs (`cut`, `grep`) of big files were checked in quadratic time that could exceed the 10-second hook limit. All three are fixed; a 6 MB export is now blocked in about 2 s.
- Numbers glued to a code are no longer phone numbers: `INV-081234567890`, `ORD/081234567890`. `hp-0812…` and `wa.me/62…` still are.
- A condition right after a pronoun is health data: "saya diabetes", "ibu saya hipertensi".
- **A labeled value with repeated spaces left the end of a name unmasked**: `Pasien: Siti   Aminah` became `[NAME_1]ah`, because the value was rejoined with single spaces and the mask stopped short. Values now keep their original spacing, and every match equals the text at its offsets.
- **Long single-line inputs were quadratic**: masking a 1.5 MB single-line JSON file took over ten minutes, long enough for the guard hook to time out and let the read through. It now takes about 0.3 s.
- `isWorkingDay('2026-02-30')` and other impossible dates silently rolled over to the next month; they now throw.
- `formatRupiahShort(999999)` gave `Rp1000 rb` instead of `Rp1 jt`; `formatRupiah(1e21)` printed `Rp1e+21`; `terbilang(1e-7)` threw an unrelated BigInt error; `parseRupiah('constructor')` returned `{ amount: null }`.
- Partial masks of names and emails that start with an emoji no longer cut the emoji in half.
- The WhatsApp chat sender offset is taken from the match itself instead of searching the line.

## [0.2.1] - 2026-10-16

### Fixed

- **A phone number at the end of a line was left unmasked when the next line started with a digit**, for example a WhatsApp export title followed by a dated message, or a log field followed by a timestamp. The detector swallowed the next line's digits, the result failed validation, and the number passed through `read_file_masked` and the guard. Separators inside a phone number no longer cross a line break.

### Added

- Samaran detects names split across `first_name` / `last_name` / `given_name` / `family_name` keys, as Midtrans, Xendit, and most CRMs send them.
- WhatsApp chat exports: sender names on Android and iOS lines and in the export title. Business accounts (`Toko …`, `Admin`, `CS`) and log levels are left alone.
- Health data in free text: medicines that reveal a condition (`obat insulin`, `terapi ARV`), hospital stays (`dirawat di RSUD …`), conditions after `karena` and in brackets (`(diabetes)`).
- SQL dumps: `INSERT INTO … (columns) VALUES (…)` values are matched to their columns. A bare `nama` column in a product or region table is not treated as a person.
- Emails spelled out as `nama [at] gmail [dot] com`, one-word self-introductions (`halo kak ini rina,`), and names in reported speech (`tadi budi bilang`).
- `npm run eval:pii`: a benchmark of real-world Indonesian document formats with fake identities and false-positive traps.
- Three hard eval cases checked against official sources: postal codes, the 2022 Papua provinces, and the 2027 SKB holidays; a marketplace export joined with a Midtrans log; and a WhatsApp CS export summarized without identities.
- `server.json` and `mcpName` for the official MCP Registry (`io.github.lokal-id/lokal`).

## [0.2.0] - 2026-10-16

First public release.

### Added

- `@lokal-id/core`: NIK and NPWP validation, phone number parsing with carrier detection, Rupiah formatting and parsing (`2jtan`, `goceng`, `sejuta setengah`), *terbilang*, national holidays and *cuti bersama* for 2026 and 2027, and working-day calculations.
- `@lokal-id/core/wilayah`: Kemendagri regions down to village level (Kepmendagri 300.2.2-2138/2025) with postal codes for all 83,762 villages.
- Samaran: masking and unmasking of 25 types of Indonesian personal data, covering every category in UU PDP Article 4, from labeled text, CSV and Excel headers, JSON/YAML keys, and free-text phrases. Includes partial masking for logs.
- `@lokal-id/mcp`: an MCP server with 13 tools, including `scan_pii`, `read_file_masked`, and `write_file_unmasked` for working with production data without exposing it.
- Samaran Guard: a Claude Code hook that holds prompts containing ID numbers and redirects reads of personal data files through `Read`, `Grep`, Bash, and PowerShell to a masked view. Supports `.samaranignore`.
- Skills `lokal-indonesia` and `samaran` in the Agent Skills format.
- Claude Code plugin and marketplace manifests.
- End-to-end evaluation against real Claude Code sessions (`npm run eval`).

[Unreleased]: https://github.com/lokal-id/lokal/compare/v0.2.2...HEAD
[0.2.3]: https://github.com/lokal-id/lokal/releases/tag/py-v0.2.3
[0.2.2]: https://github.com/lokal-id/lokal/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/lokal-id/lokal/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/lokal-id/lokal/releases/tag/v0.2.0
