# Privacy policy: Lokal browser extension

Last updated: 22 October 2026

Lokal is an open-source extension that masks Indonesian personal data before you send it to AI chat sites. This policy covers the extension only.

## What the extension handles

On the AI chat sites it runs on, the extension reads text you paste or type into the message box and the text of the conversation, to find personal data such as ID numbers (NIK, KK, NPWP), phone numbers, bank accounts, names, addresses, and health data.

## What it keeps, and where

- **The mapping from placeholders to real values** (for example `[NIK_1]` → the NIK you pasted), so it can show and copy the real values for you. It is kept in the browser's session storage, in memory only. It is never written to disk and is deleted when you close the browser, or when you choose **Forget all real values**.
- **Your settings**: the sites where you paused the extension, in the browser's local storage.

## What it does not do

- It sends nothing to Lokal or to anyone else. It has no server, no account, no analytics, and makes no network requests.
- It does not sell, share, or transfer any data, and does not use it for any purpose other than masking and restoring it for you.
- It does not write real values into the pages of the AI sites.

What you send to an AI site, masked or not, is governed by that site's own privacy policy.

## Contact

Questions and reports: https://github.com/lokal-id/lokal/issues, or see [SECURITY.md](https://github.com/lokal-id/lokal/blob/main/SECURITY.md) for security issues.
