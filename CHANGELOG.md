# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.16.0] - 2026-10-31

### Added

- Lokal's own NER model in Python: `NerNames(model='lokal')`, the same `lokal-ner-base-v1` as `@lokal-id/ner`, run with onnxruntime and a WordPiece tokenizer of Lokal's own (checked against Hugging Face's on 5,689 texts and against the Node one by parity vectors). `pip install "lokal-id[ner-lokal]"` installs only onnxruntime, without transformers or PyTorch; the model (125 MB) is downloaded once from the GitHub release, checked against its SHA-256, and cached in the folder the Node package uses. About 5 ms per short document on a laptop CPU. `download_model()` fetches it ahead of time.

### Changed

- `NerNames()` loads `'lokal'` by default (it was `'gold'`). On the held-out chat corpus it protects 98.9% of the names (`gold`: 89.3%), at a tenth of the size; `gold` stays the better choice for news (96.1% of the people in idner-news-2k, against 93.4%). Pass `model='gold'` for the earlier default.
- The NER extras need Python 3.11 or later, as onnxruntime and PyTorch do. The rest of `lokal-id` still runs on 3.10.
- Python dependencies are locked only once they are two weeks old (`exclude-newer = "2 weeks"` in `pyproject.toml`). The lock had picked up newer releases of PyTorch, transformers, and huggingface-hub; they are back to the last ones that are two weeks old.

### Fixed

- Lokal's NER model could leave part of a name unmasked: "[NAME_2] kirapuspa". The model labels word pieces, and when one piece of a word leaned the other way ("kira" of "kirapuspa", next to "##pus" and "##pa" that lean to a person), the word was split and dropped. Names are now grouped by word, each word taking the highest person probability of its pieces, in Node (`aggregateWords`) and Python (`aggregate_words`), checked against each other by parity vectors. On the development sets, recall in idner-news-2k went from 95.5% to 96.8% and name precision in Samaran's benchmark from 98.9% to 99.4%, with no false positive added. Found by the independent evaluation of 0.15.0; a name the model does not take for a person at all ("ada yang ngeliat zelvanya kirapuspa ga ya", 0.06) is still missed.

### Security

- The MCP server's file tools no longer check a path and then open it again (TOCTOU). `read_file_masked`, `scan_pii`, `write_file_unmasked`, and `anonymize_file` open a file first and then check the file that was opened: the same file (device and file ID) as the one its path leads to inside the root, read and written through that descriptor. A write goes to a new file with a random name, checked, then renamed into place. While another process swapped a folder in the root for a junction to an outside folder and back, 0.15.0 read the outside file 23 to 36 times in about 1,400 reads and wrote real data outside the root; now 0. A rare double swap can still leave an empty file with a random name outside the root: Node cannot create a file relative to a folder handle.
- The MCP server takes the root's real path once, when it starts: a root swapped for a link later no longer moves the boundary. Files with more than one hard link are refused, since the other name may be outside the root.
- The NER cache of the MCP server and Samaran Proxy (0.15.0) held the texts it had read, personal data included, and `clear_vault` and the vault's expiry did not empty it. It now holds a keyed hash of each text (HMAC-SHA256 with a random key) and where the names are, never the text or a name, and is emptied, with a new key, when the vault is cleared or expires.
- `@lokal-id/ner` and Python's `'lokal'` model load the model from the bytes they checked against the SHA-256, not from the file again; `@lokal-id/ner` downloads into a temporary file with a random name, created only if it is not there.
- The NER extras lock `filelock` 4.2.1, which fixes 17 advisories about other local users' lock files (GHSA-v4x8-3wr5-3wq8 and others). The lock held 4.1.0 for Python 3.10, which the fixed release no longer supports.

## [0.15.0] - 2026-10-31

### Added

- `@lokal-id/ner`: Lokal's own NER model for people's names that nothing announces ("saya di chat sama rianto surya"), for Node. IndoBERT-base fine-tuned by Lokal on public Indonesian NER corpora (MIT), synthetic chat, and news sentences with every name replaced; 125 MB in int8, about 20 ms per chat message on a CPU, in WebAssembly (onnxruntime-web: no native binaries, no install scripts). The model is downloaded once from the GitHub release and checked against its SHA-256. On the held-out chat corpus, rules and model protect 98.9% of the names (rules alone: 19.4%), and 98.8% in Samaran's held-out benchmark, with no false positive in either. See [MODEL.md](packages/ner/MODEL.md).
- `"ner": true` in `.samaran.json` adds the model's names to `read_file_masked`, `scan_pii` (at `min_confidence: "medium"`), and Samaran Proxy. The package is optional: install it next to the server. The guard stays rules-only.
- `detectPii(text, { extra })`, `samaran.mask(text, extra)`, and `samaran.scan(text, extra)` take another detector's matches, such as `await ner.find(text)`.
- `@lokal-id/core/ner`: the filters applied to the model's spans, shared with Python (`lokal.samaran.ner.names_from_spans` and `ner_chunks`) and checked by parity vectors.

### Fixed

- A name after "a.n." no longer runs into the lower-case words after it: "Pasien a.n. Ilham Simatupang kontrol rutin gagal ginjal" masked "Ilham Simatupang kontrol rutin gagal" and left "ginjal".
- A health condition after "kontrol rutin" or "terapi" is masked ("kontrol rutin hipertensi", "terapi asma").
- "AKU TITIP BARANG" in capitals is no longer a name: after "aku" or "saya", a run of capitals counts only when it starts with a known name.

## [0.14.0] - 2026-10-30

### Added

- A chat corpus, `npm run bench:chat`: made-up chat messages, tickets, and WhatsApp exports in which names have no label or cue, mostly in lower case, with held-out dev and test splits. Half of its names are made up, so a detector cannot pass by knowing a list of names. See [evals/chat](evals/chat/README.md).
- `NerNames(model=...)` chooses between two NER models: `'gold'` ([treamyracle/indobert-ner-gold](https://huggingface.co/treamyracle/indobert-ner-gold), IndoBERT-large, MIT) and `'fast'` (the model of 0.13.0).

### Changed

- The optional NER model now finds names in lower-case chat. The models read lower case, but 0.13.0 kept only capitalized names. A lower-case name now counts in a sentence, but not in a CSV header, a `key=value`, or an e-mail address, and not when it is chat slang or an informal verb ("otw", "nungguin", "dibeliin"). With the `fast` model, names protected on the held-out chat corpus went from 30.2% to 62.2%, with no false positive added in either benchmark.
- `NerNames()` now loads `'gold'`, the more accurate model. On the held-out chat corpus it protects 89.3% of the names, against 62.2% for `'fast'` and 19.5% for the rules alone. In the idner-news-2k test set it finds 96.1% of the people at 99.0% precision, against 91.5% for `'fast'`. In Samaran's held-out benchmark it protects 99.6% of the names and 99.2% of all values, with no false positive. It is 1.3 GB and takes about 100 ms per short document on CPU. Pass `model='fast'` for the smaller and three times faster model.

### Fixed

- `new Samaran({ allow: [/…/g] })`: a RegExp with the `g` or `y` flag kept its position between values, so a value it allowed was masked the second time it appeared. Found by an independent evaluation.

### Security

- The MCP server's file tools (`read_file_masked`, `scan_pii`, `write_file_unmasked`, `anonymize_file`) checked that a path stayed inside the project root by its text only. A symbolic link or junction inside the root that pointed outside it was followed, so a file outside the root could be read or written through it. Paths are now checked where they really lead, and a link out of the root is refused. Directory scans already skipped links.

## [0.13.0] - 2026-10-30

### Added

- An optional NER model for names that Samaran's rules do not know, in Python: `pip install "lokal-id[ner]"`, then `Samaran(ner=NerNames())` or `detect_pii(text, ner=...)` from `lokal.samaran.ner`.
  - It uses [cahya/bert-base-indonesian-NER](https://huggingface.co/cahya/bert-base-indonesian-NER) (MIT), read from safetensors at a pinned revision, never from a pickle file. It keeps person names only, after filters for chat words, field names, abbreviations, and place names.
  - Settings were chosen on development data only.
  - On the held-out benchmark it raised names protected from 93.6% to 98.1% and all values from 97.2% to 98.7%, with no false positive.
  - On real news it raised the people found from 21.6% to 91.3%, at 98.3% precision, in the idner-news-2k test set. On 2,250 speakers in 2,277 articles from 14 news sites in October 2026, it raised them from 18.5% to 90.6%. In a sample of 300 of its detections there, 95% were people.
  - It reads text line by line, in passages of about 600 characters, where it finds names best.
  - It costs about 20 to 50 ms per short document on CPU.
  - A name the model cuts inside a word is masked whole, and police or military ranks in front of a name are left out.
  - It is off by default, and the TypeScript package, the guard, and the proxy do not use it.
- `npm run stress`: a stress test of detection, Samaran, Kembaran, the proxy under 64 concurrent requests, the guard hook, the MCP server, and `lokal-mcp scan`, on large and hostile made-up input, with [results](evals/stress/README.md).
- `npm run bench -- --extra FILE` scores another detector's matches together with Samaran's.

### Fixed

- Detection was quadratic on one long line holding many labels or numbers. 400 KB of `Nama: ` took 35 seconds, past the guard's time limit, so a crafted file could have slowed the guard into letting a read through. A value is now read at most 1,000 characters after its label, and the check for a number alone on its line no longer copies the line. 2 MB of the same input now takes 1.8 seconds, in both TypeScript and Python.

## [0.12.0] - 2026-10-30

### Added

- Kembaran reads the files of one run together (`Kembaran.texts` in TypeScript and Python, used by `lokal-mcp kembaran`, `python -m lokal.kembaran`, and `anonymize_file`). A value found in one file is replaced wherever it appears in the others, including a phone number used as a foreign key or a name in a notes column with nothing to label it. No stand-in is the real value of anyone else in the data. The output is checked for the real identity numbers, phone numbers, e-mail addresses, and full names: `anonymize_file` reports them as `real_values_left`, and the commands warn if any is left. Each file also reports `also_found`, the values replaced this way.
- Samaran detects a NIK or KK read by OCR, with letters for digits (`NIK : 33O521 6805000l43`), and a birth date right after a name in a record (`Sinta Wibowo, 12-03-1960, Jl. …`).

### Fixed

- `INSERT INTO pelanggan VALUES (…)`: `VALUES` and other SQL keywords were taken for a name after a word such as "pelanggan".
- Names with a short Chinese-Indonesian family name at the end (`Dewi Lim`, `Ayu Tan`), and `Wati` as a given name.
- Religion after "ia" or "ybs" (`Ia seorang muslim`), and after a dash (`religion - Islam`).

## [0.11.0] - 2026-10-30

### Added

- `lokal-mcp init --profile personal|team|strict` sets a project up: `.samaran.json`, `.samaranignore`, and for teams a GitHub workflow pinned to the same release. `--dry-run` shows the files without writing them. A file that is there is kept, except `.samaran.json` with `--force`.
- `lokal-mcp check` validates `.samaran.json` and `.samaranignore`, shows what they do, and warns about an identity number the model may see, a `route` endpoint that is not on this machine or a private network, an audit log inside the project, and a `.samaranignore` pattern that skips every data file.
- `"guard": "strict"` in `.samaran.json` turns on the strict guard for everyone in the repository. It can only make the guard stricter: any other value is an error, and `SAMARAN_GUARD` on a machine still wins.
- `lokal-mcp kembaran --dry-run` and `anonymize_file` with `dry_run` count what would be replaced and write nothing.
- A Docker Compose example with Samaran Proxy and Ollama, with images pinned by digest and the proxy published on 127.0.0.1 only (`examples/proxy-ollama`), and a guide to putting the proxy in front of LiteLLM (`examples/litellm`).
- A 5-minute quickstart with made-up sample data (`docs/quickstart.md`), a page listing every network connection each part makes (`docs/network.md`), both in English and Indonesian, and the Chrome Web Store listing and privacy answers (`packages/extension/STORE.md`).

## [0.10.0] - 2026-10-30

### Added

- A policy per type of personal data in `.samaran.json`: `mask` (the default), `allow`, `block`, or `route`, per built-in type or custom rule label. The proxy refuses a request with a `block` type (HTTP 403); `read_file_masked` refuses such a file; the guard holds back a single value of a `block` or `route` type, as it does an identity number; `allow` leaves a type unmasked. `lokal-mcp scan` ignores the policy.
- Routing to a local model: with `"route": { "openai": "http://127.0.0.1:11434/v1", "model": "llama3.2" }`, the proxy sends a request with a `route` type as it is to that endpoint (Ollama, or any OpenAI- or Anthropic-compatible server), never to the cloud, and without the cloud API key. Responses say `x-samaran-routed`. A request to an API with no local endpoint is refused.
- An audit log: `"audit": true` appends one JSON line per decision of the proxy, the MCP file tools, and the guard to `.lokal/audit.jsonl` (with a `.gitignore`), holding counts per type and never values. `lokal-mcp audit [file] [--since 7d] [--json]` summarizes it.
- The `clear_vault` MCP tool forgets every real value behind the session's placeholders, and `"vaultTtlMinutes"` (or `LOKAL_VAULT_TTL_MINUTES`) forgets them after that long without use.

## [0.9.0] - 2026-10-30

### Added

- The held-out benchmark is now corpus 2: 70 templates instead of 30 and twice as many names in each split, 2,800 documents and 6,160 labelled values in the test split, with at least 200 of every type. It reports a 95% interval for each number and will not compare numbers across corpus versions. The new test templates were written before measuring and found gaps that corpus 1 could not show: religion after "Agama/Kepercayaan" or in a sentence (57.1% protected), health data in English text (81.7%), BPJS under a "nomor_jkn" column (83.3%), and a timestamp read as a bank account number. On 0.8.3, 94.0% of values are fully masked (93.4–94.6%), with 96.7% precision; with the fixes below, made against new development templates only, 96.6% (96.1–97.0%) with 99.8% precision, and no false positive in the 400 trap documents.
- A table in the README of what each integration checks, what it does not see, and what it does with what it cannot check: Claude Code, Codex CLI, Cursor, Gemini CLI, other MCP clients, the connectors, the browser extension, the proxy, the AI SDK middleware, and Lokal Scan.

### Changed

- `SAMARAN_GUARD=strict` now blocks whatever the guard could not check, instead of only guard errors and one-liners: a file it cannot read (a scanned, encrypted, or damaged PDF, a damaged spreadsheet), the photos and PDFs it would otherwise ask about, output from beyond the first 5 MB of a big file (`cat`, `tail`, `grep`, or `Read` with an offset past it; `head` still runs), a `Grep` over more than 300 data files, and a check that runs longer than 7 seconds, which the hook's 10-second limit would otherwise let through. Each message says what could not be checked.

### Fixed

- `Read` with an offset past the first 5 MB of a big file showed lines the guard had not checked. It now asks first.
- Samaran, in both libraries:
  - Religion after "Agama/Kepercayaan" or "Agama atau kepercayaan", and in a sentence ("(agama Hindu)", "religion: Islam"), is found; religious education, courts, and holidays ("pendidikan agama Islam", "Pengadilan Agama") are not.
  - A known disease after English words ("has asma", "suffers from", "diagnosed with") or after "perawatan", "pengobatan", and "kontrol" is found.
  - A BPJS number under "nomor_jkn", "no_kartu_jkn", or "No. Kartu" on a KIS card is BPJS, not a payment card: card numbers never start with 0.
  - A KK number under "no_kk" or "family_card", or after "No." below a "KARTU KELUARGA" title, is a KK, not a NIK.
  - A street in capitals ("JL. MERDEKA NO. 95", "KP. RAWA BADAK RT 01 RW 02"), as KTP and NPWP cards print it, is masked whole.
  - A date and time ("2026-12-03 04:15") is no longer read as a bank account number, and a call center number ("(021) 500-888") no longer as a phone number.

## [0.8.3] - 2026-10-29

### Added

- A held-out benchmark, `npm run bench`: precision, recall, F1, and the share of values fully masked, per type of personal data, on 1,200 made-up documents in eleven formats (forms, chat, mixed Indonesian and English, informal spelling, unlabelled text, JSON, CSV, logs, OCR output, letters, and traps with no personal data). The test split uses different templates and names from the dev split, and CI fails when a change scores below the baseline. On 0.8.3 it masks 95.0% of values fully, with 99.5% precision; its weakest spots are OCR text with misread characters and names without a label. Method and limits are in `evals/bench/README.md`.
- One set of states for what a check saw, so "no personal data found" is never confused with "never looked": `scanned`, `partial`, `unsupported`, and `failed` (`ScanStatus` and `SCAN_STATUSES` in both libraries). `lokal-mcp scan`, `scan_pii` (with a `byStatus` count), `read_file_masked`, the Python `scan_path`, and the browser extension's attachment reader all report them.
- Samaran Proxy: images, audio, and files inside a JSON request cannot be checked for personal data. They are still forwarded, but the response now says `x-samaran-status: partial` with the count in `x-samaran-unchecked`, and the log line says so. Every response carries `x-samaran-status`. `--strict` refuses such requests with HTTP 422, and also refuses file uploads even with `--allow-unmasked`.
- Leak tests: one made-up person with every kind of personal data (`packages/core/test/canary.json`) goes through both libraries, the AI SDK middleware, every MCP tool, the guard, every API shape of the proxy, `lokal-mcp scan`, Kembaran, the Python logging filter, and the browser extension, as a form, JSON, a log line, CSV, and JSON inside JSON. A test fails if any value, or part of the name or street, comes out.

### Fixed

Found by the leak tests. Each one let some values through unmasked:

- A CSV after a sentence ("Tolong cek data ini:" and then the table) was only read by its columns when the header was the first line, so names, bank accounts, BPJS and passport numbers, birth dates, religion, and diagnoses in it went through. Now a header in the first 20 lines is found, and a table that starts after a sentence ends at its last row. A header after a log prefix ("import csv: nama,nik") is found too.
- Text from JSON or a log formatter keeps its line breaks as `\n`. A label after one ("...\nAgama: Islam") was not found, and a name before one was cut short. Escaped line breaks now count as line breaks, also after two rounds of JSON.
- JSON inside a JSON string, as logs write a request body and tool calls their arguments, had its field names escaped, so names, birth dates, religion, and diagnoses in it were not found. Such strings are now read unescaped, in one pass for a whole log.
- The proxy now masks a tool call's arguments and other JSON in a string field by field, with each field's name as context, including fields such as `name` and `id` that it leaves alone in the request itself.
- A labelled value inside a JSON string took the closing quote with it (`{"note":"Agama: Islam"}`), so masking a JSON file broke it. A quoted value with an escaped quote in it (`"Budi \"Bob\" Santoso"`) stopped at that quote and left the surname.
- `scan_pii` and the Python `scan_path` skipped a file silently when it could not even be opened (permissions, a file removed while scanning). It is now reported as `failed`, not left out.

## [0.8.2] - 2026-10-29

### Fixed

- Browser extension: after the extension was updated or reloaded while a chat stayed open, pasting or sending personal data in that tab showed "Uncaught Error: Extension context invalidated." on the extension's page and no message in the chat. The data was already held back and never sent; now the tab also says that Lokal was updated and the page needs a reload.

## [0.8.1] - 2026-10-29

### Fixed

- Text that already looked like a placeholder could be restored with a real person's data. With an e-mail template such as "Halo [NAME_1]" in the input, the real name was masked as [NAME_1] too, the model could not tell them apart, and restoring filled the template with the real name. Now numbers already used in the input are skipped: the real name becomes [NAME_2], and [NAME_1] stays as it was. This applies to the libraries (TypeScript and Python), the MCP server, the browser extension, and the proxy, which reserves the numbers across every message of a request first. `Samaran.reserve(text)` does the same for code that masks a request in parts. A placeholder that the session made itself, quoted back by the user, still means that person.

### Added

- The proxy counts placeholders in an answer that the request never made (made up by the model, or copied from a template): a log line says how many, without naming them, and a non-streamed answer carries an `x-samaran-unrestored` header.
- `write_file_unmasked` adds a `warning` when the content has placeholders that the session did not make, next to the existing `unknownPlaceholders` list, so the agent can fix a mistyped placeholder instead of writing it into the file.
- `read_file_masked` notes when the file itself contains text that is also a placeholder from this session, which `write_file_unmasked` would restore.

## [0.8.0] - 2026-10-29

npm (`@lokal-id/core`, `@lokal-id/mcp`), PyPI (`lokal-id`), the GitHub Action, and the browser extension.

### Added

- `.samaran.json` at the project root adds a team's own data types: rules with a `label` and a regular expression `pattern` (an employee ID like `EMP-004211`) or `fields` (JSON keys, `key: value` labels, and CSV columns such as `no_member`). Matches are masked as `[EMPLOYEE_ID_1]` and restored like any placeholder; `allow` lists values that are never masked. The MCP server, the guard, `lokal-mcp scan` and the GitHub Action, the proxy, `lokal-mcp kembaran`, and `lokal.files.scan_path` read it. A broken file makes the file tools and `lokal-mcp scan` fail with the reason, instead of masking less than the team expects. In the libraries, pass the rules as `custom`: `new Samaran({ custom })`, `detectPii(text, { custom })`, `new Kembaran({ custom })`, and the same keyword in Python. Matches have type `CUSTOM` and the rule's `label`; a rule whose label is a built-in type, or whose pattern does not compile, is refused. Both ports match the same text, checked by 309 shared vectors.
- `SAMARAN_GUARD=strict` makes the guard fail closed. An error in the guard, such as a broken `.samaran.json` or malformed hook input, blocks instead of allowing. Code run from the command line that names a data file with personal data is blocked like `cat`: `python -c`, `node -e`, `ruby -e`, `perl -e`, `php -r`, a heredoc or PowerShell here-string fed to an interpreter, and `[IO.File]::ReadAllText`. Scripts saved in files still run. The default is unchanged.
- A test proves the "no network calls" claim. The MCP server runs every one of its 17 tools, then the guard, `lokal-mcp scan`, and `lokal-mcp kembaran` run, all with every Node network API (sockets, TLS, HTTP, DNS, UDP, `fetch`) replaced by one that throws and logs. The Python library does the same with sockets and name lookups. A new MCP tool without a call in the test fails it.
- README: "What Lokal is not" near the top, and "Defense in depth", with Claude Code permission rules and strict mode for data that must never reach a model provider.

### Changed

- The browser extension no longer uploads files it cannot check without asking. A scanned or password-protected PDF, a damaged document, a file over 20 MB, and a photo whose name says it is an ID document (`ktp-budi.jpg`, `selfie_kyc.png`, `npwp.png`) are held, and the browser asks whether to upload them as they are. Cancel, Esc, and a site that blocks dialogs leave them out. Before, they were uploaded with a notice afterwards.
- A team's own rules count as identity numbers in the guard: one match is enough to hold a prompt or a file.

## [0.7.2] - 2026-10-27

The browser extension. npm, PyPI, and the GitHub Action are released with the same version and no other changes.

### Fixed

- In ChatGPT, a typed message with personal data was not replaced by its masked version when Enter was pressed: the masked text was added after it, the real value stayed in the box, and each Enter added another copy. Nothing was sent, since the extension holds Enter while personal data is in the box. ChatGPT's editor reads a new selection a moment later than other editors; the extension now waits for it, checks that the box holds the masked text, and holds the message with a notice if it cannot replace it.

## [0.7.1] - 2026-10-27

npm (`@lokal-id/core`, `@lokal-id/mcp`), PyPI (`lokal-id`), the GitHub Action, and the browser extension.

### Added

- `parse_alamat`, `parse_nik`, `parse_phone`, and `validate_npwp` in the MCP server take placeholders from `read_file_masked` (`[ADDRESS_3]`, `[NIK_1]`, `[PHONE_2]`). The server reads the real value from its own vault, on the user's machine, and returns the regions and codes, validity, and operator; the street, RT/RW, birth date, and gender come back as new placeholders that `write_file_unmasked` restores. Before, an agent that read a customer file through the mask could not clean its address column at all: `parse_alamat("[ADDRESS_5]")` found no region.
- `Samaran.placeholder(type, value)` (Python: `placeholder(pii_type, value)`) gives the placeholder for a value you already know is personal data, the same one `mask` would give it.

## [0.7.0] - 2026-10-26

npm (`@lokal-id/core`, `@lokal-id/mcp`), PyPI (`lokal-id`), the GitHub Action, and the browser extension.

### Added

- `parseAlamat` (`@lokal-id/core/wilayah`), `parse_alamat` (Python), and the `parse_alamat` MCP tool read a free-text address into street, RT/RW, kode pos, and the Kemendagri kelurahan/desa, kecamatan, kabupaten/kota, and provinsi with their codes. Commas, capitals, abbreviations ("Kel.", "Kec.", "Kab.", "Jaksel", "Jabar", "Tangsel"), and left-out levels are fine: the missing levels come from the region's code or the kode pos and are listed in `inferred`. Each result has a `confidence`, `alternatives` when the address fits more than one region ("Bogor"), and `issues` such as a kode pos that belongs to another kelurahan or a village that is not in the data. Google Maps style addresses work too ("Kec. Kby. Baru", "Kota Jakarta Sel.", a Plus Code in front). `npm run eval:alamat` measures it on addresses built from random villages (99.5% right, none wrong with confidence "high"), and `npm run eval:alamat:osm` on real addresses of places in OpenStreetMap, against the boundaries their coordinates fall in: on 1,528 addresses not looked at while tuning, 94.6% right at the kabupaten/kota, 91.6% at the kecamatan, and 88.4% at the kelurahan/desa, and 98.6% of the answers with confidence "high" match. Checked by hand, most of the rest are addresses that name a neighbouring kelurahan or are mapped next to a boundary, or name only a village that many kabupaten share (those get confidence "low"). Names with a typo are read too ("Kab. Tasikmalayah", "Cibinog, Bogor", "Kec. Tanah Sereal"): kabupaten, kota, and provinsi anywhere, kecamatan and kelurahan only inside the kabupaten or kota the address names or its kode pos points to, and an issue says what the name was taken for. With one typo in one name, `npm run eval:alamat -- --typos` gets 97.4% right (67% without this); a reading with a typo is never more than "medium".
- The browser extension masks attachments. A file chosen with the site's attach button, dropped on the page, or pasted is checked before the site gets it: text files (CSV, JSON, logs, SQL, code) are masked in place, an Excel file becomes one masked CSV per sheet, and a Word document or a PDF with a text layer becomes one masked text file. Files without personal data are uploaded unchanged. Images, scanned or password-protected PDFs, and files over 20 MB are uploaded as they are, with a notice for the documents it could not read.

### Fixed

- Samaran no longer reads a command after a key named like an address field as an address: `"eval:alamat": "node evals/alamat-bench.mjs"` in a package.json, which the MCP guard and the Claude Code hook held.

## [0.6.0] - 2026-10-23

npm (`@lokal-id/core`, `@lokal-id/mcp`), PyPI (`lokal-id`), the GitHub Action, and the browser extension.

### Changed

- **Masked output can differ from 0.5.0 for the same text.** Samaran now finds more personal data, so a text masked by 0.5.0 can get more placeholders, and NISN and certificate numbers get their own `[NISN_1]` and `[AKTA_1]`. The MCP guard and the Claude Code hook hold prompts that contain either. If you compare masked output in snapshots, update them.
- On free text it has not seen, Samaran catches about 82 to 88% of personal values. The README explains how this was measured.

### Added

- Samaran finds personal data that has no label in front of it. Names after a role ("Pelanggan Budi Santoso", "Kurir Supardi"), a greeting ("Halo Budi,", "Dear Mr. Hendra Gunawan,"), a title ("Dr. Ir. H. Bambang", "Hj.", "koh"), or as a sign-off, e-mail display name, or social media handle; and names recognized by their parts from common Indonesian given and family names, Batak clan names, and Balinese and Chinese-Indonesian patterns, in capitals too, as bank statements write them. Also identifiers in file names and glued to letters ("KTP_3201….jpg", "wa0812…"), URL-encoded values, HTML forms and tables, labels with the value on the next line, card security codes, phone numbers in brackets, in groups of two digits, read out as words, or as landlines next to a phone word, housing estates, apartments and villages, and lowercase "jl" addresses.
- UU PDP sensitive data in everyday language: religion ("saya muslim"), marital status ("saya sudah cerai"), criminal records ("mantan napi", "pernah dipenjara"), debt status ("galbay", "masuk BI checking"), allergies, symptoms, medical history, and conditions said of a relative ("ayah stroke").
- Two new types: `NISN` (student number; children's data, so "spesifik" under UU PDP) and `AKTA` (birth, marriage, divorce, and death certificate numbers, in the Dukcapil format "3201-LT-12052018-0042" or after the words "akta kelahiran"). The MCP guard holds a prompt with either, as it does other ID numbers.
- More of UU PDP Pasal 4 and its Penjelasan: genetic results ("pembawa sifat thalassemia", "BRCA1 positif"), test results ("tes HIV reaktif"), immigration and wanted lists ("masuk daftar cekal", "DPO"), release from prison, symptoms someone has had ("sudah 3 hari demam"), findings in a medical note ("tekanan darah 150/95"), disabilities, KTP lines that lost their colons ("Agama KRISTEN"), HL7 patient and diagnosis segments, coordinates labeled "lat" and "lng", and savings, deposits, credit card bills, and loan balances that someone holds.
- Names from their context: an age in brackets ("Kevin (19)"), attendance and emergency contact lists ("Wahyu (sakit)", "Wulan (istri)"), two names joined by "&", court and insurance roles ("Penggugat", "Tertanggung"), Sundanese and Javanese introductions ("nami abdi", "jenengku"), `user=` in logs and `(andreas.w)` after a name, Slack-style "[10:21] name:" lines, PHP and Ruby hashes (`'name' => …`), and about 190 more common given names, with Javanese name endings ("-wati", "-yanto").
- The PII benchmark grew from 15 to 418 formats, every case also checked for TypeScript/Python parity, and it now fails when a match does not sit exactly at its offsets.
- `@lokal-id/core/ai-sdk`: Samaran as a Vercel AI SDK middleware. `wrapLanguageModel({ model, middleware: samaranMiddleware() })` masks the prompt and restores the answer on every call, streamed or not, including tool inputs and results and structured output. It runs in-process, so it works in serverless and edge functions and with every AI SDK provider. AI SDK 7, and AI SDK 6 with `specificationVersion: 'v3'`.

### Fixed

- An IP-like document number ("SK No. 100.3.3.1-6117") and a code expression under an address key (`street = new RegExp(`) are no longer masked.
- A labeled ID number no longer takes the words after it: in `NPWP: 01.234.567.8-901.000 a.n. CV Maju Jaya` the company name was masked too.
- An IP address that ends a sentence ("dari IP 36.72.215.104.") is masked; a section number such as "5.2.1.1." is not.
- "riwayat penyakit yang …" in a privacy policy or in the text of UU PDP no longer masks the words after it.
- A lone given name after "di" ("tinggal di Wina") and villages ending in "Rejo", "Mukti", "Karya", or "Bakti" are no longer read as a person's name.
- The browser extension's English notices use plurals: "Lokal masked 2 phone numbers", not "2 phone number".

## [0.5.0] - 2026-10-22

npm (`@lokal-id/core`, `@lokal-id/mcp`), PyPI (`lokal-id`), the GitHub Action, and the browser extension.

### Added

- **Lokal Scan: `lokal-mcp scan` and a GitHub Action** stop Indonesian personal data from being committed. `--staged` checks the lines staged for a commit, for pre-commit hooks; `--diff <ref>` checks the lines a branch adds, for CI. A repository that already holds test data can turn it on without cleaning up first. Without either option it checks every file git tracks. Findings show partially masked values only, as text, JSON, or GitHub annotations with a job summary. Files in `.samaranignore` and lines containing `samaran-ignore` are skipped. Spreadsheets, Word documents, and PDFs are checked whole, and files that cannot be read are reported (`--strict` fails on them). The action (`uses: lokal-id/lokal@v0.5.0`) runs the scanner from the npm release of the same version.
- **Browser extension** for ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok, and Le Chat (Chrome, Edge, and other Chromium browsers). Personal data is masked when it is pasted, and typed data before Enter or the send button sends it. Placeholders in the conversation are highlighted, pointing at one shows the real value, and copying an answer, with Ctrl+C or the site's copy button, restores the real values. They are never written into the site's page and are kept only in the browser's session memory. The same value gets the same placeholder in every tab. Attached files are not masked yet. Not in the Chrome Web Store yet: download `lokal-extension-0.5.0.zip` from the GitHub release, unzip it, and load the folder with **Load unpacked**.

### Fixed

- A JSON or YAML key named like an IP address field no longer marks a package version as an IP address: `"ip-address": "^10.2.0"` in `package-lock.json` was reported. An IP value must now be a dotted quad or contain `:` (IPv6).
- A labeled address no longer runs into the next sentence when that sentence opens with another field: in `Alamat: Jl. Melati No. 12, Bandung. Rekening BCA 1234567890.` the bank account was masked as part of `[ADDRESS_1]`. It is now its own `[BANK_ACCOUNT_1]`. Abbreviations inside an address (`Jl.`, `Kel.`, `Kec.`) do not end it.

## [0.4.1] - 2026-10-21

npm (`@lokal-id/core`, `@lokal-id/mcp`) and PyPI (`lokal-id`).

### Fixed

- **Names in default `mysqldump` and `pg_dump` output were not masked or replaced.** Rows without column names (`INSERT INTO pelanggan VALUES (1,'Budi Santoso',…)`) are now read by the columns of the dump's `CREATE TABLE`, and pg_dump's `COPY … FROM stdin` blocks by their column list, so `scan_pii`, `read_file_masked`, the guard, and Kembaran treat them like `INSERT` with column names. NIK, phone numbers, and e-mail were already caught by their format; names, addresses, and health values in those rows were left as they were. `REPLACE INTO` and `INSERT IGNORE` are read too. A 100,000-row mysqldump is read in about a second.

### Changed

- The release lists a new version in the MCP Registry only once npm serves both `@lokal-id/core` and `@lokal-id/mcp`. For 0.4.0 the registry listed the server while npm was still processing `@lokal-id/core` (11 minutes, against 2 for `@lokal-id/mcp`), so installing `@lokal-id/mcp@0.4.0` in that window failed. The release now waits up to 30 minutes.

## [0.4.0] - 2026-10-17

npm (`@lokal-id/core`, `@lokal-id/mcp`) and PyPI (`lokal-id`).

### Added

- **Kembaran**: copies production dumps and exports (SQL, CSV, JSON, logs) for staging, seeders, or vendors with every person replaced by a realistic stand-in. A NIK keeps its district, gender, and birth year and stays valid; a phone number keeps its operator and format; names keep their casing and titles; e-mail goes to `example.com`; a birth date on the same row follows the stand-in NIK. The same value gets the same stand-in across files, stand-ins come from HMAC-SHA256 under a secret, and unique values never collide. `lokal-mcp kembaran`, the `anonymize_file` MCP tool (returns only counts), `@lokal-id/core/kembaran`, and `python -m lokal.kembaran`, with identical output in TypeScript and Python for the same secret.
- **Samaran Proxy** (`npx @lokal-id/mcp proxy`): an OpenAI- and Anthropic-compatible endpoint that masks personal data in every LLM call an app makes and restores it in the answers. It covers Chat Completions, the Responses API, embeddings, and Anthropic Messages, streamed or not, with tool call arguments restored as valid JSON and signed thinking blocks left alone. Any OpenAI-compatible API (OpenRouter, Groq, DeepSeek, Ollama, Gemini) can be the upstream. Tested end to end with Claude Code running through it.
- **QRIS**: `parseQris` / `parse_qris` reads a QRIS payload (static or dynamic, merchant, NMID, merchant criteria, amount, fee, CRC) with errors in Indonesian, and `setQrisAmount` / `set_qris_amount` turns a merchant's QRIS into a dynamic one for an amount, optionally with a fixed or percentage fee, recomputing the CRC-16. Amounts with more than 2 decimals are refused, not rounded. In TypeScript, Python, and the MCP server, with parity vectors.
- **ChatGPT and Claude.ai**: `lokal-mcp serve --http` serves the data tools (NIK, NPWP, phone, Rupiah, regions, postal codes, holidays, QRIS) over Streamable HTTP for remote connectors. The file tools are left out in this mode.
- **Samaran Guard in Codex CLI, Cursor, and Gemini CLI**: `lokal-mcp guard` recognizes their hook events and answers in each agent's format, so the same prompt and file-read checks work there. Cursor always gets a JSON answer, since it treats a missing one as a denial.

### Fixed

- A labeled health value ran on into the next sentence: `diagnosa: Diabetes tipe 2. Plat B 1234 XYZ` took the plate along. It now ends with its sentence.
- Files shown with line numbers, as an agent's `Read` tool or `cat -n` prints them (`1→nama,nik`), lost their CSV header, so a `nama` column was not masked. Line numbers are now ignored when headers and tab-separated tables are read.

### Security

- **`@lokal-id/mcp` installs no third-party packages.** The MCP SDK, zod, and their dependencies are bundled into `dist/cli.js` at release time from the lockfile, with their licenses in `dist/THIRD_PARTY_LICENSES.md`. Its only dependency is `@lokal-id/core`, pinned to the exact version it was tested with, and core has none. Before, `npx @lokal-id/mcp` installed 95 third-party packages, resolved by version range on each machine, so a compromised release of any of them would have reached users.
- Releases are built and published in separate jobs. The job that installs dependencies and runs the build and tests has no publishing rights; the job that publishes (npm and PyPI, through Trusted Publishing) installs and runs nothing, and only uploads the files the first job made. Dependencies are installed from the lockfiles (`npm ci --ignore-scripts`, `uv sync --locked`) with install scripts off, `npm audit signatures` checks the registry signatures, and every GitHub Action is pinned to a commit. The repository's `.npmrc` turns off install scripts for contributors too.
- CI and the release test the bundled server as published (`scripts/smoke-mcp.mjs`), not only the sources.

## [0.3.0] - 2026-10-17

npm (`@lokal-id/core`, `@lokal-id/mcp`) and PyPI (`lokal-id`).

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

[Unreleased]: https://github.com/lokal-id/lokal/compare/v0.16.0...HEAD
[0.16.0]: https://github.com/lokal-id/lokal/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/lokal-id/lokal/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/lokal-id/lokal/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/lokal-id/lokal/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/lokal-id/lokal/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/lokal-id/lokal/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/lokal-id/lokal/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/lokal-id/lokal/compare/v0.8.3...v0.9.0
[0.8.3]: https://github.com/lokal-id/lokal/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/lokal-id/lokal/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/lokal-id/lokal/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/lokal-id/lokal/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/lokal-id/lokal/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/lokal-id/lokal/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/lokal-id/lokal/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/lokal-id/lokal/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/lokal-id/lokal/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/lokal-id/lokal/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/lokal-id/lokal/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/lokal-id/lokal/compare/v0.2.2...v0.3.0
[0.2.3]: https://github.com/lokal-id/lokal/releases/tag/py-v0.2.3
[0.2.2]: https://github.com/lokal-id/lokal/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/lokal-id/lokal/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/lokal-id/lokal/releases/tag/v0.2.0
