---
name: samaran
description: Keep Indonesian personal data — NIK, KK, NPWP, phone, bank account, BPJS, passport, names, addresses, birth dates, and UU PDP sensitive data (health, finances, religion, criminal records, biometrics) — out of the model and out of third-party APIs. Use when reading or debugging with real data (production logs, CSV/Excel exports, database dumps, support tickets, seeders copied from production, copying production data to staging) and when building features that send user text to an LLM (chatbots, summarizers, ticket triage, CS automation) or that log or display personal data.
---

# Samaran: work with personal data without seeing it

"Samaran" means disguise. Two jobs: protect the data in this session, and build apps that protect it by default.

## 1. In this session: read data through the mask

Anything you read is sent to the model provider. When a file may contain real personal data:

1. Run `scan_pii` on the file or folder first. It reports what kinds of data are where, with values partially masked, and lists files and pages it **could not scan** (scanned or encrypted PDFs, old `.xls`, images, archives). Tell the user about those; never treat them as clean.
2. Read with `read_file_masked` — never with a plain file read, and never with `cat`, `head`, `tail`, `type`, `Get-Content`, `less`, `grep` or a script that prints the rows. Personal data comes back as stable placeholders: `[NIK_1]`, `[PHONE_3]`, `[RELIGION_1]`, `[HEALTH_2]`. The same value always gets the same placeholder in a session, so you can still deduplicate, join, group, count, and debug. `.xlsx` files come back as CSV, one block per sheet; PDFs as text, one block per page.
3. Do the work on placeholders. Do not try to guess the real values, and do not ask the user to paste them.
4. When output must contain the real values (a cleaned CSV, a fixed migration, a report), write it with `write_file_unmasked`: it restores the placeholders on the user's machine.
5. If the user pastes real personal data into the chat, finish the task without repeating it back, and suggest masking or test data next time.

Counting and aggregating without reading rows is fine: `wc -l`, `grep -c ERROR app.log`, `grep -o 'err="[A-Za-z]*' app.log | sort | uniq -c`, `cut -d, -f5 data.csv | sort | uniq -c` on a non-personal column. So is running a script that reads the real file and writes its results to a file. The Samaran guard hook (Claude Code) blocks commands whose output would contain personal data; when it does, switch to `read_file_masked` instead of looking for another way to print the file. Photos of documents (KTP, selfies) and scanned PDFs cannot be masked: do not open them unless the task needs it and the user agrees, and if the guard's permission prompt is declined, do not try another way to view the file.

**Databases.** There is no masked database tool. Do not run queries that return personal columns. Prefer queries that return counts, aggregates, IDs, or non-personal columns; when rows with personal data are truly needed, ask the user to export them to CSV/XLSX and read that file with `read_file_masked`.

Files that only hold fake data (fixtures, seeders) can be listed in `.samaranignore` at the project root.

If the `lokal` MCP server is not connected, say so and ask the user for a masked or synthetic sample instead of the raw file.

## 2. In the code you write: privacy by default

### Before calling an LLM API with user text

```ts
import { Samaran } from '@lokal-id/core';

export async function answerCustomer(message: string) {
  const samaran = new Samaran();               // one vault per conversation or request
  const { text } = samaran.mask(message);      // "NIK saya [NIK_1], HP [PHONE_1]"
  const reply = await llm.complete({ system: SYSTEM_PROMPT, user: text });
  return samaran.unmask(reply);                // real values restored for the customer
}
```

- Mask the conversation history too, with the same instance, so placeholders stay consistent across turns.
- Tell the model in the system prompt that `[TYPE_n]` tokens are redacted values it must keep exactly as they are.
- Keep the vault (`exportVault()`) in memory or in your own database next to the conversation. Never send it to the LLM, and never write it to logs.
- A domain app may need some types unmasked (a clinic bot needs symptoms): pass `types` to mask only what the feature does not need, and document why.

### Logs, analytics, error tracking, and admin screens

```ts
import { maskPii } from '@lokal-id/core';

logger.info(maskPii(rawMessage, { mode: 'partial' }).text);
// "NIK 3201********0001 HP 0812****7890"
```

- Apply this in the logger itself (a formatter or middleware) and in the error tracker's `beforeSend`, not at every call site.
- Admin tables show partially masked NIK, phone, and account numbers, with an explicit "lihat" action that is audited.

### Test data

Use synthetic data in fixtures and seeders. Do not copy production rows. When staging, a seeder, or a vendor needs data shaped like production, make it with the `anonymize_file` tool (Kembaran): it copies a dump or export with every person replaced by a realistic stand-in (a valid NIK in the same district, a phone on the same operator), consistent across files, and you only see counts. In code, `@lokal-id/core/kembaran` and `python -m lokal.kembaran` do the same, for example in a staging refresh job. Run `scan_pii` on `test/`, `fixtures/`, and `seed*` before committing.

## What Samaran detects

- **Identifiers:** NIK (structure-validated), KK, NPWP, passport, SIM, NIP, BPJS, NISN (student number, children's data), birth/marriage/death certificate numbers, phone, email, bank account, card (Luhn), plate, IP address, coordinates.
- **Who and where:** names (after labels like "Nama:" and "a.n.", honorifics and titles like "Pak/Bu" and "Dr.", roles like "Pelanggan Budi", greetings, sign-offs, e-mail display names, social media handles, name columns, and common Indonesian given, family, and clan names on their own), addresses (street, housing estate, apartment, or village with house number, unit, or RT/RW, address fields), birth date and place.
- **UU PDP categories:** gender, religion, marital status, nationality (data pribadi umum); health, personal finances, criminal records, biometrics (data pribadi spesifik).

It reads labeled text ("Agama: Islam"), CSV/XLSX columns by header (`agama`, `diagnosa`, `gaji`, `pasien` …), JSON/YAML keys, and common free-text phrasing ("didiagnosis TBC", "gaji saya 8 juta", "beragama Katolik").

## Limits

Detection is pattern-based and favors precision. On free text it has not seen, it catches about 82 to 88% of personal values. A name with no cue that is also an everyday word or is not a common Indonesian name, health or financial details phrased in a new way, children's data that is not marked as such, and anything inside images or PDFs can slip through. Treat Samaran as a strong safety net, not a guarantee.
