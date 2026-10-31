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

### What Lokal is not

Samaran is a safety net, not a security boundary.

- **It misses some data.** Detection uses patterns, labels, and name lists. On free text it has never seen, about 12 to 18% of personal values slip through (see [Limitations](#limitations)).
- **It cannot read images.** Photos of ID cards and scanned PDFs are reported or asked about, never masked.
- **It protects only the paths that go through it.** A file your editor sends to the model on its own, or a script an agent writes that prints customer data, is not masked.
- **It does not make a system UU PDP compliant by itself.** It lowers the chance of an accidental leak; access control, data minimization, and agreements with model providers are still yours to arrange.

For data that must never reach a model provider, add the controls in [Defense in depth](#defense-in-depth).

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
- **Local and offline.** Data ships with the package. No network calls, no telemetry, and unmasking happens on your machine. A test runs every MCP tool, the guard, the scanner, and the Python library with network access blocked, and fails on any attempt.

## How it works

<p align="center">
  <a href="docs/assets/architecture.svg"><img src="docs/assets/architecture.svg" alt="Lokal architecture: the developer prompts an AI agent on their machine. Skills give the agent Indonesian conventions, Samaran Guard checks prompts and file reads, and the Lokal MCP server looks up reference data and reads and writes project files through Samaran, which masks and restores personal data. Only masked context goes to the LLM provider." width="100%"></a>
</p>

When the agent needs to look at customer data, it calls `read_file_masked` and sees `[NAME_1], [NIK_1], [PHONE_1]` instead of the real values. It can still deduplicate, join, and debug, because the same value always gets the same placeholder. When it writes results with `write_file_unmasked`, Samaran puts the real values back, on your machine.

## Quick start

New to Lokal? The [5-minute quickstart](docs/quickstart.md) walks through scanning, Kembaran, the agent tools, and the proxy with made-up sample data.

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

listWilayah('32.76');                    // districts (kecamatan) of Kota Depok
searchWilayah('kab. bogor')[0].code;     // '32.01'
findByPostalCode('16431');               // villages that use this postal code
parseAlamat('jl margonda raya no 100 rt 3/5 kemiri muka beji depok 16423');
// { street: 'jl margonda raya no 100', rt: '003', rw: '005', postalCode: '16423',
//   kelurahanDesa: { code: '32.76.06.1004', name: 'Kemiri Muka', … }, kecamatan: { name: 'Beji', … },
//   kabupatenKota: { name: 'Kota Depok', … }, provinsi: { name: 'Jawa Barat', … }, confidence: 'high', issues: [] }

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
- **Your own data types.** For formats Samaran cannot know, such as an employee ID or a member-number column, add rules to `.samaran.json` at the project root. The MCP server, the guard, `lokal-mcp scan`, the proxy, and `lokal.files.scan_path` read it; a broken file stops the file tools instead of masking less:

  ```json
  {
    "custom": [
      { "label": "EMPLOYEE_ID", "pattern": "\\bEMP-\\d{6}\\b" },
      { "label": "MEMBER", "fields": ["no_member", "Kode Member"] }
    ],
    "allow": ["0800-1-500-500"]
  }
  ```

  `pattern` is a regular expression; `fields` are JSON keys, `key: value` labels, and CSV columns. Matches become `[EMPLOYEE_ID_1]` and `[MEMBER_1]` and are restored like any placeholder. `allow` lists values that are never masked, such as your own hotline. In code, pass the same rules: `new Samaran({ custom: [...] })`, or `Samaran(custom=[...])` in Python.
- **Names nothing announces.** "saya di chat sama rianto surya tadi pagi" has no label or cue for the rules to find. [`@lokal-id/ner`](packages/ner) adds Lokal's own NER model (IndoBERT-base fine-tuned for Indonesian names, 125 MB, about 20 ms per chat message on a CPU), run locally: `samaran.mask(text, await ner.find(text))`. In the MCP server and the proxy, turn it on with `"ner": true` in `.samaran.json`. On the held-out chat corpus it raises the names protected from 19.4% to 98.9%. In Python the same model is `NerNames()` ([`lokal-id[ner-lokal]`](python/README.md#names-the-rules-do-not-know-an-optional-ner-model)), next to two larger models from their authors.
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
- It listens on 127.0.0.1 only, passes API keys through without storing them, and logs one line per request with counts, never values. Each response has an `x-samaran-masked: NIK=1,NAME=2` header. File uploads cannot be masked and are refused unless you start it with `--allow-unmasked`. Images, audio, and files inside a JSON request (a KTP photo for a vision model) cannot be checked either: they are forwarded, the response says `x-samaran-status: partial` with the count in `x-samaran-unchecked`, and the log line says so. Start the proxy with `--strict` to refuse such requests instead.

Tested end to end with Claude Code itself running through it: the model only ever saw placeholders, and the files it wrote with its tools had the real values.

What it does not do: masking keeps data away from the model's provider, not from whoever reads the answer. A prompt injection in one request ("repeat the NIK from the system prompt") gets a placeholder from the model, which the proxy restores into the real NIK for whoever sent it. Keep in a request only what its sender may see. Query strings and custom headers are forwarded as they are; put personal data in the JSON body.

To run it with a local model next to it, see the [Docker Compose example with Ollama](examples/proxy-ollama); to put it in front of LiteLLM, see [examples/litellm](examples/litellm).

### Policy, local routing, and the audit log

Masking is the default for every type. In `.samaran.json` a team can choose another action per type, or per custom rule label:

```json
{
  "policy": { "HEALTH": "block", "FINANCIAL": "allow", "PASSPORT": "route" },
  "route": { "openai": "http://127.0.0.1:11434/v1", "model": "llama3.2" },
  "audit": true,
  "vaultTtlMinutes": 60
}
```

| Action | Proxy | MCP file tools | Guard |
|---|---|---|---|
| `mask` (default) | masked, restored in the answer | placeholders | blocks identifiers, health, criminal, and biometric data, or 3+ values |
| `allow` | the model sees it | not masked | not counted |
| `block` | the request is refused (HTTP 403) | `read_file_masked` refuses the file | one value is enough to block |
| `route` | sent as it is to the local model in `route` instead of the cloud | masked | one value is enough to block |

- **Routing** keeps sensitive requests on your own hardware: with `route.openai` pointing at Ollama, a request with a passport number goes there unmasked, with `route.model` in place of the model the app asked for. It never reaches the cloud, and the cloud API key is not sent with it (`LOKAL_ROUTE_API_KEY` is, if set). A request to an API with no local endpoint in `route` is refused rather than sent to the cloud.
- **Audit log**: `"audit": true` appends one JSON line per decision to `.lokal/audit.jsonl` (or a path you give): the source (proxy, MCP, guard), the action (masked, blocked, routed, refused, restored, anonymized, forgot), the file or API path, and counts per type, never a value. Lokal creates `.lokal/` with a `.gitignore`. `lokal-mcp audit [--since 7d] [--json]` summarizes it.
- **Vault**: the MCP server forgets every real value behind its placeholders after `vaultTtlMinutes` without use (or `LOKAL_VAULT_TTL_MINUTES`), and on the `clear_vault` tool.
- **Strict guard for everyone**: `"guard": "strict"` makes the guard block what it cannot check for whoever works in the repository, as `SAMARAN_GUARD=strict` does on one machine. A repository can only make the guard stricter; `SAMARAN_GUARD=off` on your own machine still turns it off.
- `lokal-mcp scan` ignores the policy: what may reach a model and what may enter the repository are different questions.

**Set it up from a profile**, and check what a configuration does:

```console
$ npx @lokal-id/mcp init --profile team      # personal, team, or strict; --dry-run shows the files first
$ npx @lokal-id/mcp check
guard           default (asks about what it cannot check)
policy          everything is masked
audit log       .lokal/audit.jsonl
vault           forgotten after 60 min without use
```

| Profile | `.samaran.json` | Also writes |
|---|---|---|
| `personal` | vault forgotten after 2 hours | `.samaranignore` |
| `team` | audit log, 1-hour vault | `.samaranignore`, a GitHub workflow that fails pull requests with personal data |
| `strict` | strict guard, health, criminal, and biometric data blocked, audit log, 30-minute vault | the same, with the workflow's `strict` input on |

`init` never replaces a file that is there, except `.samaran.json` with `--force`. `check` validates the file and warns about settings worth a second look: an identity number the model may see, a `route` endpoint that is not on this machine or a private network, an audit log inside the project, or a `.samaranignore` pattern that skips every CSV.

[What stays on your machine, and what can reach the network](docs/network.md) lists every connection each part makes.

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
- The files of one run are read together first. A value found in one, such as a phone number in the `pelanggan` table, is replaced wherever else it appears, even where nothing labels it: a foreign key in `pesanan`, or a name in a notes column of a CSV export. No stand-in is the real value of anyone else in the data. The output is then checked for the real identity numbers, phone numbers, e-mail addresses, and full names, and the command warns if any is left.
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

It runs on ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok, and Le Chat, in Chrome, Edge, and other Chromium browsers. It is not in the Chrome Web Store yet: download `lokal-extension-<version>.zip` from the [latest release](https://github.com/lokal-id/lokal/releases/latest), unzip it, and load the folder with **Load unpacked** (see [packages/extension](packages/extension/README.md), which also lists its limitations). Attached CSV, Excel, Word, and text-based PDF files are masked too. What it cannot check (a photo named like a KTP or selfie, a scanned or password-protected PDF, a file over 20 MB) is held, and goes out only if you say so.

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
      - uses: lokal-id/lokal@v0.17.0
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
        additional_dependencies: ['@lokal-id/mcp@0.17.0']
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
| `parse_alamat` | Free-text address → street, RT/RW, kode pos, and the kelurahan, kecamatan, kota, and provinsi with their codes; flags a kode pos that does not match |
| `list_holidays` | National holidays and *cuti bersama* (SKB 2026, 2027) |
| `working_days` | Business days, SLA due dates, delivery estimates |
| `parse_qris` | Read and check a QRIS payload: merchant, NMID, criteria, amount, CRC |
| `set_qris_amount` | Make a merchant's QRIS dynamic for an amount, with a new CRC |
| `scan_pii` | Scan files and folders (text, CSV, JSON, logs, SQL, `.xlsx`, `.docx`, text-based PDF, up to 100 MB each) for personal data. Shows partially masked values only, and **reports files and pages it could not scan** (scanned or encrypted PDFs, `.xls`, `.doc`, images) |
| `read_file_masked` | Read a file, including `.xlsx` sheets, `.docx` documents (text and tables), and PDFs (page text, tables, and filled-in form fields), with personal data replaced by stable placeholders |
| `write_file_unmasked` | Write results with placeholders restored, on your machine |
| `anonymize_file` | Copy dumps and exports with realistic stand-ins for every person (Kembaran), returning only counts |
| `clear_vault` | Forget every real value behind this session's placeholders |

The data tools also work on masked data. `parse_alamat`, `parse_nik`, `parse_phone`, and `validate_npwp` take a placeholder from `read_file_masked`, such as `[ADDRESS_3]` or `[NIK_1]`, and read the real value on your machine. The model gets the kelurahan, kecamatan, kota, and their codes, or whether a NIK or number is valid; the street, RT/RW, and birth date come back as new placeholders, which `write_file_unmasked` restores. An agent can clean a customer address column without seeing any address.

### Samaran Guard

Enabled automatically by the Claude Code plugin.

- **Prompts** containing ID numbers (NIK, KK, NPWP, passport, SIM, NIP, NISN, civil registry deed, bank account, BPJS, card) or labeled health, criminal, or biometric data are held before they are sent. Add `#izinkan-pii` to send anyway.
- **Reads of data files** (CSV, Excel, JSON, logs, SQL dumps, YAML, …) that contain personal data are blocked, and Claude is pointed to `read_file_masked`. This covers the `Read` tool, `Grep` in content mode, and shell commands such as `cat`, `head`, `grep`, `sed -n`, `awk`, `cut`, `diff`, `base64`, `perl -pe`, `sqlite3 ".import …"`, `curl file://`, `Get-Content`, and `Import-Csv | Select-Object`. The guard follows the command the way the shell runs it: `cd data && cat x.csv` and `(cd data && cat x.csv)`, variables (`F=x.csv; cat "$F"`, `$f = "x.csv"; gc $f`), `for f in *.csv`, `while read … done < x.csv`, copies (`cp x.csv /tmp/y && cat /tmp/y`, `head x.csv > y; cat y`), `ls | xargs cat`, `$(cat x.csv)`, `bash -c "…"`, `cmd /c type …`, and shell scripts it runs (`bash show.sh`, `source show.sh`).
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
- Set `SAMARAN_GUARD=strict` for teams that want it to fail closed: what the guard cannot check is blocked instead of let through or asked about. That covers:
  - a guard error, such as a broken `.samaran.json`;
  - a file it cannot read, such as a scanned, encrypted, or damaged PDF or a damaged spreadsheet;
  - the photos and PDFs it would otherwise ask about;
  - output from beyond the first 5 MB of a big file, such as `cat`, `tail`, `grep`, or `Read` with an offset past that point (`head -n 50` still runs);
  - a `Grep` over more than 300 data files;
  - a check that runs longer than 7 seconds, before the hook's 10-second limit would let the call through.

  Code run from the command line that names a data file with personal data is blocked like `cat`: `python -c "…open('data.csv')…"`, `node -e`, a heredoc fed to `python3 -`, and `[IO.File]::ReadAllText` in PowerShell. So is a script an interpreter runs with its output on the screen when its code names such a file (`python report.py`, or a script a heredoc wrote a moment before). A script whose output goes to a file (`python clean.py > bersih.csv`), or that gets the data file as an argument (`python clean.py data.csv`), still runs.

  What the guard does not follow, in either mode: **database queries** (`psql`, `mysql`, `sqlite3 app.db "select …"`, `docker exec … psql`, `prisma db execute`), **calls to APIs** (`curl https://…`), a program that reads a file by a name built at run time, a file read by a tool other than the shell (another MCP server), and code that prints data it got some other way. Data in a database or behind an API never passes through a file the guard can check. Keep agents on a database with fake or anonymized data (`lokal-mcp kembaran`), or give them a read-only account without the personal columns. The guard is a safety net for the common ways an agent looks at a file; `read_file_masked` and the proxy are what keep data out of the model.

  Searches into folders (`grep -r`, `rg`, `ag`) are checked in up to 300 data files, as the Grep tool is. Files `write_file_unmasked` wrote are checked like data files whatever their extension (`docs/notes.md`, `src/fixtures.ts`): the server lists them in `.lokal/unmasked.json`, paths only, kept out of git.

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

### What each integration covers

Each integration sees only what passes through it. Choose by where the data goes, and combine them where it goes more than one way.

| Integration | Checks | Does not see | What it cannot check |
|---|---|---|---|
| **Claude Code** (plugin: MCP, skills, guard) | Prompts, `Read`, `Grep` in content mode, file readers in Bash and PowerShell | Other tools that return file contents, such as another MCP server; scripts that print data | Asked about; blocked with `strict` |
| **Codex CLI** (MCP, skills, guard hook) | Prompts, shell commands | Tools other than the shell | Let through; blocked with `strict` |
| **Cursor** (MCP, guard hooks) | Prompts, file reads, shell commands | Tools without a hook, such as its codebase search | Held back, since Cursor cannot ask |
| **Gemini CLI** (MCP, guard hooks, experimental) | Prompts, `read_file`, `run_shell_command` | Its other tools, such as reading several files at once or searching file contents | Held back, since Gemini CLI cannot ask |
| **Claude Desktop, Windsurf, VS Code, other MCP clients** | Files read through `read_file_masked` and `scan_pii` | Prompts and the client's own file reads: these clients have no hook | `read_file_masked` refuses it |
| **ChatGPT and Claude.ai connectors** (HTTP mode) | The data tools only; no file tools | What is typed or uploaded in the chat: use the extension | n/a |
| **Browser extension** | Pasted and typed text, attached CSV, Excel, Word, and text-based PDF files | Text dropped by drag and drop, `.samaran.json` rules | Held until you allow it; other photos go as they are |
| **Samaran Proxy** | Every text in OpenAI- and Anthropic-style requests, including tool calls and JSON inside strings | File uploads, which are refused unless `--allow-unmasked` | Forwarded with `x-samaran-status: partial`; refused with `--strict` |
| **AI SDK middleware** | System prompt, messages, tool calls and results | Images and files | Sent as they are |
| **Lokal Scan** (CLI, pre-commit, GitHub Action) | Staged changes, diffs, files and folders | Data that never reaches the repository | Reported as not scanned; fails with `--strict` |

The guard holds back any one identifier (NIK, KK, NPWP, passport, bank account, card, BPJS, …), labeled health, criminal-record, or biometric data, and a `.samaran.json` rule. It lets one ordinary value through, such as a single phone number or e-mail address in a `grep` result, and blocks three or more. `strict` does not change that rule; it changes what happens when the guard cannot check.

### Defense in depth

The guard catches the common ways an agent looks at data. It is not a sandbox: an agent that can run arbitrary code can find a way to print a file. When real customer data sits on a developer's machine, add controls that do not depend on catching it:

1. **Keep production data out of the workspace.** Give the agent a Kembaran copy (`anonymize_file` or `lokal-mcp kembaran`) instead of the real dump.
2. **Deny the folders that hold real data** in the agent's own permissions, for example in Claude Code's `.claude/settings.json`:

   ```json
   {
     "permissions": {
       "deny": ["Read(./data/production/**)", "Read(./storage/uploads/**)", "Bash(cat:./data/production/*)"]
     },
     "env": { "SAMARAN_GUARD": "strict" }
   }
   ```

3. **Run the agent in a container or sandbox** where production credentials and data are not mounted and outbound traffic goes only to the model provider.
4. **Stop data at the repository** with [Lokal Scan](#lokal-scan-keep-personal-data-out-of-the-repository) in CI and pre-commit.
5. **For apps that call an LLM**, send every call through the [proxy](#samaran-proxy-protect-an-apps-llm-calls) or the SDK, and keep raw prompts out of logs and error trackers.

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

### Leak tests

One made-up person with every kind of personal data Samaran knows ([`canary.json`](packages/core/test/canary.json)) is sent, as a form, JSON, a log line, CSV, and JSON inside JSON, through every way Lokal hands text on: the TypeScript and Python libraries, the AI SDK middleware, every MCP tool's result, the guard's messages, every API shape of the proxy (Chat Completions, streaming, tool calls, Responses, Messages), `lokal-mcp scan` in every output format, Kembaran, the Python logging filter, and a paste in the browser extension. A test fails if any value, or any part of the name or street, comes out. Writing these tests found four gaps, all fixed in this release: a CSV pasted after a sentence, labels after an escaped line break (`\n` in JSON), JSON inside a JSON string (a logged request body, a tool call's arguments), and a CSV header after a log prefix.

The guard lets one ordinary value through on purpose, such as a single phone number in a `grep` result, and blocks identifiers, health data, and three or more values. `SAMARAN_GUARD=strict` does not change that rule; it changes what happens when the guard cannot check.

### Held-out benchmark

`npm run bench` scores the detectors per type on 2,800 made-up documents that they were not tuned on: 70 templates and a pool of names apart from the development set, in eleven formats from forms and chat to JSON, logs, and OCR output, with at least 200 labelled values of every type ([method](evals/bench/README.md)). Corpus 2, before and after the fixes it led to (made on the development set only):

| | Precision | Recall | Protected | 95% interval |
|---|---|---|---|---|
| 0.8.3: all 6,160 values | 96.7% | 91.3% | 94.0% | 93.4–94.6% |
| 0.9.0: all 6,160 values | 99.8% | 95.8% | 96.6% | 96.1–97.0% |
| **0.17.0: all 6,160 values** | **99.8%** | **97.2%** | **97.3%** | 96.9–97.7% |
| 0.17.0, NIK (0.9.0: 88.1%) | | | 100% | 98.8–100% |
| 0.17.0, weakest: religion | | | 85.7% | 81.1–89.3% |
| 0.17.0, weakest: names | | | 93.6% | 92.4–94.6% |
| 0.13.0 with the optional NER model (Python): all values | 99.8% | 97.9% | 98.7% | 98.4–98.9% |
| 0.13.0 with the optional NER model (Python): names | | | 98.1% | 97.4–98.6% |
| 0.14.0 with the optional NER model (Python, `gold`): all values | 99.6% | 98.4% | 99.2% | 98.9–99.4% |
| 0.14.0 with the optional NER model (Python, `gold`): names | | | 99.6% | 99.3–99.8% |
| 0.17.0 with Lokal's NER model (`@lokal-id/ner`): all values | 99.5% | 98.9% | 99.0% | 98.7–99.2% |
| 0.17.0 with Lokal's NER model (`@lokal-id/ner`): names | | | 98.9% | 98.4–99.3% |

*Protected* means every letter and digit of the value was masked, by a detection of any type. The NER rows add [an optional model](python/README.md#names-the-rules-do-not-know-an-optional-ner-model) for names to the rules, with settings chosen on the development split; it found no false positive either, at a hundred to five hundred times the time. On real news, where public figures are named with no cue the rules know, the rules alone find about a fifth of the people (21.6% in the [idner-news-2k](https://github.com/khairunnisaor/idner-news-2k) test set); the `gold` model finds 96.1%, at 99.0% precision. In 2,277 articles crawled from 14 news sites in October 2026, the `fast` model found 90.6% of 2,250 quoted speakers (rules alone: 18.5%), and 95% of its detections in a sample of 300 were people. In chat, names rarely have a cue: on the held-out [chat corpus](evals/chat/README.md) the rules protect 19.4% of them, the `gold` model 89.3%, and Lokal's own model 98.9%, with no false positive ([model card](packages/ner/MODEL.md)). [The stress test](evals/stress) measures speed and bounds on large and hostile input. 0.12.0 reads a NIK that OCR misread ("3674O2 53097l0l22") from its label. The gaps left are names with no label or known name part around them, ways of stating a religion the rules do not know, and other OCR misreads ("AGAMA. ISLAM" without a colon). None of the 400 trap documents has a false positive. CI fails when a release scores lower than the last baseline.

`npm run eval:pii` runs the format benchmark on its own: 618 of 618 personal values masked across 418 formats, and 338 of 338 look-alikes left intact, with every match checked to sit exactly at its offsets. The formats range from KTP OCR, WhatsApp exports, Midtrans JSON, Laravel logs, HL7 messages, and SQL dumps to text with no labels at all: support tickets, e-mail signatures, bank statements, receipts, HTML forms, URLs, file names, chat in Sundanese and Javanese, and casual chat about health, genetics, debt, religion, marriage, and criminal records. The look-alikes include resi numbers, invoice IDs, timestamps, institutions, bank product names, places named after people, and words that are also given names. **The 100% is measured on cases the rules were tuned on.** Eight batches of cases were each written after the rules of the day and run once before any fix: they caught 40 of 49, 21 of 24, 59 of 90, 57 of 65, 48 of 57, 55 of 67, 46 of 55, and 51 of 61 values. On free text it has not seen, expect it to catch about 82 to 88% of personal values. Run over the official text of UU 27/2022 (64,000 characters), it masks only the President's name in the signature block.

This is a small sample built around everyday tasks for Indonesian developers. Do not read it as a general benchmark.

## Limitations

- **Detection is pattern-based and favors precision.** Names are found through labels, column headers and JSON keys, chat export senders, introductions ("nama saya budi", "a.n.", "nami abdi"), honorifics and titles ("Pak Joko", "Dr. Ir. H. Bambang"), roles ("Pelanggan Budi Santoso", "Tergugat Joko Susilo"), greetings and sign-offs, e-mail display names, social media handles, an age in brackets ("Kevin (19)"), attendance and contact lists, and a list of about 680 common Indonesian given and family names, Batak clan names, and Balinese, Chinese-Indonesian, and Javanese name patterns. On free text it has not seen it catches about 82 to 88% of personal values: a name that is also an everyday word and has no cue ("pesanan budi belum sampai"), a name the list does not know with nothing around it, sensitive data phrased in a new way, and children's data that is not marked as such can still slip through. Treat Samaran as a strong safety net, not a guarantee.
- **Tested for false positives** on 22.5 MB of open-source code and documentation: the name rules added no false detections there, and every new hit was a package author's real name. On the full text of UU 27/2022 only the signatory's name is masked. Of 91,599 kecamatan and desa names in the Kemendagri data, alone and in an address sentence, 0.15% still read as a person's name, mostly villages named after a Batak clan ("Pintu Pohan") or a person ("Jati Utomo"). Chat name detection catches 29 of 29 test sentences with names and flags 0 of 26 ordinary ones. The test sentences were written for the suite, so accuracy on real data may be lower.
- **Not every format is read.** PDFs are read when they have a text layer, as invoices, letters, statements, and forms from a browser, Word, or a PDF library do. Scanned pages, encrypted PDFs, legacy `.xls` and `.doc`, images (ID card photos, selfies), and archives are not scanned. `scan_pii` reports them as *not scanned*, never as clean, including scanned pages inside an otherwise readable PDF. Every integration uses the same four states for what it saw: `scanned`, `partial` (scanned pages in a PDF, an image in a proxied request), `unsupported` (a kind of input Lokal does not read), and `failed` (a supported kind that could not be read, such as an encrypted PDF). The guard asks before `Read` sends such a PDF, or a photo that looks like someone's document, to the model; it cannot tell a KTP photo from any other picture, so it judges photos by name and folder. Files over 100 MB are reported too. For data files over 5 MB the guard checks the first 5 MB, and asks before `Read` shows lines past them. It reports spreadsheets, Word documents, and PDFs over 20 MB instead of parsing them, to stay within the hook's 10-second limit.
- **NIK and NPWP checks are structural.** They cannot confirm that a number is registered with Dukcapil or the tax office.
- **Carrier detection uses number prefixes,** which match the public allocation list, including the 2025 XLSmart merger. Indonesia has no mobile number portability yet (a case is pending at the Constitutional Court, 319/PUU-XXIV/2026), so prefixes are still reliable. Landline area codes cover 19 major cities.
- **The guard intercepts prompts, `Read`, `Grep`, and common shell readers.** A script that deliberately prints a data file, or something like `python -c "print(open(...).read())"`, cannot be caught every time. The `samaran` skill steers the agent away from that, `SAMARAN_GUARD=strict` blocks such one-liners, and [Defense in depth](#defense-in-depth) covers the rest.
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
- [x] Free-text address parser → region codes
- [x] HTTP transport for ChatGPT and web-based agents
- [x] Python library (`lokal-id`) with the same results as TypeScript
- [ ] Locale packs for other countries (Malaysia, the Philippines, Vietnam)

Have an idea? [Open an issue](https://github.com/lokal-id/lokal/issues).

## Project structure

```text
packages/core       @lokal-id/core: logic and bundled data
packages/mcp        @lokal-id/mcp: MCP server and Samaran Guard
packages/ner        @lokal-id/ner: Lokal's NER model for names, in WebAssembly
packages/extension  browser extension for ChatGPT, Claude, Gemini, and other AI chats
docs/               quickstart, network page, and images
examples/           sample data, Docker Compose with Ollama, LiteLLM
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
| NER model (`@lokal-id/ner`, downloaded on first use) | Lokal's fine-tuning of [IndoBERT-base](https://huggingface.co/indobenchmark/indobert-base-p1) on [IndoNLU](https://github.com/IndoNLP/indonlu)'s NERP and NERGrit, [idner-news-2k](https://github.com/khairunnisaor/idner-news-2k), and Lokal's own data; see the [model card](packages/ner/MODEL.md) | MIT |
| Holidays and *cuti bersama* | SKB 3 Menteri via [setneg.go.id](https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026) | Public government document |

Region totals match the Kemendagri decree exactly and were last checked in October 2026; see [`packages/core/data/README.md`](packages/core/data/README.md) to regenerate them. Every holiday date is tested against the weekday in the official announcement. The UU PDP summary in the skills was checked against the official text of UU 27/2022.

## Acknowledgements

- [cahyadsn](https://github.com/cahyadsn) for maintaining open Indonesian region and postal code data.
- [Model Context Protocol](https://modelcontextprotocol.io) and [Agent Skills](https://agentskills.io) for open standards that let one toolkit work across agents.
