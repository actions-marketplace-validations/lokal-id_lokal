# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lokal-id/lokal/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/lokal-id/lokal/releases/tag/v0.2.0
