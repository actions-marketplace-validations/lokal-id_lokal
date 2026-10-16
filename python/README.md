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
from lokal.wilayah import list_wilayah, search_wilayah, wilayah_name, find_by_postal_code

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
- `export_vault()` / `import_vault()` move the vault between processes, for example through Redis. Treat it as the raw data it contains.
- `detect_pii(text)` returns the matches without masking; `min_confidence='high'` keeps only validated or keyword-anchored ones.
- 25 types, covering every category in UU PDP Article 4: identifiers (NIK, KK, NPWP, passport, SIM, NIP, BPJS, phone, email, bank account, card, plate, IP, coordinates), name, address, birth date, gender, religion, marital status, nationality, health, finances, criminal records, and biometrics. Found through labels, CSV headers, JSON/YAML keys, SQL `INSERT` dumps, WhatsApp chat exports, and common phrases in free text.

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

The test suite replays vectors generated from `@lokal-id/core`: hundreds of NIK, NPWP, phone, and Rupiah inputs, every day of 2026 and 2027, all 91,000 regions with their postal codes, and 2,700 texts for Samaran, including WhatsApp exports, SQL dumps, emoji, no-break spaces, and CRLF. Python must return exactly what TypeScript returns. On top of that, 40,000 random texts and 11 MB of real files gave identical matches during development.

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

Pure Python, no regex compilation at call time: masking a chat message takes about 0.2 ms, a 4 KB prompt about 5 ms, and a log record through `SamaranFilter` about 0.1 ms. Large inputs run at roughly 1 MB per second, linear in size, including single-line JSON. `import lokal` takes about 0.1 s; region data loads on first use in about 0.25 s and 20 MB.

## Limitations

Samaran is pattern-based and favors precision. A name dropped into a sentence with no cue at all, unusually phrased health or financial data, and children's data that is not marked as such can still slip through. NIK and NPWP checks are structural, and holidays exist only for years whose SKB has been published (2026, 2027). See the [Lokal README](https://github.com/lokal-id/lokal#limitations) for the full list.

## License

Code: [MIT](https://github.com/lokal-id/lokal/blob/HEAD/LICENSE). Region data from [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) and postal codes from [cahyadsn/wilayah_kodepos](https://github.com/cahyadsn/wilayah_kodepos), both MIT, included in the package with their licenses.
