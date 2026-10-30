# Chrome Web Store listing

The text and answers for publishing the extension in the Chrome Web Store, kept here so every release is submitted with the same answers. Publishing needs a Chrome Web Store developer account for the lokal-id organization, which has a one-time registration fee and requires 2-step verification. Upload the zip attached to the GitHub release (`lokal-extension-<version>.zip`), which is built by CI from the tagged commit.

## Store listing

**Name** (from the manifest): Lokal: keep Indonesian personal data out of AI chats

**Summary** (from the manifest, at most 132 characters): Masks NIK, phone numbers, bank accounts, names, and UU PDP data before you send them to ChatGPT, Claude, or Gemini. Runs offline.

**Description, English:**

> Paste a customer list, a support ticket, or a log into an AI chat, and the AI provider gets the NIK numbers, phone numbers, and health notes in it. Lokal masks them first, in your browser.
>
> • Pasting, typing, and attachments: Indonesian personal data (NIK, KK, NPWP, phone numbers, bank accounts, BPJS, names, addresses, health, finances, religion, and the other UU PDP categories) becomes placeholders such as [NIK_1] before the site receives it.
> • Answers: placeholders are highlighted, and pointing at one shows the real value. Copying an answer puts the real values back.
> • Attachments: CSV, JSON, logs, Excel, Word, and PDFs with a text layer are checked before upload, and masked when they hold personal data.
> • The same value gets the same placeholder in every tab, so the AI can still compare records.
>
> Works on ChatGPT, Claude, Gemini, AI Studio, Microsoft Copilot, Perplexity, DeepSeek, Grok, and Le Chat.
>
> Private by design: no server, no account, no analytics, no network requests. Real values are kept in the browser's memory only and never written into the AI site's page. Open source (MIT): https://github.com/lokal-id/lokal
>
> Limits: photos and scanned PDFs cannot be read, and detection is not perfect. Check the masked message before you send it.

**Description, Bahasa Indonesia** (for the `id` locale listing):

> Saat Anda menempelkan daftar pelanggan, tiket support, atau log ke chat AI, penyedia AI ikut menerima NIK, nomor HP, dan catatan kesehatan di dalamnya. Lokal menyamarkannya lebih dulu, di browser Anda.
>
> • Tempel, ketik, dan lampiran: data pribadi Indonesia (NIK, KK, NPWP, nomor HP, rekening bank, BPJS, nama, alamat, kesehatan, keuangan, agama, dan kategori UU PDP lainnya) diganti placeholder seperti [NIK_1] sebelum sampai ke situs.
> • Jawaban: placeholder disorot, dan nilai aslinya muncul saat kursor diarahkan ke sana. Saat jawaban disalin, nilai asli dikembalikan.
> • Lampiran: CSV, JSON, log, Excel, Word, dan PDF yang punya lapisan teks diperiksa sebelum diunggah, lalu disamarkan kalau berisi data pribadi.
> • Nilai yang sama mendapat placeholder yang sama di semua tab, jadi AI tetap bisa membandingkan data.
>
> Bekerja di ChatGPT, Claude, Gemini, AI Studio, Microsoft Copilot, Perplexity, DeepSeek, Grok, dan Le Chat.
>
> Privat sejak dirancang: tanpa server, tanpa akun, tanpa analitik, tanpa request jaringan. Nilai asli hanya disimpan di memori browser dan tidak pernah ditulis ke halaman situs AI. Open source (MIT): https://github.com/lokal-id/lokal
>
> Batasan: foto dan PDF hasil scan tidak bisa dibaca, dan deteksinya tidak sempurna. Periksa pesan yang sudah disamarkan sebelum mengirim.

**Category:** pick the privacy and security category if the dashboard offers one, otherwise Productivity.

**Language:** English, with the Indonesian listing added under the `id` locale.

## Graphics still to make

The dashboard requires:

- the 128×128 icon, which is `icons/128.png`;
- at least one screenshot at 1280×800 or 640×400;
- a 440×280 small promo tile.

Make the screenshots on a page you control that shows the extension at work: a masked paste, a highlighted placeholder with its tooltip, and the popup. Do not use a capture of a real AI site's interface, which is that company's design and could read as an endorsement. Use the made-up data from `examples/quickstart`, never real people.

## Privacy practices tab

**Single purpose:**

> Masks Indonesian personal data in what the user pastes, types, or attaches on AI chat sites, before the site receives it, and shows the real values back to the user only.

**Permission justifications:**

| Permission | Why |
|---|---|
| `storage` | `storage.session` holds the mapping from placeholders to real values, in memory only, so the same value gets the same placeholder in every tab and the user can see and copy the real values. `storage.local` holds the list of sites where the user paused the extension. |
| `activeTab` | When the user opens the popup, it reads the current tab's address to show whether the extension runs on that site and to let the user pause it there. |
| Host permissions (content scripts on chatgpt.com, chat.openai.com, claude.ai, gemini.google.com, aistudio.google.com, copilot.microsoft.com, perplexity.ai, chat.deepseek.com, grok.com, chat.mistral.ai) | The extension has to read what the user pastes, types, and attaches on these AI chat sites to mask personal data before the site sends it. It runs on no other site. |

**Remote code:** No. All code is in the package. The extension loads no script, model, or data from the network.

**Data usage.** The extension processes on the device the categories below, and transmits none of them to the developer or anyone else:

- personally identifiable information;
- health information;
- financial and payment information;
- website content.

Answer the dashboard's questions to match that. If a question asks what is *collected*, Google's definitions decide whether processing on the device alone counts; read them when you submit, and when in doubt declare the categories. Certify all three statements: the data is not sold to third parties, not used or transferred for purposes unrelated to the single purpose, and not used to determine creditworthiness or for lending.

**Privacy policy URL:** https://github.com/lokal-id/lokal/blob/main/packages/extension/PRIVACY.md

## Before each submission

- [ ] The version in the zip's `manifest.json` matches the GitHub release.
- [ ] `PRIVACY.md` still describes what the extension does. Update its date if anything changed.
- [ ] The permissions are unchanged, or this file explains the new ones.
- [ ] The extension tests passed in the release workflow.
