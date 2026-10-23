<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo/lokal-wordmark-white.svg">
    <img src="docs/assets/logo/lokal-wordmark.svg" alt="Lokal" height="72">
  </picture>
</h1>

**Make AI coding agents Indonesia-ready.**

Skills, an MCP server, and a privacy guard that help Claude Code, Cursor, Codex, and other agents<br>
build apps that are correct for Indonesia, while keeping your users' personal data out of the model.

[![npm @lokal-id/mcp](https://img.shields.io/npm/v/@lokal-id/mcp?label=%40lokal-id%2Fmcp&color=cb3837)](https://www.npmjs.com/package/@lokal-id/mcp)
[![npm @lokal-id/core](https://img.shields.io/npm/v/@lokal-id/core?label=%40lokal-id%2Fcore&color=cb3837)](https://www.npmjs.com/package/@lokal-id/core)
[![PyPI lokal-id](https://img.shields.io/pypi/v/lokal-id?label=lokal-id&color=3775a9)](https://pypi.org/project/lokal-id/)
[![CI](https://github.com/lokal-id/lokal/actions/workflows/ci.yml/badge.svg)](https://github.com/lokal-id/lokal/actions/workflows/ci.yml)
[![npm provenance](https://img.shields.io/badge/npm-provenance-2ea44f?logo=npm)](SECURITY.md#how-releases-are-protected)
[![Third-party dependencies: 0](https://img.shields.io/badge/third--party%20dependencies-0-2ea44f)](SECURITY.md#how-releases-are-protected)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%7C%20HTTP-6e56cf)](https://modelcontextprotocol.io)

[Quick start](#quick-start) ·
[Features](#features) ·
[Usage](#usage) ·
[Evaluation](#evaluation) ·
[Limitations](#limitations) ·
[**Bahasa Indonesia**](README.id.md)

<br>

<img src="docs/assets/demo.gif" alt="An AI agent reads pelanggan.csv twice. Without Lokal, the real names, NIK numbers, and phone numbers are sent to the model provider. With Lokal, it reads the file through read_file_masked, the provider receives only [NAME_1], [NIK_1], and [PHONE_1], and write_file_unmasked writes the fix back with the real values on your machine." width="100%">

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
- **Samaran masking.** Replaces 27 kinds of Indonesian personal data, covering every category in UU PDP Article 4, with stable placeholders, then restores them in the model's output.
- **Samaran Guard.** A hook for Claude Code, Codex CLI, Cursor, and Gemini CLI that stops prompts containing ID numbers and redirects reads of customer data files (`Read`, `Grep`, `cat`, `Get-Content`, …) to a masked view.
- **Kembaran.** Copies production dumps and exports for staging with every person replaced by a realistic stand-in: a valid NIK in the same district, a phone number on the same operator, consistent across tables.
- **Samaran Proxy.** An OpenAI- and Anthropic-compatible endpoint that masks personal data in every LLM call your app makes and restores it in the answers, streaming included. Change the base URL, not the code. For serverless apps, the same masking as a [Vercel AI SDK](https://ai-sdk.dev) middleware.
- **Lokal Scan.** A GitHub Action and pre-commit hook that stop personal data from being committed. It checks only the lines a pull request adds and marks each value on the changed line.
- **Browser extension.** Masks personal data pasted or typed into ChatGPT, Claude, Gemini, and other AI chats, and restores it when you copy the answer.
- **Works with any agent.** Claude Code plugin, stdio MCP server for Cursor, Claude Desktop, VS Code, Windsurf, and Codex, an HTTP server for ChatGPT and Claude.ai connectors, plus TypeScript and Python libraries with identical results.
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

<details>
<summary><b>ChatGPT and Claude.ai (remote connector)</b></summary>

ChatGPT and Claude.ai on the web connect only to remote MCP servers over HTTPS. Run the server in HTTP mode:

```sh
npx @lokal-id/mcp serve --http --port 3000                  # http://127.0.0.1:3000/mcp
npx @lokal-id/mcp serve --http --host 0.0.0.0 --port $PORT  # on a Node host such as Render or Fly.io
```

Put it behind HTTPS (your host's domain, or `cloudflared tunnel --url http://localhost:3000` to try it), then add `https://<your-domain>/mcp` as a custom connector: in ChatGPT through developer mode (availability depends on your plan), in Claude.ai under Settings → Connectors. HTTP mode serves the data tools only (NIK, NPWP, phone, Rupiah, regions, postal codes, holidays, QRIS). The file tools are left out: a remote server cannot see your files, and it must not open its own.

</details>

The file tools (`scan_pii`, `read_file_masked`, `write_file_unmasked`) can only access `LOKAL_ROOT`, which defaults to `CLAUDE_PROJECT_DIR` and then to the directory the server was started in.

### Skills only, for any agent

```sh
npx skills add lokal-id/lokal
```

This installs `lokal-indonesia` and `samaran` with the [skills CLI](https://github.com/vercel-labs/skills) into Claude Code, Codex, Cursor, and the other agents it supports. Add `-g` to install them for your user instead of the current project.

Skills teach the agent the conventions. For accurate region, postal code, and holiday data and for masked file reads, add the MCP server as well (see above). Samaran Guard is a hook: it comes with the Claude Code plugin, and [can be set up](#in-codex-cli-cursor-and-gemini-cli) in Codex CLI, Cursor, and Gemini CLI.

You can also copy the folders in [`skills/`](skills) by hand. They use the open Agent Skills format (`SKILL.md`).

### Library

```sh
npm install @lokal-id/core     # TypeScript / JavaScript
pip install lokal-id           # Python 3.10+
```

The Python package is a port of `@lokal-id/core` with the same rules and data, verified against thousands of TypeScript outputs. It adds `Decimal` money, `date` objects, dataclass results, a `logging` filter for backends, and `lokal.files`, the MCP server's file readers, to scan an upload folder (`scan_pii` for your backend) or mask a PDF before it reaches an LLM. See [`python/`](python#readme).

## Usage

### Library

```ts
import {
  parseNik, parsePhone, formatRupiah, parseRupiah, terbilang, addWorkingDays, isWorkingDay, parseQris, setQrisAmount,
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

parseQris(payload);                      // { valid, type: 'static', merchantName, nmid, criteriaLabel: 'Usaha Mikro', … }
setQrisAmount(payload, 25000);           // the same merchant's QRIS, dynamic, for Rp25.000, with a new CRC
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
- Detection uses labels (`Agama: Islam`, `NAMA : BUDI`), CSV and Excel headers (`agama`, `diagnosa`, `gaji`, …), JSON/YAML keys and query strings (including split `first_name` / `last_name`), SQL dumps (`INSERT` with or without column names, as mysqldump writes them, and pg_dump's `COPY` blocks), WhatsApp chat exports, and common phrases in free text (`nama saya budi`, `didiagnosis TBC`, `obat insulin`, `gaji saya 8 juta`).

<details>
<summary><b>Detected data types (25)</b></summary>

| Group | Types |
|---|---|
| Identifiers | `NIK` (structure validated), `KK`, `NPWP`, `PASSPORT`, `SIM`, `NIP`, `BPJS`, `NISN`, `AKTA` (birth, marriage, and death certificate numbers), `PHONE`, `EMAIL`, `BANK_ACCOUNT`, `CARD` (Luhn), `PLATE`, `IP`, `GEO` |
| Who and where | `NAME`, `ADDRESS`, `BIRTH_DATE` (place and date of birth) |
| General personal data | `GENDER`, `RELIGION`, `MARITAL_STATUS`, `NATIONALITY` |
| Specific personal data (UU PDP Art. 4) | `HEALTH`, `FINANCIAL`, `CRIMINAL_RECORD`, `BIOMETRIC` |

</details>

### Samaran Proxy: protect an app's LLM calls

Masking by hand means every call site has to remember it. The proxy does it for the whole app: start it next to your backend and point the SDK's base URL at it.

```sh
npx @lokal-id/mcp proxy                 # http://127.0.0.1:8787
```

```python
from openai import OpenAI
from anthropic import Anthropic

client = OpenAI(base_url='http://127.0.0.1:8787/v1')   # Chat Completions, Responses, embeddings
claude = Anthropic(base_url='http://127.0.0.1:8787')   # Messages
```

- Every text in the request is masked before it leaves your server: the conversation history, system prompts, tool results, and tool call arguments. Images, IDs, and signed thinking blocks are left alone.
- Responses come back with the real values, streamed or not, including tool call arguments, so the tools your app runs get real data.
- Each request gets its own vault. Masking the whole conversation in order gives the same person the same placeholder on every turn.
- Other OpenAI-compatible APIs work too: `--openai https://openrouter.ai/api/v1`, Groq, DeepSeek, Ollama, or Gemini's OpenAI endpoint. `--exclude FINANCIAL` lets the model see income figures for a credit simulation.
- It listens on 127.0.0.1 only, passes API keys through without storing them, and logs one line per request with counts, never values. Each response has an `x-samaran-masked: NIK=1,NAME=2` header. File uploads cannot be masked and are refused unless you start it with `--allow-unmasked`.

Tested end to end with Claude Code itself running through it: the model only ever saw placeholders, and the files it wrote with its tools had the real values.

### Samaran for the Vercel AI SDK: masking inside the app

Where the proxy cannot run, such as serverless and edge functions, or with APIs it does not speak, such as Gemini's native API and Bedrock, wrap the model instead. The middleware does the same work in-process, for every provider the [AI SDK](https://ai-sdk.dev) supports:

```ts
import { generateText, wrapLanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { samaranMiddleware } from '@lokal-id/core/ai-sdk';

const model = wrapLanguageModel({ model: openai('gpt-5'), middleware: samaranMiddleware() });

const { text } = await generateText({ model, prompt: tiket });   // the model sees [NAME_1], you get the real name
```

- The prompt is masked in order on every call: system, messages, tool calls, and tool results. Tool results are masked as JSON, so `{ "nama": "Budi Santoso" }` is caught by its key.
- Answers come back with real values, streamed or not. A placeholder split across chunks is held back until it is complete, so `useChat` never shows half of one. Tool inputs are restored as valid JSON, so tools run on real data, and `Output.object` gets correctly escaped values.
- `samaranMiddleware({ exclude: ['FINANCIAL'], allow: ['0800-1-500-888'] })` takes the same options as `Samaran`. `onMask` receives counts per type, never values, for audit logs.
- AI SDK 7 by default; for AI SDK 6 pass `specificationVersion: 'v3'`. No extra dependency.
- Reasoning is left as the model wrote it, because providers sign it. Images and files are sent as they are, so extract and mask the text of a document before attaching it.

### Kembaran: production data for staging, without real people

Copying production data to staging or a laptop is the most common way personal data leaks. Kembaran makes a copy in which every person is a realistic stand-in, so the data still behaves like production:

```sh
npx @lokal-id/mcp kembaran prod.sql export.csv -o staging/ --secret staging-2026
python -m lokal.kembaran prod.sql -o staging.sql          # the same, from a Python backend
```

```
nama,nik,tgl_lahir,hp,email
Budi Santoso,3201011508950001,15-08-1995,0812-3456-7890,budi.santoso@gmail.com
↓
Slamet Matondang,3201012409953895,24-09-1995,0812-8655-8077,rini.pertiwi10@example.com
```

| Value | Stand-in keeps |
|---|---|
| NIK, KK | District, gender, and birth year; still a valid NIK |
| Birth date | The year; on the same row, the date in the stand-in NIK |
| Phone | Operator and format: `0812-…` stays Telkomsel |
| Name | Number of words, casing, titles (`Dr. Ir. H. …`) |
| Address | RT/RW, village, district, city; street and house number change |
| E-mail | Nothing: `…@example.com`, so staging cannot mail anyone |
| Card, bank account | Length; a card keeps its issuer prefix and passes Luhn |

- The same value gets the same stand-in in every file of one run, so joins and foreign keys hold. `0812-3456-7890` and `+62 812 3456 7890` are one person. An individual's NPWP stays equal to their NIK.
- Stand-ins come from HMAC-SHA256 under a secret. Without `--secret` it is random for each run; with one, a weekly staging refresh gives the same people. NIKs, phone numbers, and account numbers never collide.
- Gender, religion, marital status, and nationality are kept by default; `--keep FINANCIAL` keeps more. `--keep-birth-date` keeps whole birth dates.
- In an agent, the `anonymize_file` tool does it on your machine and returns only counts. TypeScript: `new Kembaran({ secret }).text(text)` from `@lokal-id/core/kembaran`; Python: `Kembaran(secret=…).text(text)` from `lokal.kembaran`, with the same output for the same secret.

A stand-in phone number can still belong to someone, so keep staging from sending SMS or WhatsApp. Text files only (SQL dumps, CSV, JSON, logs) up to 100 MB; about 2 MB/s in TypeScript.

### Browser extension: for ChatGPT, Claude, and Gemini on the web

Not everyone pastes customer data through an agent. Customer service, HR, and finance teams paste it into ChatGPT or Claude in the browser. The Lokal extension masks personal data as it is pasted or before a message is sent, so the site receives `[NIK_1]` and `[PHONE_1]`:

<img src="docs/assets/extension-demo.gif" alt="Customer data is pasted into an AI chat. The extension masks names, NIK numbers, and phone numbers before the message is sent, the AI answers with placeholders, pointing at one shows the real value, and copying the answer brings the real values back." width="100%">

- Placeholders in the answer are highlighted; point at one to see the real value.
- Copying the answer, with Ctrl+C or the site's copy button, puts the real values back.
- Real values are never written into the site's page, where its scripts could read them, and are forgotten when the browser closes. No server, no network requests.

It runs on ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok, and Le Chat, in Chrome, Edge, and other Chromium browsers. It is not in the Chrome Web Store yet: download `lokal-extension-<version>.zip` from the [latest release](https://github.com/lokal-id/lokal/releases/latest), unzip it, and load the folder with **Load unpacked** (see [packages/extension](packages/extension/README.md), which also lists its limitations: attached files are not masked).

### Lokal Scan: keep personal data out of the repository

Seeders, fixtures, and dumps copied from production end up in git, and from there in every clone, fork, and CI log. `lokal-mcp scan` finds Indonesian personal data before it is committed. With `--staged` or `--diff` it checks only the lines a commit or pull request adds, so a repository that already holds test data can turn it on today.

**GitHub Actions.** Each value is marked on the changed line of the pull request, and the job fails ([see an example pull request](https://github.com/lokal-id/action-test/pull/1/files)):

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
      - uses: lokal-id/lokal@v0.5.0
        # with:
        #   scope: all              # every tracked file, not only the changes
        #   min-confidence: medium  # also values without a label or column name
        #   types: NIK,KK,PHONE     # only these types
        #   fail: false             # annotate without failing
```

**Pre-commit hook.** With [pre-commit](https://pre-commit.com):

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: lokal-scan
        name: Indonesian personal data
        entry: lokal-mcp scan --staged
        language: node
        additional_dependencies: ['@lokal-id/mcp@0.5.0']
        pass_filenames: false
```

With Husky, put `npx lokal-mcp scan --staged` in `.husky/pre-commit` after `npm i -D @lokal-id/mcp`. Without either, the same line in `.git/hooks/pre-commit` works.

**Command line:**

```console
$ npx @lokal-id/mcp scan --staged
seed/pelanggan.csv:14: NIK 3201********0001
seed/pelanggan.csv:14: PHONE 0812****7890

Found 2 personal data value(s) in 1 file(s).
```

- `scan [path…]` checks every file git tracks (or every file, outside a repository); `--diff origin/main` checks a branch; `--format json` and `--format github` are for tools. Exit code 1 means something was found.
- Findings show partially masked values only, because CI logs are often public. Nothing leaves the machine.
- Files that only hold made-up data go in `.samaranignore`. A single line is skipped when it contains `samaran-ignore`, such as `const nik = '3201011508950001'; // samaran-ignore`.
- Spreadsheets, Word documents, and PDFs in a change are checked whole. Files that could not be read (encrypted PDFs, `.xls`, archives) are reported as warnings, or fail the check with `--strict`.

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
| `parse_qris` | Read and check a QRIS payload: merchant, NMID, criteria, amount, CRC |
| `set_qris_amount` | Make a merchant's QRIS dynamic for an amount, with a new CRC |
| `scan_pii` | Scan files and folders (text, CSV, JSON, logs, SQL, `.xlsx`, `.docx`, text-based PDF, up to 100 MB each) for personal data. Shows partially masked values only, and **reports files and pages it could not scan** (scanned or encrypted PDFs, `.xls`, `.doc`, images) |
| `read_file_masked` | Read a file, including `.xlsx` sheets, `.docx` documents (text and tables), and PDFs (page text, tables, and filled-in form fields), with personal data replaced by stable placeholders |
| `write_file_unmasked` | Write results with placeholders restored, on your machine |
| `anonymize_file` | Copy dumps and exports with realistic stand-ins for every person (Kembaran), returning only counts |

### Samaran Guard

Enabled automatically by the Claude Code plugin.

- **Prompts** containing ID numbers (NIK, KK, NPWP, passport, SIM, NIP, NISN, civil registry deed, bank account, BPJS, card) or labeled health, criminal, or biometric data are held before they are sent. Add `#izinkan-pii` to send anyway.
- **Reads of data files** (CSV, Excel, JSON, logs, SQL dumps, YAML, …) that contain personal data are blocked, and Claude is pointed to `read_file_masked`. This covers the `Read` tool, `Grep` in content mode, and shell commands such as `cat`, `head`, `grep`, `sed -n`, `awk`, `cut`, `Get-Content`, and `Import-Csv | Select-Object`.
- **Photos and PDFs Samaran cannot read are asked about first.** `Read` sends images and PDFs to the model as they are. For a photo named or filed like someone's document (`ktp-budi.jpg`, `selfie_siti.png`, anything under `media/`, `uploads/`, or `storage/` except the app's own `assets/` and `images/`) and for a scanned, encrypted, or damaged PDF, Claude Code shows a permission prompt with the reason. A PDF whose text contains personal data is blocked as a data file.
- **Only what would be printed counts.** `head -1 data.csv` (the header), `wc -l`, `grep -c`, and `sort data.csv > out.csv` still run.
- **Not blocked:** source code, where sample numbers are normal and the agent must be able to read them, and scripts run on data files (`node process.js data.csv`), which is how data gets processed without being shown to the model.
- List files that contain fake data (fixtures, seeders) in `.samaranignore`:

  ```gitignore
  test/fixtures/
  database/seeders/
  *.example.csv
  ```

- Set `SAMARAN_GUARD=off` to disable the guard.

#### In Codex CLI, Cursor, and Gemini CLI

The same guard works as a hook in other agents: `lokal-mcp guard` recognizes each agent's events and answers in its format. Install it once so the hook starts fast (`npx` on every file read is slow):

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

Codex asks you to review new hooks with `/hooks` before they run. It reads files through the shell, so `cat`, `sed -n`, and the like are what the guard checks.

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

Cursor's file reads cannot ask first, so a photo or scanned PDF that Claude Code would ask about is held back in Cursor; list it in `.samaranignore` if it holds no real data.

</details>

<details>
<summary><b>Gemini CLI</b> (experimental): <code>.gemini/settings.json</code></summary>

```json
{
  "hooks": {
    "BeforeAgent": [{ "hooks": [{ "type": "command", "command": "lokal-mcp guard" }] }],
    "BeforeTool": [{ "matcher": "read_file|run_shell_command", "hooks": [{ "type": "command", "command": "lokal-mcp guard" }] }]
  }
}
```

Hooks are experimental in Gemini CLI; turn them on as its documentation describes for your version.

</details>

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

`npm run eval:pii` runs the format benchmark on its own: 618 of 618 personal values masked across 418 formats, and 338 of 338 look-alikes left intact, with every match checked to sit exactly at its offsets. The formats range from KTP OCR, WhatsApp exports, Midtrans JSON, Laravel logs, HL7 messages, and SQL dumps to text with no labels at all: support tickets, e-mail signatures, bank statements, receipts, HTML forms, URLs, file names, chat in Sundanese and Javanese, and casual chat about health, genetics, debt, religion, marriage, and criminal records. The look-alikes include resi numbers, invoice IDs, timestamps, institutions, bank product names, places named after people, and words that are also given names. **The 100% is measured on cases the rules were tuned on.** Eight batches of cases were each written after the rules of the day and run once before any fix: they caught 40 of 49, 21 of 24, 59 of 90, 57 of 65, 48 of 57, 55 of 67, 46 of 55, and 51 of 61 values. On free text it has not seen, expect it to catch about 82 to 88% of personal values. Run over the official text of UU 27/2022 (64,000 characters), it masks only the President's name in the signature block.

This is a small sample built around everyday tasks for Indonesian developers. Do not read it as a general benchmark.

## Limitations

- **Detection is pattern-based and favors precision.** Names are found through labels, column headers and JSON keys, chat export senders, introductions ("nama saya budi", "a.n.", "nami abdi"), honorifics and titles ("Pak Joko", "Dr. Ir. H. Bambang"), roles ("Pelanggan Budi Santoso", "Tergugat Joko Susilo"), greetings and sign-offs, e-mail display names, social media handles, an age in brackets ("Kevin (19)"), attendance and contact lists, and a list of about 680 common Indonesian given and family names, Batak clan names, and Balinese, Chinese-Indonesian, and Javanese name patterns. On free text it has not seen it catches about 82 to 88% of personal values: a name that is also an everyday word and has no cue ("pesanan budi belum sampai"), a name the list does not know with nothing around it, sensitive data phrased in a new way, and children's data that is not marked as such can still slip through. Treat Samaran as a strong safety net, not a guarantee.
- **Tested for false positives** on 22.5 MB of open-source code and documentation: the name rules added no false detections there, and every new hit was a package author's real name. On the full text of UU 27/2022 only the signatory's name is masked. Of 91,599 kecamatan and desa names in the Kemendagri data, alone and in an address sentence, 0.15% still read as a person's name, mostly villages named after a Batak clan ("Pintu Pohan") or a person ("Jati Utomo"). Chat name detection catches 29 of 29 test sentences with names and flags 0 of 26 ordinary ones. The test sentences were written for the suite, so accuracy on real data may be lower.
- **Not every format is read.** PDFs are read when they have a text layer, as invoices, letters, statements, and forms from a browser, Word, or a PDF library do. Scanned pages, encrypted PDFs, legacy `.xls` and `.doc`, images (ID card photos, selfies), and archives are not scanned. `scan_pii` reports them as *not scanned*, never as clean, including scanned pages inside an otherwise readable PDF. The guard asks before `Read` sends such a PDF, or a photo that looks like someone's document, to the model; it cannot tell a KTP photo from any other picture, so it judges photos by name and folder. Files over 100 MB are reported too. For data files over 5 MB the guard checks the first 5 MB, and it reports spreadsheets, Word documents, and PDFs over 20 MB instead of parsing them, to stay within the hook's 10-second limit.
- **NIK and NPWP checks are structural.** They cannot confirm that a number is registered with Dukcapil or the tax office.
- **Carrier detection uses number prefixes,** which match the public allocation list, including the 2025 XLSmart merger. Indonesia has no mobile number portability yet (a case is pending at the Constitutional Court, 319/PUU-XXIV/2026), so prefixes are still reliable. Landline area codes cover 19 major cities.
- **The guard intercepts prompts, `Read`, `Grep`, and common shell readers.** A script that deliberately prints a data file, or something like `python -c "print(open(...).read())"`, cannot be caught every time. The `samaran` skill steers the agent away from that.
- **Holidays** exist only for years whose SKB has been published (2026, 2027). Other years return an error, not a guess.

## Roadmap

- [x] National holidays and *cuti bersama* per year
- [x] Postal codes for every village
- [x] UU PDP data categories and Excel support in Samaran
- [ ] **Kapan**: Indonesian time expressions (`besok abis maghrib`, `lusa jam 7an`, `tanggal muda`) with location-based prayer times
- [ ] **Warga**: consistent synthetic test data (NIK matching birth date and region, region-appropriate names)
- [x] `.docx` support in Samaran (text and tables)
- [x] Text-based PDF support in Samaran (page text, tables, form fields)
- [ ] OCR for scanned PDFs and ID card photos
- [ ] Free-text address parser → region codes
- [x] HTTP transport for ChatGPT and web-based agents
- [x] Python library (`lokal-id`) with the same results as TypeScript
- [ ] Locale packs for other countries (Malaysia, the Philippines, Vietnam)

Have an idea? [Open an issue](https://github.com/lokal-id/lokal/issues).

## Project structure

```text
packages/core       @lokal-id/core: logic and bundled data
packages/mcp        @lokal-id/mcp: MCP server and Samaran Guard
packages/extension  browser extension for ChatGPT, Claude, Gemini, and other AI chats
python/             lokal-id: the Python port, with parity tests against TypeScript
skills/             SKILL.md files for Claude, Codex, and other agents
hooks/              Claude Code hook (bundled, no dependencies)
evals/              end-to-end evaluation against real Claude Code sessions
.claude-plugin/     plugin and marketplace manifests
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

Releases are built from a tag by GitHub Actions and published with Trusted Publishing and provenance. `@lokal-id/core` and the Python package have no dependencies, and `@lokal-id/mcp` bundles its own, so installing Lokal pulls in no third-party packages. [SECURITY.md](SECURITY.md#how-releases-are-protected) describes how releases are protected and how to verify what you installed.

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
