# @lokal-id/mcp

[![npm](https://img.shields.io/npm/v/@lokal-id/mcp?color=cb3837)](https://www.npmjs.com/package/@lokal-id/mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/lokal-id/lokal/blob/HEAD/LICENSE)

An MCP server that makes AI agents Indonesia-ready: accurate Kemendagri region and postal code data, holidays and working days, NIK/NPWP/phone validation, Rupiah, and **Samaran**, which lets an agent read production files (CSV, Excel, logs) with Indonesian personal data replaced by stable placeholders, then write results with the real values restored, locally.

Part of [Lokal](https://github.com/lokal-id/lokal) · [Bahasa Indonesia](https://github.com/lokal-id/lokal/blob/HEAD/README.id.md)

## Install

**Claude Code:** install the Lokal plugin, which bundles this server with the skills and the Samaran Guard hook:

```text
/plugin marketplace add lokal-id/lokal
/plugin install lokal@lokal
```

**Cursor, Claude Desktop, Windsurf** (`.cursor/mcp.json`, `claude_desktop_config.json`, `~/.codeium/windsurf/mcp_config.json`):

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

**VS Code** (`.vscode/mcp.json`):

```json
{ "servers": { "lokal": { "type": "stdio", "command": "npx", "args": ["-y", "@lokal-id/mcp"] } } }
```

**Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.lokal]
command = "npx"
args = ["-y", "@lokal-id/mcp"]
```

The file tools can only access `LOKAL_ROOT`, which defaults to `CLAUDE_PROJECT_DIR` and then to the working directory.

## Tools

| Tool | What it does |
|---|---|
| `parse_nik` | Validate and decode a NIK: region, date of birth, sex |
| `validate_npwp` | 15-digit NPWP, 16-digit NPWP, or NIK as NPWP |
| `parse_phone` | Normalize numbers, display format, WhatsApp link, carrier |
| `parse_qris` | Read and check a QRIS payload: merchant, NMID, criteria, amount, CRC |
| `set_qris_amount` | Make a merchant's QRIS dynamic for an amount, with a new CRC |
| `format_rupiah` / `parse_rupiah` | `Rp1.500.000`, *terbilang*; "2jtan", "goceng" → numbers |
| `search_wilayah` / `list_wilayah` | Provinces down to villages, with codes and postal codes |
| `lookup_kode_pos` | Postal code → villages, or all postal codes in a region |
| `parse_alamat` | Free-text address → street, RT/RW, kode pos, and Kemendagri regions with their codes |
| `list_holidays` / `working_days` | National holidays and *cuti bersama* (SKB 2026, 2027), SLA due dates |
| `scan_pii` | Scan files and folders for personal data by UU PDP category; reports files it could not scan |
| `read_file_masked` | Read a file (text, CSV, JSON, logs, `.xlsx`, `.docx`, text-based PDF) with personal data replaced by placeholders |
| `write_file_unmasked` | Write results with placeholders restored, on your machine |
| `anonymize_file` | Copy dumps and exports with realistic stand-ins for every person (Kembaran), returning only counts |

`parse_alamat`, `parse_nik`, `parse_phone`, and `validate_npwp` also take placeholders from `read_file_masked` (`[ADDRESS_3]`, `[NIK_1]`): the real value is read on your machine, and the street, RT/RW, and birth date come back as placeholders.

## Samaran Guard

`lokal-mcp guard` is a hook for Claude Code (`UserPromptSubmit`, and `PreToolUse` for `Read|Grep|Bash|PowerShell`), Codex CLI, Cursor, and Gemini CLI. It holds prompts that contain NIK, bank account, or health data, blocks commands that would print a personal data file into the conversation, pointing the agent to `read_file_masked` instead, and asks before photos of documents and scanned PDFs are read. The Lokal plugin sets it up for Claude Code; see the [Lokal README](https://github.com/lokal-id/lokal#in-codex-cli-cursor-and-gemini-cli) for the other agents.

## Kembaran

`lokal-mcp kembaran prod.sql export.csv -o staging/ [--secret <text>] [--keep FINANCIAL] [--keep-birth-date]` copies text files with every person replaced by a realistic stand-in, consistent across the files. See the [Lokal README](https://github.com/lokal-id/lokal#kembaran-production-data-for-staging-without-real-people).

## Lokal Scan

`lokal-mcp scan --staged` (pre-commit) or `lokal-mcp scan --diff origin/main` (CI) fails when a commit or pull request adds Indonesian personal data, and shows each value partially masked. `lokal-mcp scan [path…]` checks whole files. There is a GitHub Action too: `uses: lokal-id/lokal@v0.7.0`. See the [Lokal README](https://github.com/lokal-id/lokal#lokal-scan-keep-personal-data-out-of-the-repository).

## Remote (HTTP) mode

`lokal-mcp serve --http --port 3000` serves the data tools over Streamable HTTP at `/mcp`, for ChatGPT and Claude.ai connectors. The file tools are not available in this mode.

## Samaran Proxy

`lokal-mcp proxy` is an OpenAI- and Anthropic-compatible endpoint for apps: it masks Indonesian personal data in every request and restores it in the response, streaming and tool calls included.

```sh
npx @lokal-id/mcp proxy --port 8787 [--openai <url>] [--anthropic <url>] [--exclude FINANCIAL]
```

Then use `OpenAI(base_url="http://127.0.0.1:8787/v1")` or `Anthropic(base_url="http://127.0.0.1:8787")`. See the [Lokal README](https://github.com/lokal-id/lokal#samaran-proxy-protect-an-apps-llm-calls).

## License

[MIT](https://github.com/lokal-id/lokal/blob/HEAD/LICENSE). The library is [`@lokal-id/core`](https://www.npmjs.com/package/@lokal-id/core).
