// Pure helpers shared by the content script, the service worker, and the popup. No DOM or extension APIs here, so
// node:test can cover them.
import type { PiiType } from '../../core/src/samaran/types.ts';

/** Same shape as Samaran's placeholders: [NIK_1], [PHONE_12], [BANK_ACCOUNT_3]. */
export const PLACEHOLDER = /\[([A-Z_]+_\d+)\]/g;

export type Vault = ReadonlyMap<string, string>;

/** Messages from the content scripts and the popup to the service worker, which owns the vault. */
export type Request =
  | { type: 'mask'; text: string }
  | { type: 'vault' }
  | { type: 'clear' }
  | { type: 'stats' };

export interface MaskResponse {
  text: string;
  /** Types of the values that were masked, one entry per value found, in order. */
  types: PiiType[];
  vault: Array<[string, string]>;
}

export interface Stats {
  /** Values masked since the browser started. */
  masked: number;
  /** Distinct values the vault can restore. */
  known: number;
}

/** Puts the original values back. Unknown placeholders stay as they are. */
export function restore(text: string, vault: Vault): string {
  return text.replace(PLACEHOLDER, (whole) => vault.get(whole) ?? whole);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** For the text/html part of a copy: values are escaped, so a name like `<b>` stays text. */
export function restoreHtml(html: string, vault: Vault): string {
  return html.replace(PLACEHOLDER, (whole) => {
    const value = vault.get(whole);
    return value === undefined ? whole : escapeHtml(value);
  });
}

/** Where the known placeholders are in a text: [start, end, placeholder]. */
export function findPlaceholders(text: string, vault: Vault): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (vault.has(m[0])) out.push([m.index, m.index + m[0].length, m[0]]);
  }
  return out;
}

export function hasKnownPlaceholder(text: string, vault: Vault): boolean {
  return findPlaceholders(text, vault).length > 0;
}

export type Lang = 'id' | 'en';

export function pickLang(locale: string | undefined): Lang {
  return locale?.toLowerCase().startsWith('id') || locale?.toLowerCase().startsWith('ms') ? 'id' : 'en';
}

const LABELS: Partial<Record<PiiType, { id: string; en: string; enMany?: string }>> = {
  NAME: { id: 'nama', en: 'name', enMany: 'names' },
  PHONE: { id: 'nomor HP', en: 'phone number', enMany: 'phone numbers' },
  EMAIL: { id: 'email', en: 'e-mail', enMany: 'e-mails' },
  ADDRESS: { id: 'alamat', en: 'address', enMany: 'addresses' },
  BIRTH_DATE: { id: 'tanggal lahir', en: 'birth date', enMany: 'birth dates' },
  BANK_ACCOUNT: { id: 'rekening', en: 'bank account', enMany: 'bank accounts' },
  CARD: { id: 'kartu', en: 'card', enMany: 'cards' },
  HEALTH: { id: 'data kesehatan', en: 'health data' },
  FINANCIAL: { id: 'data keuangan', en: 'financial data' },
  RELIGION: { id: 'agama', en: 'religion' },
  MARITAL_STATUS: { id: 'status perkawinan', en: 'marital status' },
  GENDER: { id: 'jenis kelamin', en: 'gender' },
  NATIONALITY: { id: 'kewarganegaraan', en: 'nationality' },
  CRIMINAL_RECORD: { id: 'catatan kriminal', en: 'criminal record', enMany: 'criminal records' },
  BIOMETRIC: { id: 'data biometrik', en: 'biometric data' },
  PLATE: { id: 'pelat nomor', en: 'licence plate' },
  PASSPORT: { id: 'paspor', en: 'passport' },
  NISN: { id: 'NISN', en: 'student number', enMany: 'student numbers' },
  AKTA: { id: 'nomor akta', en: 'civil registry deed number', enMany: 'civil registry deed numbers' },
  GEO: { id: 'lokasi', en: 'location' },
  IP: { id: 'alamat IP', en: 'IP address' },
};

/** "2 NIK, 1 nomor HP": what was masked, most frequent first, without the values. */
export function describe(types: readonly PiiType[], lang: Lang): string {
  const counts = new Map<PiiType, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => {
      const label = LABELS[t];
      // Indonesian nouns do not change; English ones do, except mass nouns like "health data".
      return `${n} ${(lang === 'en' && n > 1 && label?.enMany) || label?.[lang] || t}`;
    })
    .join(', ');
}

export const TEXT = {
  id: {
    masked: (what: string) => `Lokal menyamarkan ${what} sebelum dikirim.`,
    maskedOnSend: (what: string) => `Lokal menyamarkan ${what}. Periksa pesannya, lalu kirim lagi.`,
    copied: 'Disalin dengan data asli.',
    failed: 'Lokal gagal menyamarkan, jadi tidak ada yang ditempel. Muat ulang halaman lalu coba lagi.',
    replaceFailed: 'Lokal tidak bisa mengganti teks di kotak ini, jadi pesannya ditahan. Hapus pesannya, lalu tempel (Ctrl+V) teksnya agar disamarkan.',
    reveal: 'Data asli, hanya terlihat olehmu',
    checkingFiles: 'Lokal memeriksa lampiran…',
    maskedFiles: (what: string, files: string) => `Lokal menyamarkan ${what} di ${files} sebelum diunggah.`,
    convertedFiles: 'Spreadsheet, dokumen Word, dan PDF diunggah sebagai teks (CSV atau TXT).',
    scannedPages: (pages: string) => `Halaman ${pages} berupa hasil scan, jadi tidak ikut diunggah.`,
    unreadableFile: (file: string, why: string) => `Lokal tidak bisa memeriksa ${file} (${why}), jadi file itu diunggah apa adanya.`,
    why: { 'too-large': 'lebih dari 20 MB', scanned: 'PDF hasil scan', encrypted: 'dilindungi kata sandi', damaged: 'file rusak' },
    fileFailed: 'Lokal gagal menyamarkan lampiran, jadi tidak ada yang diunggah. Muat ulang halaman lalu coba lagi.',
  },
  en: {
    masked: (what: string) => `Lokal masked ${what} before sending.`,
    maskedOnSend: (what: string) => `Lokal masked ${what}. Check the message, then send it again.`,
    copied: 'Copied with the real values.',
    failed: 'Lokal could not mask this, so nothing was pasted. Reload the page and try again.',
    replaceFailed: 'Lokal could not replace the text in this box, so the message is held. Delete it, then paste the text (Ctrl+V) to have it masked.',
    reveal: 'Real value, visible only to you',
    checkingFiles: 'Lokal is checking the attachment…',
    maskedFiles: (what: string, files: string) => `Lokal masked ${what} in ${files} before uploading.`,
    convertedFiles: 'Spreadsheets, Word documents, and PDFs are uploaded as text (CSV or TXT).',
    scannedPages: (pages: string) => `Pages ${pages} are scans, so they were left out.`,
    unreadableFile: (file: string, why: string) => `Lokal could not check ${file} (${why}), so it was uploaded as it is.`,
    why: { 'too-large': 'over 20 MB', scanned: 'a scanned PDF', encrypted: 'password-protected', damaged: 'damaged' },
    fileFailed: 'Lokal could not mask the attachment, so nothing was uploaded. Reload the page and try again.',
  },
} as const;
