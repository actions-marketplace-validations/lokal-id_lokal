# Quickstart: Lokal in 5 minutes

[Bahasa Indonesia](quickstart.id.md)

You need Node.js 20 or newer. Every name, NIK, and phone number in the sample data is made up.

```sh
git clone --depth 1 https://github.com/lokal-id/lokal
cd lokal/examples/quickstart
```

The folder holds two files: `pelanggan.csv`, a customer export, and `tiket.log`, a support log.

## 1. Find the personal data (30 seconds)

```console
$ npx @lokal-id/mcp scan .
pelanggan.csv:2: NAME K*** P***
pelanggan.csv:2: NIK 3201********0001
pelanggan.csv:2: PHONE 0812****7890
…
tiket.log:2: BANK_ACCOUNT ************7890 (UU PDP: spesifik)

Found 30 personal data value(s) in 2 file(s).
```

Values are shown partly masked, and nothing leaves your machine. In a repository, `scan --staged` checks only what you are about to commit.

## 2. Make a copy for staging (1 minute)

```console
$ npx @lokal-id/mcp kembaran pelanggan.csv tiket.log --dry-run
pelanggan.csv: would replace NAME=5, NIK=5, PHONE=5, EMAIL=5, ADDRESS=5, HEALTH=1, BANK_ACCOUNT=1
tiket.log: would replace NIK=2, PHONE=1, BANK_ACCOUNT=1
Dry run: nothing was written.

$ npx @lokal-id/mcp kembaran pelanggan.csv tiket.log -o staging/
```

`staging/` now holds made-up people who look real: valid NIKs in the same district, phone numbers on the same operator. The same customer gets the same stand-in in both files, so the data still joins.

## 3. Set up the project (30 seconds)

```console
$ npx @lokal-id/mcp init --profile team
  .samaran.json                wrote
  .samaranignore               wrote
  .github/workflows/pii.yml    wrote

$ npx @lokal-id/mcp check
```

Profiles:

- `personal` sets up the config and ignore file.
- `team` adds an audit log and a GitHub workflow that fails pull requests with personal data.
- `strict` adds a guard that blocks whatever it cannot check, and refuses health, criminal, and biometric data even masked.

`init --dry-run` shows the files without writing them. `check` explains what the configuration does and warns about risky settings.

## 4. Let an agent work with the data (2 minutes)

In Claude Code, inside `examples/quickstart`:

```text
/plugin marketplace add lokal-id/lokal
/plugin install lokal@lokal
```

Then ask: *"Which customers have a complaint? Write the list to keluhan.csv with their phone numbers."*

- Samaran Guard stops Claude from reading `pelanggan.csv` raw and points it to `read_file_masked`.
- Claude sees `[NAME_2]`, `[PHONE_2]`, and `[NIK_2]`, never the values.
- `write_file_unmasked` writes `keluhan.csv` with the real phone numbers on your machine.
- With the `team` profile, `npx @lokal-id/mcp audit` then shows what was masked and restored, as counts only.

For Cursor, Codex CLI, Gemini CLI, and VS Code, see the [Quick start in the README](../README.md#quick-start).

## 5. Protect an app's LLM calls (1 minute)

```sh
npx @lokal-id/mcp proxy          # http://127.0.0.1:8787
```

Point an OpenAI or Anthropic client at it (`base_url="http://127.0.0.1:8787/v1"`). Requests reach the provider masked, and answers come back with the real values. To keep health data on a local model, see the [Docker Compose example with Ollama](../examples/proxy-ollama).

## Next

- [What stays on your machine, and what can reach the network](network.md)
- [Policy, local routing, and the audit log](../README.md#policy-local-routing-and-the-audit-log)
- [What each integration covers](../README.md#what-each-integration-covers), and what it does not see
