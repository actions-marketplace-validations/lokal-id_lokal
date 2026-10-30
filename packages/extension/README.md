# Lokal for the browser

A browser extension that keeps Indonesian personal data out of AI chats. It uses Samaran, the same detection as the rest of Lokal, and runs entirely in your browser.

It works on ChatGPT, Claude, Gemini (and AI Studio), Microsoft Copilot, Perplexity, DeepSeek, Grok, and Le Chat, in Chrome, Edge, Brave, Opera, and other Chromium browsers.

<img src="../../docs/assets/extension-demo.gif" alt="Customer data is pasted into an AI chat. The extension masks names, NIK numbers, and phone numbers before the message is sent, the AI answers with placeholders, pointing at one shows the real value, and copying the answer brings the real values back." width="100%">

## What it does

- **Pasting.** When the pasted text contains personal data (NIK, KK, NPWP, phone numbers, bank accounts, names, addresses, health data, and the other UU PDP categories), the site receives it with placeholders instead: `Nama: [NAME_1], NIK [NIK_1]`. Text without personal data is pasted as it is.
- **Typing.** When a message you typed contains personal data, Enter or the send button masks it first and waits. Check the message, then send it again.
- **Reading the answer.** Placeholders in the conversation are highlighted. Point at one to see the real value.
- **Copying.** Ctrl+C, and the site's own copy buttons, put the answer on the clipboard with the real values back.
- **Attachments.** A file chosen with the site's attach button, dropped on the page, or pasted is checked before the site gets it. Text files (CSV, JSON, logs, SQL, code) are masked and keep their name. An Excel file becomes one masked CSV per sheet, and a Word document or a PDF with a text layer becomes one masked text file, since the extension cannot write `.xlsx`, `.docx`, or PDF. A file without personal data is uploaded unchanged.
- **Consistent placeholders.** The same NIK is `[NIK_1]` in every tab, so the model can still compare and join records.

The real values are **never written into the site's page**, where the site's own scripts could read them. They stay in the extension: highlighted placeholders in the page, the value in a tooltip the page cannot read, and the clipboard when you copy.

## Install

The extension is not in the Chrome Web Store yet. To install it:

1. Download `lokal-extension-<version>.zip` from the [latest release](https://github.com/lokal-id/lokal/releases/latest) and unzip it into a folder you keep. The browser loads the extension from that folder, so do not delete it.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Choose **Load unpacked** and select the unzipped folder.

To build it from source instead:

```sh
git clone https://github.com/lokal-id/lokal && cd lokal
npm ci --ignore-scripts
npm run build:extension
```

Then load `packages/extension/dist` the same way.

## Privacy

- No server, no account, no analytics. The extension makes no network requests.
- Detection and masking happen on your device. The mapping from placeholders to real values is kept in the browser's session memory (`chrome.storage.session`). It is never written to disk and is gone when the browser closes. **Forget all real values** in the popup clears it immediately.
- Permissions: `storage` for the per-site on/off setting and the session mapping, `activeTab` so the popup can tell which site you are on, and access to the AI chat sites listed above. See [PRIVACY.md](PRIVACY.md).

## Limitations

- **Images, scanned PDFs, and some files are not masked.** A scanned or password-protected PDF, a damaged document, a file over 20 MB, and a photo whose name says it is an ID document (`ktp-budi.jpg`, `selfie_kyc.png`, `npwp.png`) are held: the browser asks whether to upload them as they are, and Cancel leaves them out. Other photos, an old `.xls` or `.doc`, and archives are uploaded as they are, since the extension cannot tell a KTP photo from a screenshot except by its name. Formatting and formulas of an Excel file with personal data are lost in the masked CSV.
- **Rules in `.samaran.json` do not apply here.** The extension has no access to your project files; it uses the built-in types only.
- A site that opens its own file picker without a file input on the page, or reads files inside a shadow root, is not covered. It works with the file inputs, drop zones, and paste handlers these sites use today, tested on a page that behaves like them.
- Text dropped by drag and drop is not masked.
- Detection is pattern-based (see [Limitations](https://github.com/lokal-id/lokal#limitations)). A name with no label or cue around it can slip through.
- After the browser restarts, old conversations show placeholders that can no longer be restored.
- AI sites change their editors often. The extension uses no site-specific code for pasting and sending. It is tested end to end in Edge on a page that behaves like these editors (`npm run test:extension`), but has not been verified on every site after every change. Please [report](https://github.com/lokal-id/lokal/issues) a site where it misbehaves, with made-up data only.
- Firefox is not supported yet.

## Development

```sh
npm run build:extension      # dist/ and release/lokal-extension-<version>.zip
npm run test:extension       # loads dist-test/ into Edge or Chrome and drives a test page
```

`src/content.ts` handles pasting, sending, highlighting, and copying; `src/background.ts` owns the vault; `src/page-clipboard.ts` runs in the page to see the site's own clipboard writes (it only ever sees placeholders).
