import type { Issue } from './nik.ts';

export type PhoneType = 'mobile' | 'landline';

export interface PhoneInfo {
  input: string;
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  type?: PhoneType;
  /** +6281234567890 — store this. */
  e164?: string;
  /** 0812-3456-7890 — show this. */
  national?: string;
  /** For wa.me links: 6281234567890 */
  whatsapp?: string;
  /**
   * Original operator of the prefix. Indonesia has no mobile number portability (as of October 2026 it is
   * only a pending Constitutional Court case, 319/PUU-XXIV/2026), so a prefix still tells the operator.
   */
  operator?: string;
  /** Operator group after the Indosat–Tri (2022) and XL–Smartfren (2025) mergers. */
  group?: string;
  areaCode?: string;
  area?: string;
}

const MOBILE_PREFIXES: Array<[string[], string, string]> = [
  [['0811', '0812', '0813', '0821', '0822', '0823', '0851', '0852', '0853'], 'Telkomsel', 'Telkomsel'],
  [['0814', '0815', '0816', '0855', '0856', '0857', '0858'], 'Indosat', 'Indosat Ooredoo Hutchison'],
  [['0895', '0896', '0897', '0898', '0899'], 'Tri', 'Indosat Ooredoo Hutchison'],
  [['0817', '0818', '0819', '0859', '0877', '0878'], 'XL', 'XLSmart'],
  [['0831', '0832', '0833', '0838'], 'Axis', 'XLSmart'],
  [['0881', '0882', '0883', '0884', '0885', '0886', '0887', '0888', '0889'], 'Smartfren', 'XLSmart'],
];

const OPERATOR_BY_PREFIX = new Map<string, { operator: string; group: string }>();
for (const [prefixes, operator, group] of MOBILE_PREFIXES) {
  for (const p of prefixes) OPERATOR_BY_PREFIX.set(p, { operator, group });
}

const AREA_CODES: Record<string, string> = {
  '21': 'Jakarta',
  '22': 'Bandung',
  '24': 'Semarang',
  '31': 'Surabaya',
  '61': 'Medan',
  '251': 'Bogor',
  '254': 'Serang',
  '271': 'Surakarta',
  '274': 'Yogyakarta',
  '341': 'Malang',
  '361': 'Denpasar',
  '411': 'Makassar',
  '511': 'Banjarmasin',
  '541': 'Samarinda',
  '542': 'Balikpapan',
  '711': 'Palembang',
  '751': 'Padang',
  '761': 'Pekanbaru',
  '778': 'Batam',
};

/**
 * Parses an Indonesian phone number written any common way:
 * 0812-3456-7890, +62 812 3456 7890, 6281234567890, (021) 555-1234.
 */
export function parsePhone(input: string): PhoneInfo {
  const info: PhoneInfo = { input, valid: false, errors: [], warnings: [] };
  const clean = String(input).trim().replace(/[\s().\-]/g, '');

  let rest: string;
  if (clean.startsWith('+62')) rest = clean.slice(3);
  else if (clean.startsWith('62') && clean.length >= 10) rest = clean.slice(2);
  else if (clean.startsWith('0')) rest = clean.slice(1);
  else if (clean.startsWith('8')) rest = clean;
  else {
    info.errors.push({ code: 'format', message: 'Nomor harus diawali 0, 62, atau +62.' });
    return info;
  }
  rest = rest.replace(/^0+/, '');

  if (!/^\d+$/.test(rest)) {
    info.errors.push({ code: 'format', message: 'Nomor telepon hanya boleh berisi angka.' });
    return info;
  }

  if (rest.startsWith('8')) {
    info.type = 'mobile';
    if (rest.length < 9 || rest.length > 12) {
      info.errors.push({ code: 'length', message: 'Nomor HP harus 10–13 digit (termasuk 0 di depan).' });
      return info;
    }
    const op = OPERATOR_BY_PREFIX.get(`0${rest.slice(0, 3)}`);
    if (op) {
      info.operator = op.operator;
      info.group = op.group;
    } else {
      info.warnings.push({ code: 'prefix_unknown', message: `Prefix 0${rest.slice(0, 3)} tidak dikenal.` });
    }
    const national = `0${rest}`;
    info.national = `${national.slice(0, 4)}-${national.slice(4, 8)}-${national.slice(8)}`;
  } else if (/^[2-79]/.test(rest)) {
    info.type = 'landline';
    if (rest.length < 7 || rest.length > 11) {
      info.errors.push({ code: 'length', message: 'Panjang nomor telepon rumah tidak valid.' });
      return info;
    }
    const area = [rest.slice(0, 2), rest.slice(0, 3)].find((c) => AREA_CODES[c]);
    if (area) {
      info.areaCode = `0${area}`;
      info.area = AREA_CODES[area];
      info.national = `(0${area}) ${rest.slice(area.length)}`;
    } else {
      info.national = `0${rest}`;
    }
  } else {
    info.errors.push({ code: 'format', message: 'Nomor telepon Indonesia tidak valid.' });
    return info;
  }

  info.e164 = `+62${rest}`;
  if (info.type === 'mobile') info.whatsapp = `62${rest}`;
  info.valid = true;
  return info;
}

/** Normalizes to E.164 (+62...), or returns undefined when the number is invalid. */
export function normalizePhone(input: string): string | undefined {
  return parsePhone(input).e164;
}
