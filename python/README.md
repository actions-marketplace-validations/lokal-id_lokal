# lokal-id

[![PyPI](https://img.shields.io/pypi/v/lokal-id?color=3775a9)](https://pypi.org/project/lokal-id/)
[![Python](https://img.shields.io/pypi/pyversions/lokal-id)](https://pypi.org/project/lokal-id/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/lokal-id/lokal/blob/HEAD/LICENSE)

Indonesian data primitives for Python backends and AI agents: NIK, NPWP, phone numbers, Rupiah, *terbilang*, holidays and working days, Kemendagri regions with postal codes, and **Samaran**, which masks Indonesian personal data before it reaches an LLM or a log, and restores it afterwards.

The Python port of [`@lokal-id/core`](https://www.npmjs.com/package/@lokal-id/core): same rules, same data, same results, checked by replaying thousands of TypeScript outputs in the test suite. No dependencies, fully typed, Python 3.10+.

Part of [Lokal](https://github.com/lokal-id/lokal) · [Bahasa Indonesia](https://github.com/lokal-id/lokal/blob/HEAD/README.id.md)

## Install

```sh
pip install lokal-id
```

```python
import lokal                 # NIK, NPWP, phone, Rupiah, holidays, Samaran
from lokal import wilayah    # regions and postal codes (loaded on first use)
```

## Usage

```python
from decimal import Decimal
import datetime as dt

from lokal import (
    parse_nik, parse_npwp, parse_phone, format_rupiah, format_rupiah_short, parse_rupiah, terbilang,
    add_working_days, is_working_day,
)
from lokal.wilayah import list_wilayah, search_wilayah, wilayah_name, find_by_postal_code, parse_alamat

nik = parse_nik('3201011508950001', lookup_wilayah=wilayah_name)
nik.valid, nik.regency, nik.district, nik.gender, nik.birth_date
# (True, 'Kabupaten Bogor', 'Cibinong', 'L', '1995-08-15')

phone = parse_phone('0812 3456 7890')
phone.e164, phone.national, phone.whatsapp, phone.operator
# ('+6281234567890', '0812-3456-7890', '6281234567890', 'Telkomsel')

format_rupiah(1500000)                      # 'Rp1.500.000'
format_rupiah(Decimal('1500000.505'), decimals=True)   # 'Rp1.500.000,51', exact for database decimals
format_rupiah_short(2300000000)             # 'Rp2,3 M'
terbilang(1500000, currency=True)           # 'satu juta lima ratus ribu rupiah'
parse_rupiah('2jtan')                       # ParsedRupiah(amount=2000000, approximate=True)
parse_rupiah('sejuta setengah')             # ParsedRupiah(amount=1500000, approximate=False)

add_working_days('2026-03-17', 1)           # '2026-03-25', skipping Nyepi and Lebaran
add_working_days(dt.date(2026, 3, 17), 1)   # datetime.date(2026, 3, 25): dates in, dates out
is_working_day('2026-12-24', cuti_bersama=False)  # True for offices that ignore cuti bersama

len(list_wilayah('32.76'))                  # 11 kecamatan in Kota Depok
search_wilayah('kab. bogor')[0].code        # '32.01'
find_by_postal_code('16431')[0].path        # 'Depok, Pancoran Mas, Kota Depok, Jawa Barat'

alamat = parse_alamat('jl margonda raya no 100 rt 3/5 kemiri muka beji depok 16423')
alamat.kelurahan_desa.code, alamat.rt, alamat.confidence   # ('32.76.06.1004', '003', 'high')
```

Every result is a dataclass. `to_dict()` gives a JSON-ready dict without empty fields, and `to_dict(camel=True)` uses the same keys as the TypeScript package (`birthDate`, `postalCode`) for frontends that share types with it.

### Samaran: mask before the LLM, restore after

```python
from anthropic import Anthropic
from lokal import Samaran

client = Anthropic()

def balas_pelanggan(pesan: str) -> str:
    samaran = Samaran()                       # one vault per conversation or request
    masked = samaran.mask(pesan).text         # 'NIK saya [NIK_1], HP [PHONE_1]'
    reply = client.messages.create(
        model='claude-sonnet-5-5',
        max_tokens=1024,
        messages=[{'role': 'user', 'content': masked}],
    )
    return samaran.unmask(reply.content[0].text)   # real values back, on your server
```

- The same value always maps to the same placeholder, across formats: `0812-…` and `+62 812…` are both `[PHONE_1]`.
- `Samaran(mode='partial')` is for logs and admin screens: `3201********0001`, `0812****7890`, `b***@gmail.com`.
- `Samaran(exclude=['FINANCIAL', 'NAME'])` keeps types your app has to read, such as income and installments in a dealer's credit simulation, while NIK, phone numbers, and accounts are still masked. `types=` does the opposite (only those). An unknown type name raises `ValueError`.
- `Samaran(allow=['cs@toko.id', re.compile(r'@toko\.id$')])` never masks your own contacts.
- `placeholder('ADDRESS', street)` gives the placeholder for a value you already know is personal, such as the street a parser split out of a masked address; `unmask` restores it.
- `export_vault()` / `import_vault()` move the vault between processes, for example through Redis. Treat it as the raw data it contains.
- `detect_pii(text)` returns the matches without masking; `min_confidence='high'` keeps only validated or keyword-anchored ones.
- 27 types, covering every category in UU PDP Article 4: identifiers (NIK, KK, NPWP, passport, SIM, NIP, BPJS, NISN, civil registry deed numbers, phone, email, bank account, card, plate, IP, coordinates), name, address, birth date, gender, religion, marital status, nationality, health, finances, criminal records, and biometrics. Found through labels, CSV headers, JSON/YAML keys, SQL `INSERT` dumps, WhatsApp chat exports, and common phrases in free text.

To cover every LLM call of an app without calling `mask()` and `unmask()` at each one, run the Samaran Proxy (`npx @lokal-id/mcp proxy`) next to the backend and point the SDK at it: `OpenAI(base_url='http://127.0.0.1:8787/v1')` or `Anthropic(base_url='http://127.0.0.1:8787')`. It masks requests and restores responses, streaming and tool calls included. See the [Lokal README](https://github.com/lokal-id/lokal#samaran-proxy-protect-an-apps-llm-calls).

### Names the rules do not know: an optional NER model

Samaran finds a name from its label, its column, a cue ("Pelanggan …", "a.n. …", "pak …"), or a known Indonesian given or family name. A name with none of these slips through, and in chat that is most names: "saya di chat sama rianto surya tadi pagi", "ada yang ngeliat minan minanto ga ya". For batch jobs where that matters, add a local NER model:

```sh
pip install "lokal-id[ner]"     # transformers and PyTorch: large
```

```python
from lokal.samaran import Samaran
from lokal.samaran.ner import NerNames

ner = NerNames()                  # downloads the model once; NerNames(model_path=...) loads an approved copy
samaran = Samaran(ner=ner)
samaran.mask('td pagi rianto surya nelpon, katanya mau resign').text
# 'td pagi [NAME_1] nelpon, katanya mau resign'
```

There are two models. Both are IndoBERT fine-tuned for Indonesian NER, MIT-licensed, and read from safetensors at a pinned revision, never from a pickle file:

| | `NerNames()`, `model='gold'` | `NerNames(model='fast')` | Rules alone |
|---|---|---|---|
| Model | [treamyracle/indobert-ner-gold](https://huggingface.co/treamyracle/indobert-ner-gold) (IndoBERT-large) | [cahya/bert-base-indonesian-NER](https://huggingface.co/cahya/bert-base-indonesian-NER) (IndoBERT-base) | |
| Names in chat (held-out [chat corpus](../evals/chat/README.md)) | **89.3%** | 62.2% | 19.5% |
| Names in lower-case chat | **89.4%** | 59.5% | 11.1% |
| People in news ([idner-news-2k](https://github.com/khairunnisaor/idner-news-2k) test set) | **96.1%**, 99.0% precision | 91.5%, 97.7% precision | 21.6% |
| Names in Samaran's held-out benchmark | **99.6%** | 98.1% | 93.6% |
| False positives in the benchmarks' trap documents | 0 | 0 | 0 |
| Size, time per short document on a laptop CPU | 1.3 GB, about 100 ms | 440 MB, about 30 ms | 0.2 ms |

- **Settings.** Thresholds and filters were chosen on development data only. Every number above is on data that played no part in choosing them.
- **Filters.** Only the model's person names are used, and only those that pass filters for chat words and slang, informal verbs ("nungguin", "dibeliin"), field names, abbreviations, and place names. The model reads lower case, so a name in lower-case chat counts, but only in a sentence: not in a CSV header, a `key=value`, or an e-mail address.
- **Real news.** In 2,277 articles from 14 Indonesian news sites, published in October 2026, the 2,250 speakers named after "kata", "ujar", or "sebut" were found 18.5% of the time by the rules and 90.6% with the fast model. That ranges from 83.7% (technology) to 97.2% (entertainment). The speakers were labelled automatically, and in a sample of the ones missed, more than half were job titles or organizations rather than people, so 90.6% is a lower bound. In a random sample of 300 of the fast model's detections there, 285 (95%) were people. The news texts were processed on one machine for the test, and only these numbers were kept.
- **Privacy.** The model runs on your machine, and the text never leaves it. The only network access is downloading the model, once.
- **Merging.** The model's matches merge with the rules' matches, and the rules win where they overlap. A name the model cut inside a word is masked whole, and a rank or form of address in front of it ("Kombes Pol.", "mama") is left out.
- **Long text.** The model reads each line, and a long line in passages of about 600 characters cut at sentence ends. In one long passage it starts to miss names it finds when they stand alone.
- **Where to use it.** Exports, batch masking, and data for vendors, not per keystroke. The TypeScript package, the guard, and the proxy do not use it.

### Logging

```python
import logging
from lokal.samaran.logging import SamaranFilter

handler = logging.StreamHandler()
handler.addFilter(SamaranFilter())          # partial masks by default
logging.basicConfig(handlers=[handler], level=logging.INFO)

logging.info('refund ke rek BCA %s, HP %s', '1234567890', '0812-3456-7890')
# INFO:root:refund ke rek BCA ******7890, HP 0812****7890
```

The filter masks the formatted message, tracebacks, and stack info. Attach it to handlers, not loggers, so records from every logger pass through it.

### Files: uploads, exports, and documents

`lokal.files` reads the same formats as the MCP server: text, CSV, JSON, logs, SQL, `.xlsx`, `.docx`, and text-based PDF, including filled-in PDF form fields. Scan an upload folder from a Django or FastAPI backend, or turn a document into text to mask before it goes to an LLM:

```python
from lokal import Samaran
from lokal.files import load_document, scan_path

report = scan_path('var/media', exclude=['FINANCIAL'])
report.totals                       # {'NIK': 12, 'NAME': 9, 'PHONE': 7, ...}
report.findings[0]                  # Finding(file='kredit/formulir.pdf', part='Halaman 1', line=4, type='NIK',
                                    #         confidence='high', uu_pdp='umum', preview='3201********0001')
[(n.file, n.reason) for n in report.not_scanned]
# [('ktp/budi.jpg', 'image (may be a KTP or selfie photo)'),
#  ('kredit/lampiran.pdf', 'partly scanned: page 2 of 3 has no text layer (scanned) and needs OCR')]

doc = load_document('var/media/kredit/formulir.pdf')
s = Samaran()
masked = [(part.name, s.mask(part.text).text) for part in doc.parts]   # one part per page, sheet, or table
```

- Findings never contain the values, only partial masks, so a report can be logged or shown in an admin page.
- Files that may hold personal data but cannot be read (photos, scanned or encrypted PDFs, `.xls`, archives) are listed in `not_scanned`, never treated as clean. `report.clean` is true only when nothing was found and nothing was left unread.
- Folders skip `node_modules`, `.git`, virtualenvs, and build output, and honor `.samaranignore` at the folder root for fixtures that hold only fake data.
- Pure Python, like the rest of the package. A PDF of 1,000 pages takes about 6 seconds; most documents take milliseconds.

### Kembaran: production data for staging

```python
from pathlib import Path
from lokal.kembaran import Kembaran

k = Kembaran(secret='staging-2026')          # the same secret gives the same people on every run
for name in ('pelanggan.sql', 'kredit.csv'):  # one instance: the same customer in both files
    out = k.text(Path('dump', name).read_text())
    Path('staging', name).write_text(out.text)
    print(name, out.replaced)                # {'NAME': 1200, 'NIK': 1200, 'PHONE': 1180, ...}
```

Every person becomes a realistic stand-in: a valid NIK in the same district with the same gender and birth year, a phone number on the same operator, a name with the same casing, an address in the same area, e-mail at `example.com`. From the shell: `python -m lokal.kembaran prod.sql -o staging.sql --secret …`. The output is identical to the TypeScript version for the same secret. A stand-in phone number can still belong to someone, so keep staging from sending SMS or WhatsApp.

### QRIS

```python
from lokal import parse_qris, set_qris_amount

info = parse_qris(payload)        # the text inside the merchant's QRIS code
info.valid, info.type, info.merchant_name, info.nmid, info.criteria_label
# (True, 'static', 'KOPI CONTOH', 'ID1026000000001', 'Usaha Mikro')

dynamic = set_qris_amount(payload, 25000, tip_percent='0.7')   # same merchant, Rp25.000 + 0.7%, new CRC
```

`parse_qris` reports a broken or altered code (`CRC tidak cocok: …`) and anything that is not QRIS. `set_qris_amount` takes `int`, `str`, or `Decimal` amounts and refuses more than 2 decimals instead of rounding.

### Validating API input

```python
from pydantic import BaseModel, field_validator
from lokal import normalize_phone, parse_nik

class Pelanggan(BaseModel):
    nik: str
    hp: str

    @field_validator('nik')
    @classmethod
    def nik_valid(cls, v: str) -> str:
        info = parse_nik(v)
        if not info.valid:
            raise ValueError(info.errors[0].message)   # 'Tanggal lahir di NIK tidak valid.'
        return info.nik

    @field_validator('hp')
    @classmethod
    def hp_e164(cls, v: str) -> str:
        e164 = normalize_phone(v)
        if e164 is None:
            raise ValueError('Nomor HP tidak valid.')
        return e164                                    # store +62…
```

## Same results as TypeScript

The test suite replays vectors generated from `@lokal-id/core`: hundreds of NIK, NPWP, phone, and Rupiah inputs, every day of 2026 and 2027, all 91,000 regions with their postal codes, and 2,700 texts for Samaran, including WhatsApp exports, SQL dumps, emoji, no-break spaces, and CRLF. Python must return exactly what TypeScript returns. The file readers are checked the same way against the MCP server's: real PDFs from Chrome and ReportLab, an Excel export, a Word letter, hand-built PDFs for each structure the reader handles, and damaged copies of them. On top of that, 40,000 random texts, 11 MB of real files, and 63 real PDFs of up to 1,000 pages gave identical results during development.

To get there the port keeps JavaScript semantics where they differ from Python's: ASCII `\d`, `\w` and `\b`; JavaScript's whitespace set; `Math.round` instead of round-half-even; regex lengths counted in UTF-16 units, as a JavaScript regex counts them.

Where Python offers more, it uses it:

| | TypeScript | Python |
|---|---|---|
| Big integers | `bigint` for `terbilang` beyond 2^53 | any `int` |
| Money | `number` | `int`, `float`, or exact `Decimal` |
| Dates | ISO strings, `Date` (read in UTC) | ISO strings, `date`, `datetime` (read in its own timezone); a `date` in gives a `date` out |
| Match offsets | UTF-16 units | Python characters: `text[m.start:m.end] == m.value` |
| Names | `camelCase` | `snake_case`; `to_dict(camel=True)` for TypeScript keys |

## Performance

Pure Python, no regex compilation at call time: masking a chat message takes about 0.2 ms, a 4 KB prompt about 5 ms, and a log record through `SamaranFilter` about 0.1 ms. Large inputs run at roughly 0.3 to 1 MB per second, depending on how much personal data they hold, linear in size, including single-line JSON and hostile input such as a megabyte of labels on one line ([stress test](https://github.com/lokal-id/lokal/tree/main/evals/stress)). `import lokal` takes about 0.1 s; region data loads on first use in about 0.25 s and 20 MB.

## Limitations

Samaran is pattern-based and favors precision: on free text it has not seen it catches about 82 to 88% of personal values. A name with no cue that is also an everyday word or is not a common Indonesian name, health or financial data phrased in a new way, and children's data that is not marked as such can still slip through. NIK and NPWP checks are structural, and holidays exist only for years whose SKB has been published (2026, 2027). See the [Lokal README](https://github.com/lokal-id/lokal#limitations) for the full list.

## License

Code: [MIT](https://github.com/lokal-id/lokal/blob/HEAD/LICENSE). Region data from [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) and postal codes from [cahyadsn/wilayah_kodepos](https://github.com/cahyadsn/wilayah_kodepos), both MIT, included in the package with their licenses.
