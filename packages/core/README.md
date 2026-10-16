# @lokal-id/core

[![npm](https://img.shields.io/npm/v/@lokal-id/core?color=cb3837)](https://www.npmjs.com/package/@lokal-id/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/lokal-id/lokal/blob/HEAD/LICENSE)

Indonesian data primitives for apps and AI agents: NIK, NPWP, phone numbers, Rupiah, *terbilang*, holidays and working days, Kemendagri regions with postal codes, and **Samaran**, which masks Indonesian personal data before it reaches an LLM and restores it afterwards.

No dependencies. Part of [Lokal](https://github.com/lokal-id/lokal) · [Bahasa Indonesia](https://github.com/lokal-id/lokal/blob/HEAD/README.id.md)

## Install

```sh
npm install @lokal-id/core
```

For Python backends there is a port with identical results: `pip install lokal-id` ([docs](https://github.com/lokal-id/lokal/tree/HEAD/python#readme)).

## Usage

```ts
import { parseNik, parsePhone, formatRupiah, parseRupiah, terbilang, addWorkingDays, Samaran } from '@lokal-id/core';
import { listWilayah, searchWilayah, wilayahName, findByPostalCode } from '@lokal-id/core/wilayah';

parseNik('3201011508950001', { lookupWilayah: wilayahName });
// { valid: true, province: 'Jawa Barat', regency: 'Kabupaten Bogor', gender: 'L', birthDate: '1995-08-15', … }
parsePhone('0812 3456 7890');           // { e164: '+6281234567890', operator: 'Telkomsel', … }
formatRupiah(1500000);                  // 'Rp1.500.000'
parseRupiah('sejuta setengah');         // { amount: 1500000, approximate: false }
terbilang(1500000, { currency: true }); // 'satu juta lima ratus ribu rupiah'
addWorkingDays('2026-03-17', 1);        // '2026-03-25', skipping Nyepi and Lebaran
listWilayah('32.76');                   // districts of Kota Depok
findByPostalCode('16431');              // villages that use this postal code
```

### Samaran

```ts
const samaran = new Samaran();
const { text } = samaran.mask('nama saya budi santoso, NIK 3201011508950001, HP 0812-3456-7890');
// 'nama saya [NAME_1], NIK [NIK_1], HP [PHONE_1]'

samaran.unmask(await llm(text));        // placeholders are replaced with the original values
```

The same value always gets the same placeholder, so the model can still deduplicate and join. Use `mode: 'partial'` for logs and admin screens (`3201********0001`).

`@lokal-id/core/wilayah` loads about 4.4 MB of region data and runs on Node only. The main entry point does not load it and is safe for browsers.

## Data

| Data | Source |
|---|---|
| Regions: 38 provinces, 416 regencies, 98 cities, 7,285 districts, 8,496 *kelurahan*, 75,266 villages | [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) (MIT), following Kepmendagri 300.2.2-2138/2025 |
| Postal codes for all 83,762 villages | [cahyadsn/wilayah_kodepos](https://github.com/cahyadsn/wilayah_kodepos) (MIT) |
| Holidays and *cuti bersama* for 2026 and 2027 | SKB 3 Menteri. Other years return an error, not a guess |

Detection limits and full documentation are in the [Lokal README](https://github.com/lokal-id/lokal#limitations).

## License

[MIT](https://github.com/lokal-id/lokal/blob/HEAD/LICENSE)
