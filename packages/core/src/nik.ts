import { PROVINCES } from './provinces.ts';

export type Gender = 'L' | 'P';

export interface Issue {
  code: string;
  message: string;
}

export interface NikInfo {
  input: string;
  /** The 16 digits, or undefined when the input does not contain exactly 16 digits. */
  nik?: string;
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Kemendagri codes encoded in the NIK: "32", "32.01", "32.01.01". */
  provinceCode?: string;
  regencyCode?: string;
  districtCode?: string;
  province?: string;
  regency?: string;
  district?: string;
  /** L = laki-laki, P = perempuan (day of birth + 40). */
  gender?: Gender;
  /** ISO date (YYYY-MM-DD). The century is inferred, see `referenceDate`. */
  birthDate?: string;
  serial?: string;
}

export interface ParseNikOptions {
  /** Resolve a Kemendagri code ("32.01") to its name. Pass `wilayahName` from `@lokal-id/core/wilayah`. */
  lookupWilayah?: (code: string) => string | undefined;
  /** Used to infer the century of the two-digit birth year. Defaults to now. */
  referenceDate?: Date;
}

/**
 * Parses and validates a NIK (Nomor Induk Kependudukan) by its structure:
 * PP KK CC DDMMYY SSSS — province, regency, district, birth date (+40 for women), serial.
 *
 * Structure checks cannot prove a NIK is registered at Dukcapil; they only reject
 * numbers that cannot be a NIK.
 */
export function parseNik(input: string, options: ParseNikOptions = {}): NikInfo {
  const info: NikInfo = { input, valid: false, errors: [], warnings: [] };
  const digits = String(input).replace(/[\s.-]/g, '');

  if (!/^\d{16}$/.test(digits)) {
    info.errors.push({ code: 'format', message: 'NIK harus terdiri dari 16 digit angka.' });
    return info;
  }
  info.nik = digits;

  const pp = digits.slice(0, 2);
  const kk = digits.slice(2, 4);
  const cc = digits.slice(4, 6);
  info.provinceCode = pp;
  info.regencyCode = `${pp}.${kk}`;
  info.districtCode = `${pp}.${kk}.${cc}`;

  const province = PROVINCES[pp];
  if (!province) {
    info.errors.push({ code: 'province', message: `Kode provinsi "${pp}" tidak dikenal.` });
  } else {
    info.province = province;
  }
  if (kk === '00' || cc === '00') {
    info.errors.push({ code: 'wilayah', message: 'Kode kabupaten/kota dan kecamatan tidak boleh 00.' });
  }

  const lookup = options.lookupWilayah;
  if (lookup && province) {
    info.regency = lookup(info.regencyCode);
    info.district = lookup(info.districtCode);
    if (!info.regency || !info.district) {
      // Codes change after pemekaran, and a NIK keeps the code it was issued with.
      info.warnings.push({
        code: 'wilayah_unknown',
        message: 'Kode wilayah tidak ada di data Kemendagri terbaru (bisa jadi kode lama sebelum pemekaran).',
      });
    }
  }

  let day = Number(digits.slice(6, 8));
  const month = Number(digits.slice(8, 10));
  const yy = Number(digits.slice(10, 12));
  if (day > 40) {
    info.gender = 'P';
    day -= 40;
  } else {
    info.gender = 'L';
  }

  const ref = options.referenceDate ?? new Date();
  const year = yy <= ref.getFullYear() % 100 ? 2000 + yy : 1900 + yy;
  const date = new Date(Date.UTC(year, month - 1, day));
  const realDate =
    day >= 1 && month >= 1 && month <= 12 && date.getUTCDate() === day && date.getUTCMonth() === month - 1;
  if (!realDate) {
    info.errors.push({ code: 'birth_date', message: 'Tanggal lahir di NIK tidak valid.' });
    info.gender = undefined;
  } else {
    info.birthDate = date.toISOString().slice(0, 10);
  }

  const serial = digits.slice(12);
  info.serial = serial;
  if (serial === '0000') {
    info.errors.push({ code: 'serial', message: 'Nomor urut NIK tidak boleh 0000.' });
  }

  info.valid = info.errors.length === 0;
  return info;
}

/** True when the input has a valid NIK structure. */
export function isValidNik(input: string): boolean {
  return parseNik(input).valid;
}
