---
name: lokal-indonesia
description: Conventions and real data for building software used in Indonesia — Rupiah formatting, Indonesian phone numbers, NIK/NPWP validation, address forms (provinsi → kabupaten/kota → kecamatan → kelurahan/desa → kode pos), national holidays and working days, time zones (WIB/WITA/WIT), local payment methods (QRIS, Virtual Account, e-wallets), UI copy in Bahasa Indonesia, and UU PDP privacy. Use when building, generating, or reviewing any app, form, checkout, invoice, dashboard, chatbot, SLA/delivery estimate, or seed data for Indonesian users or written in Bahasa Indonesia — even if the user does not say "Indonesia" but the copy, currency, or audience is Indonesian.
---

# Building for Indonesia

Defaults that are right for the US are wrong here: there is no "State" or "ZIP code", money has no cents, phone numbers are WhatsApp accounts, the national ID is a structured 16-digit number, and the holiday calendar changes every year. Apply these conventions without being asked whenever the product targets Indonesian users.

## Use real data, not memory

Region names, kode pos, and holiday dates are exactly the facts models get subtly wrong. If the `lokal` MCP tools are available, call them:

| Need | Tool |
|---|---|
| Validate or decode a NIK | `parse_nik` |
| Validate NPWP / convert to 16 digits | `validate_npwp` |
| Normalize a phone number, detect operator | `parse_phone` |
| Format Rupiah, spell it out (terbilang) | `format_rupiah` |
| Read amounts like "2jtan", "goceng", "sejuta setengah" | `parse_rupiah` |
| Region names and codes, cascading address data | `search_wilayah`, `list_wilayah` |
| Kode pos of a kelurahan, or villages of a kode pos | `lookup_kode_pos` |
| A typed address → kelurahan, kecamatan, kota, provinsi, and their codes; checking a kode pos | `parse_alamat` |
| Libur nasional and cuti bersama | `list_holidays` |
| SLA / delivery dates in working days | `working_days` |

In application code, use the library instead of copying values into the code:

- `@lokal-id/core` (browser-safe): `parseNik`, `parseNpwp`, `parsePhone`, `formatRupiah`, `parseRupiah`, `terbilang`, `getHolidays`, `isWorkingDay`, `addWorkingDays`, `Samaran`.
- `@lokal-id/core/wilayah` (Node): `listWilayah`, `searchWilayah`, `getWilayah`, `findByPostalCode`, `postalCodesIn`, `parseAlamat`. Ships Kemendagri data: 38 provinces, 514 kabupaten/kota, 7,285 kecamatan, 83,762 kelurahan/desa, each with its kode pos.

Never hardcode a list of provinces, cities, kode pos, or holidays from memory.

Stack-specific code (Next.js, Laravel/PHP) is in `references/stacks.md`.

## Money

- Format: `Rp1.500.000` — dot for thousands, comma for decimals, no cents in UI. `Rp 1.500.000` (with a space) is also common; pick one and keep it.
- `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 })` gives `Rp 1.500.000` (with a non-breaking space). Set both fraction options explicitly: the default number of IDR decimals differs between ICU versions, so some browsers print `,00`.
- Short form for cards and charts: `Rp1,5 jt`, `Rp2,3 M` (M = miliar, not million), `Rp15 rb`.
- Store amounts as integers (BIGINT rupiah). Never floats.
- Receipts, invoices, and kuitansi spell the amount: "Satu Juta Lima Ratus Ribu Rupiah" (`terbilang`).
- Users type amounts loosely ("50rb", "1,5jt", "2jtan"); accept them in search, chat, and price inputs with `parseRupiah`.

## Phone numbers

- Accept `0812…`, `+62 812…`, `62812…`, with spaces or dashes. Store E.164 (`+6281234567890`). Display `0812-3456-7890`.
- Mobile numbers are 10–13 digits starting `08`. The number is usually also the user's WhatsApp and e-wallet (DANA, OVO, GoPay) account.
- WhatsApp is the default support and notification channel; OTP over WhatsApp is normal. Link with `https://wa.me/6281234567890` (no `+`, no leading 0).
- Label the field "Nomor HP" or "Nomor WhatsApp", not "Phone".

## Identity numbers

- NIK: 16 digits = province (2) + kabupaten/kota (2) + kecamatan (2) + birth date DDMMYY (women: day + 40) + serial (4). Validate structure with `parseNik`; it cannot confirm the person exists.
- NPWP: individuals now use their NIK as NPWP; entities use 16 digits (old 15-digit NPWP with a leading 0). Accept both forms, store the 16-digit form.
- NIK, KK, KTP photos, and selfies-with-KTP are high-value targets. Never use NIK as a primary key, URL parameter, or log field. Mask in UI: `3201********0001`.
- Do not ask for NIK unless the feature legally needs it (KYC, BPJS, tax). Asking for it "just in case" breaks data minimization under UU PDP.

