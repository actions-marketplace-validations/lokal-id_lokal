<div align="center">

# Lokal

**Make AI coding agents Indonesia-ready.**

Skills, an MCP server, and a privacy guard that help Claude Code, Cursor, Codex, and other agents<br>
build apps that are correct for Indonesia, while keeping your users' personal data out of the model.

[![npm @lokal-id/mcp](https://img.shields.io/npm/v/@lokal-id/mcp?label=%40lokal-id%2Fmcp&color=cb3837)](https://www.npmjs.com/package/@lokal-id/mcp)
[![npm @lokal-id/core](https://img.shields.io/npm/v/@lokal-id/core?label=%40lokal-id%2Fcore&color=cb3837)](https://www.npmjs.com/package/@lokal-id/core)
[![PyPI lokal-id](https://img.shields.io/pypi/v/lokal-id?label=lokal-id&color=3775a9)](https://pypi.org/project/lokal-id/)
[![CI](https://github.com/lokal-id/lokal/actions/workflows/ci.yml/badge.svg)](https://github.com/lokal-id/lokal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio-6e56cf)](https://modelcontextprotocol.io)

[Quick start](#quick-start) ·
[Features](#features) ·
[Usage](#usage) ·
[Evaluation](#evaluation) ·
[Limitations](#limitations) ·
[**Bahasa Indonesia**](README.id.md)

</div>

---

## Why Lokal?

Ask an AI agent to "build a checkout form" and you usually get an American one:

| Without Lokal | With Lokal |
|---|---|
| *State* and *ZIP code* fields | Provinsi → Kab/Kota → Kecamatan → Kelurahan/Desa from official Kemendagri data |
| `Rp 1,500,000.00` | `Rp1.500.000` |
| US phone validation | `0812-3456-7890` → `+6281234567890`, carrier detected |
| "Submit", mixed *Anda*/*kamu* | "Kirim", one consistent register |
| No QRIS, virtual accounts, or e-wallets | QRIS, Virtual Account, GoPay/OVO/DANA, with webhook-driven status |
| Customer data sent to the LLM as-is | Masked first (`[NIK_1]`, `[PHONE_1]`), restored afterwards |

The second problem is easy to miss. While debugging, developers paste production logs and customer CSVs into Claude or Cursor, and national ID numbers (NIK), phone numbers, and bank accounts go straight to the model provider. Under Indonesia's personal data protection law, **UU PDP (UU 27/2022)**, that is a real liability.

Lokal fixes both: it teaches agents Indonesian conventions, gives them accurate reference data, and puts **Samaran** (Indonesian for *disguise*) between your data and the model.

## Features

- **Indonesian conventions for agents.** Money, phone numbers, NIK/NPWP, tiered addresses, WIB/WITA/WIT, local payment methods, UI copy, and UU PDP, packaged as [Agent Skills](https://agentskills.io).
- **Accurate reference data, bundled.** All 38 provinces down to 83,762 villages, matching the Kemendagri 2025 decree exactly, with postal codes for every village. Public holidays and *cuti bersama* from the official SKB for 2026 and 2027.
- **Samaran masking.** Replaces 25 kinds of Indonesian personal data, covering every category in UU PDP Article 4, with stable placeholders, then restores them in the model's output.
- **Samaran Guard.** A Claude Code hook that stops prompts containing ID numbers and redirects reads of customer data files (`Read`, `Grep`, `cat`, `Get-Content`, …) to a masked view.
- **Works with any agent.** Claude Code plugin, stdio MCP server for Cursor, Claude Desktop, VS Code, Windsurf, and Codex, plus TypeScript and Python libraries with identical results.
- **Local and offline.** Data ships with the package. No network calls, no telemetry, and unmasking happens on your machine.

## How it works

<p align="center">
  <a href="docs/assets/architecture.svg"><img src="docs/assets/architecture.svg" alt="Lokal architecture: the developer prompts an AI agent on their machine. Skills give the agent Indonesian conventions, Samaran Guard checks prompts and file reads, and the Lokal MCP server looks up reference data and reads and writes project files through Samaran, which masks and restores personal data. Only masked context goes to the LLM provider." width="100%"></a>
</p>

When the agent needs to look at customer data, it calls `read_file_masked` and sees `[NAME_1], [NIK_1], [PHONE_1]` instead of the real values. It can still deduplicate, join, and debug, because the same value always gets the same placeholder. When it writes results with `write_file_unmasked`, Samaran puts the real values back, on your machine.

## Quick start

### Claude Code

Installs the skills, the MCP server, and Samaran Guard in one step:

```text
/plugin marketplace add lokal-id/lokal
/plugin install lokal@lokal
```

<details>
<summary><b>MCP server only</b> (no skills or guard)</summary>

```sh
claude mcp add lokal -- npx -y @lokal-id/mcp
```

</details>

### Other MCP clients

<details>
<summary><b>Cursor, Claude Desktop, Windsurf</b></summary>

Add to `.cursor/mcp.json`, `claude_desktop_config.json`, or `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "lokal": {
      "command": "npx",
      "args": ["-y", "@lokal-id/mcp"],
      "env": { "LOKAL_ROOT": "/path/to/your/project" }
    }
  }
}
```

</details>

<details>
<summary><b>VS Code</b></summary>

Add to `.vscode/mcp.json`:

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

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.lokal]
command = "npx"
args = ["-y", "@lokal-id/mcp"]
env = { LOKAL_ROOT = "/path/to/your/project" }
```

</details>

The file tools (`scan_pii`, `read_file_masked`, `write_file_unmasked`) can only access `LOKAL_ROOT`, which defaults to `CLAUDE_PROJECT_DIR` and then to the directory the server was started in.

### Skills only, for any agent

```sh
npx skills add lokal-id/lokal
```

This installs `lokal-indonesia` and `samaran` with the [skills CLI](https://github.com/vercel-labs/skills) into Claude Code, Codex, Cursor, and the other agents it supports. Add `-g` to install them for your user instead of the current project.

Skills teach the agent the conventions. For accurate region, postal code, and holiday data and for masked file reads, add the MCP server as well (see above). Samaran Guard is a hook, so it comes only with the Claude Code plugin.

You can also copy the folders in [`skills/`](skills) by hand. They use the open Agent Skills format (`SKILL.md`).

### Library

```sh
npm install @lokal-id/core     # TypeScript / JavaScript
pip install lokal-id           # Python 3.10+
```

The Python package is a port of `@lokal-id/core` with the same rules and data, verified against thousands of TypeScript outputs. It adds `Decimal` money, `date` objects, dataclass results, and a `logging` filter for backends. See [`python/`](python#readme).

## Usage

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

listWilayah('32.76');                    // districts (kecamatan) of Kota Depok
searchWilayah('kab. bogor')[0].code;     // '32.01'
findByPostalCode('16431');               // villages that use this postal code

addWorkingDays('2026-03-17', 1);         // '2026-03-25', skipping Nyepi and Lebaran
isWorkingDay('2026-12-24', { cutiBersama: false }); // true for offices that ignore cuti bersama
```

`@lokal-id/core/wilayah` loads about 4.4 MB of region data and runs on Node only. The main entry point does not load it and is safe for browsers.

### Samaran: mask before the LLM, restore after

```ts
import { Samaran } from '@lokal-id/core';

const samaran = new Samaran();

const { text } = samaran.mask(
  'Nama: Budi Santoso, NIK 3201011508950001, refund ke rek BCA 1234567890, HP 0812-3456-7890',
);
// 'Nama: [NAME_1], NIK [NIK_1], refund ke rek BCA [BANK_ACCOUNT_1], HP [PHONE_1]'

const reply = await llm(text);   // the model never sees the real values
samaran.unmask(reply);           // placeholders are replaced with the original data
```

- The same value always maps to the same placeholder, across formats: `0812-…` and `+62 812…` are both `[PHONE_1]`.
- `mode: 'partial'` is meant for logs and admin screens: `3201********0001`, `0812****7890`, `b***@gmail.com`.
- `exclude` keeps types your app has to read. A car dealer's credit simulation needs income and installments, so `new Samaran({ exclude: ['FINANCIAL'] })` leaves "gaji saya 8 juta, cicilan 3 juta" intact while NIK and phone numbers are still masked. A misspelled type name throws instead of silently masking less.
- Detection uses labels (`Agama: Islam`, `NAMA : BUDI`), CSV and Excel headers (`agama`, `diagnosa`, `gaji`, …), JSON/YAML keys and query strings (including split `first_name` / `last_name`), SQL `INSERT` dumps, WhatsApp chat exports, and common phrases in free text (`nama saya budi`, `didiagnosis TBC`, `obat insulin`, `gaji saya 8 juta`).

<details>
<summary><b>Detected data types (25)</b></summary>

| Group | Types |
|---|---|
| Identifiers | `NIK` (structure validated), `KK`, `NPWP`, `PASSPORT`, `SIM`, `NIP`, `BPJS`, `PHONE`, `EMAIL`, `BANK_ACCOUNT`, `CARD` (Luhn), `PLATE`, `IP`, `GEO` |
| Who and where | `NAME`, `ADDRESS`, `BIRTH_DATE` (place and date of birth) |
| General personal data | `GENDER`, `RELIGION`, `MARITAL_STATUS`, `NATIONALITY` |
| Specific personal data (UU PDP Art. 4) | `HEALTH`, `FINANCIAL`, `CRIMINAL_RECORD`, `BIOMETRIC` |

</details>

### MCP tools

| Tool | What it does |
|---|---|
| `parse_nik` | Validate and decode a NIK: region, date of birth, sex |
| `validate_npwp` | Tax IDs: 15-digit NPWP, 16-digit NPWP, or NIK as NPWP |
| `parse_phone` | Normalize numbers, display format, WhatsApp link, carrier |
| `format_rupiah` | `Rp1.500.000`, `Rp1,5 jt`, spelled-out amounts (*terbilang*) |
| `parse_rupiah` | "2jtan", "goceng", "sejuta setengah" → numbers |
| `search_wilayah` | Find provinces, regencies, districts, and villages with their codes |
| `list_wilayah` | Child regions for cascading address dropdowns, with postal codes |
| `lookup_kode_pos` | Postal code → villages, or all postal codes in a region |
| `list_holidays` | National holidays and *cuti bersama* (SKB 2026, 2027) |
| `working_days` | Business days, SLA due dates, delivery estimates |
| `scan_pii` | Scan files and folders (text, CSV, JSON, logs, SQL, `.xlsx`, `.docx`, up to 100 MB each) for personal data. Shows partially masked values only, and **reports files it could not scan** (PDF, `.xls`, `.doc`, images) |
| `read_file_masked` | Read a file, including `.xlsx` sheets and `.docx` documents (text and tables), with personal data replaced by stable placeholders |
| `write_file_unmasked` | Write results with placeholders restored, on your machine |

### Samaran Guard

Enabled automatically by the Claude Code plugin.

- **Prompts** containing ID numbers (NIK, KK, NPWP, passport, SIM, NIP, bank account, BPJS, card) or labeled health, criminal, or biometric data are held before they are sent. Add `#izinkan-pii` to send anyway.
- **Reads of data files** (CSV, Excel, JSON, logs, SQL dumps, YAML, …) that contain personal data are blocked, and Claude is pointed to `read_file_masked`. This covers the `Read` tool, `Grep` in content mode, and shell commands such as `cat`, `head`, `grep`, `sed -n`, `awk`, `cut`, `Get-Content`, and `Import-Csv | Select-Object`.
- **Only what would be printed counts.** `head -1 data.csv` (the header), `wc -l`, `grep -c`, and `sort data.csv > out.csv` still run.
- **Not blocked:** source code, where sample numbers are normal and the agent must be able to read them, and scripts run on data files (`node process.js data.csv`), which is how data gets processed without being shown to the model.
- List files that contain fake data (fixtures, seeders) in `.samaranignore`:

  ```gitignore
  test/fixtures/
  database/seeders/
  *.example.csv
  ```

- Set `SAMARAN_GUARD=off` to disable the guard.

## Evaluation

The same vibe-coding tasks were run in real Claude Code sessions in an empty folder, with and without the Lokal plugin, three times each (`npm run eval`, cases in [`evals/cases.mjs`](evals/cases.mjs)):

| Task | Without Lokal | With Lokal |
|---|---|---|
| Checkout form for Indonesian customers | 16/18 (address stops at city in 2 of 3 runs) | 18/18 |
| Customer-service chatbot calling the Claude API | 8/12 (data never restored in replies) | 12/12 |
| Deduplicate a customer CSV | 3/6 (**NIK and phone numbers sent to the model in 3/3 runs**) | 6/6 (model sees placeholders only) |
| SLA with the 2026 Lebaran holidays | 3/3 | 3/3 |
| **Total** | **30/39** | **39/39** |

A fifth task, **debugging an `app.log` that contains customer NIK, phone numbers, and emails**, was added later. Without Lokal, the agent ran `Get-Content app.log` and the whole log reached the model. With Lokal, the agent used `scan_pii` → `read_file_masked`, and no customer data reached the model in 2 of 2 runs. The first run of this task exposed a bug where a `key=value` log field swallowed the next pair and leaked a phone number through the scan preview. It is fixed and covered by a regression test.

### Hard cases

Three harder tasks use answers checked against official sources rather than Lokal's own data, and real document formats with fake identities (2 runs each):

| Task | Without Lokal | With Lokal |
|---|---|---|
| Postal codes for Depok kelurahan, provinces after the 2022 Papua split, an SLA around Lebaran 2027 | 6/8 (**SLA wrong in 2/2 runs**: the 2027 SKB is newer than the model) | 8/8 |
| Join a marketplace export with a Midtrans log, list paid orders without a resi, phone numbers as E.164 | 8/14 (right answer, every customer's data sent to the model) | 14/14 (right answer, the model saw placeholders only) |
| Summarize a WhatsApp CS export for the product team without customer identities | 4/10 | 10/10 |

The first runs of these tasks found a bug and four detection gaps, all fixed in 0.2.1: a phone number at the end of a line leaked when the next line began with a digit, and names split into `first_name` / `last_name`, WhatsApp senders, medicines and hospital stays were missed. The id.wikipedia list of Depok postal codes turned out to be wrong for 32 kelurahan; Lokal matches [en.wikipedia](https://en.wikipedia.org/wiki/Cinere) and other sources.

`npm run eval:pii` runs the format benchmark on its own: 43 of 43 personal values masked across 15 formats (KTP OCR, WhatsApp exports, Midtrans JSON, Laravel logs, SQL dumps, …), and 27 of 27 look-alikes left intact (resi numbers, invoice IDs, timestamps, call-center numbers, institutions).

This is a small sample built around everyday tasks for Indonesian developers. Do not read it as a general benchmark.

## Limitations

- **Detection is pattern-based and favors precision.** Names are found through labels, column headers and JSON keys, chat export senders, introductions ("nama saya budi", "atas nama", "a.n.", "halo kak ini rina,"), honorifics ("Pak Joko", "bapak ahmad"), and reported speech ("tadi budi bilang"), including lowercase. A name dropped into a sentence with no cue at all ("pesanan budi belum sampai"), unusually phrased health or financial data, and children's data that is not marked as such can still slip through. Treat Samaran as a strong safety net, not a guarantee.
- **Tested for false positives** on 12 MB of open-source code and the full text of UU 27/2022, with no high-confidence name detections. Chat name detection caught 29 of 29 test sentences with names and flagged 0 of 26 ordinary chat sentences. The sentences were written for the test suite, so accuracy on real chats may be lower.
- **Not every format is read.** PDF, legacy `.xls` and `.doc`, images (ID card photos, selfies), and archives are not scanned. `scan_pii` reports them as *not scanned*, never as clean, and the guard does not intercept them. Files over 100 MB are reported too. For data files over 5 MB the guard checks the first 5 MB, to stay within the hook's 10-second limit.
- **NIK and NPWP checks are structural.** They cannot confirm that a number is registered with Dukcapil or the tax office.
- **Carrier detection uses number prefixes,** which match the public allocation list, including the 2025 XLSmart merger. Indonesia has no mobile number portability yet (a case is pending at the Constitutional Court, 319/PUU-XXIV/2026), so prefixes are still reliable. Landline area codes cover 19 major cities.
- **The guard intercepts prompts, `Read`, `Grep`, and common shell readers.** A script that deliberately prints a data file, or something like `python -c "print(open(...).read())"`, cannot be caught every time. The `samaran` skill steers the agent away from that.
- **Holidays** exist only for years whose SKB has been published (2026, 2027). Other years return an error, not a guess.
- **ChatGPT** needs MCP over HTTP. This server supports stdio only for now.

## Roadmap

- [x] National holidays and *cuti bersama* per year
- [x] Postal codes for every village
- [x] UU PDP data categories and Excel support in Samaran
- [ ] **Kapan**: Indonesian time expressions (`besok abis maghrib`, `lusa jam 7an`, `tanggal muda`) with location-based prayer times
- [ ] **Warga**: consistent synthetic test data (NIK matching birth date and region, region-appropriate names)
- [x] `.docx` support in Samaran (text and tables)
- [ ] Text-based PDF support in Samaran; OCR for scanned ID cards
- [ ] Free-text address parser → region codes
- [ ] HTTP transport for ChatGPT and web-based agents
- [x] Python library (`lokal-id`) with the same results as TypeScript
- [ ] Locale packs for other countries (Malaysia, the Philippines, Vietnam)

Have an idea? [Open an issue](https://github.com/lokal-id/lokal/issues).

## Project structure

```text
packages/core     @lokal-id/core: logic and bundled data
packages/mcp      @lokal-id/mcp: MCP server and Samaran Guard
python/           lokal-id: the Python port, with parity tests against TypeScript
skills/           SKILL.md files for Claude, Codex, and other agents
hooks/            Claude Code hook (bundled, no dependencies)
evals/            end-to-end evaluation against real Claude Code sessions
.claude-plugin/   plugin and marketplace manifests
```

## Contributing

Contributions are welcome, in English or Bahasa Indonesia. Missed detections and false positives are especially useful. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines, and **never include real personal data in issues or pull requests**.

```sh
npm install
npm run build   # core, mcp, and the bundled hook
npm test        # unit tests, MCP server end to end, guard
npm run eval    # real Claude Code sessions with and without the plugin
```

## Security

If you find a way to get personal data past Samaran or the guard, please report it privately as described in [SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

Code is released under the [MIT License](LICENSE). Bundled data keeps its own terms:

| Data | Source | License |
|---|---|---|
| Regions (38 provinces, 416 regencies, 98 cities, 7,285 districts, 8,496 *kelurahan*, 75,266 villages) | [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah), following Kepmendagri 300.2.2-2138/2025 as amended by 300.2.2-2430/2025 | MIT |
| Postal codes (83,762 of 83,762 villages) | [cahyadsn/wilayah_kodepos](https://github.com/cahyadsn/wilayah_kodepos) | MIT |
| Holidays and *cuti bersama* | SKB 3 Menteri via [setneg.go.id](https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026) | Public government document |

Region totals match the Kemendagri decree exactly and were last checked in October 2026; see [`packages/core/data/README.md`](packages/core/data/README.md) to regenerate them. Every holiday date is tested against the weekday in the official announcement. The UU PDP summary in the skills was checked against the official text of UU 27/2022.

## Acknowledgements

- [cahyadsn](https://github.com/cahyadsn) for maintaining open Indonesian region and postal code data.
- [Model Context Protocol](https://modelcontextprotocol.io) and [Agent Skills](https://agentskills.io) for open standards that let one toolkit work across agents.
