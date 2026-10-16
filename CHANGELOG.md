# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lokal-id/lokal/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/lokal-id/lokal/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/lokal-id/lokal/releases/tag/v0.2.0