## Addresses

Indonesian address forms are cascading, not free-form "State/City/ZIP":

1. Provinsi
2. Kabupaten/Kota
3. Kecamatan (called "Distrik" in Papua)
4. Kelurahan/Desa
5. Kode Pos — filled automatically from the chosen kelurahan/desa, still editable
6. Alamat lengkap: street, number, RT/RW, building — e.g. `Jl. Mawar No. 5, RT 003/RW 007`
7. Patokan (landmark), optional but valued by couriers: "depan masjid", "pagar hijau"

Populate 1–5 from `list_wilayah` / `listWilayah()` (each level filtered by the previous code; kelurahan/desa entries carry `postalCode`). Store the Kemendagri codes as well as the names. See `references/address-form.md`.

## Dates, time, and holidays

- Display: `15 Oktober 2026` or `15/10/2026` (day first). `Intl.DateTimeFormat('id-ID', { dateStyle: 'long' })` handles month names.
- Days: Senin, Selasa, Rabu, Kamis, Jumat, Sabtu, Minggu. Week starts Monday.
- Time is 24-hour. `id-ID` formats it as `14.30`; `14:30` is also accepted in UI.
- Three time zones, no daylight saving: WIB (UTC+7, `Asia/Jakarta`), WITA (UTC+8, `Asia/Makassar`), WIT (UTC+9, `Asia/Jayapura`). Label times with the zone whenever users span regions (deliveries, webinars, appointments).
- Holidays come from a yearly joint decree (SKB 3 Menteri), published around September for the next year, and Islamic dates can still shift after the government's sidang isbat. Use `getHolidays` / `addWorkingDays`; they throw for years without an official decree rather than guess. Keep holiday data updatable without a redeploy (config or database) in long-lived systems.
- Cuti bersama is a day off for civil servants; for private companies it is optional and taken from annual leave. Make it a setting in SLA and payroll logic.

## Payments

Card payment is a minority. Offer, through a gateway such as Midtrans or Xendit:

- QRIS (one QR that every bank app and e-wallet can pay)
- Virtual Account per bank (BCA, Mandiri, BRI, BNI, …) with an expiry time
- E-wallets: GoPay, OVO, DANA, ShopeePay, LinkAja
- Retail outlets (Alfamart, Indomaret) and, in e-commerce, COD and paylater

To read a QRIS payload, or to turn a merchant's static QRIS into a dynamic one for an amount, use the `parse_qris` and `set_qris_amount` tools (or `parseQris` / `setQrisAmount` from `@lokal-id/core`): the TLV lengths and the CRC-16 checksum are easy to get wrong by hand, and a wrong CRC makes every bank app reject the code. A dynamic QRIS made this way still pays the same merchant account; for payments you need to confirm automatically, use the gateway's own QRIS API and webhooks.

Payment completion is asynchronous: design order states around webhooks (`menunggu pembayaran` → `dibayar` → `kedaluwarsa`), verify webhook signatures, and show the VA number with a copy button and a countdown.

## UI copy in Bahasa Indonesia

- Choose one register for the whole product and never mix it: formal "Anda" (banking, government, B2B) or casual "kamu" (consumer, youth, social). Mixed "Anda"/"kamu" on one screen is the most common sign of machine-written copy.
- Write it the way a native product team would, not translated from English. Prefer short verbs: "Simpan", not "Lakukan Penyimpanan".
- Errors say what to do: "Nomor HP belum valid. Contoh: 0812-3456-7890."
- Use standard spelling (KBBI): risiko, praktik, analisis, aktivitas, kualitas, izin, karier, nasihat, apotek, Jumat, kedaluwarsa.
- Standard terms (Masuk, Daftar, Keluar, Simpan, Batal, …) are in `references/ui-copy.md`.

## Privacy (UU PDP)

UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi has applied in full since 17 October 2024. Build these in from the start; details and article references are in `references/uu-pdp.md`.

- Collect the minimum, state the purpose, and record consent (an unticked checkbox with the purpose next to it — never pre-ticked).
- Health, biometric, genetic, criminal-record, children's, and personal financial data are "data pribadi spesifik": collect only with a clear need, restrict access, and encrypt at rest.
- Children's data needs consent from a parent or guardian.
- Mask NIK, phone, and account numbers in logs and admin screens (`maskPii(text, { mode: 'partial' })`).
- Sending personal data to an LLM API hosted abroad is a cross-border transfer. Mask it first with Samaran (see the `samaran` skill).
- Give users a way to see, correct, and delete their data, and to withdraw consent.
- A data breach must be notified to affected users and the authority within 3 × 24 hours: log enough to know who was affected.
