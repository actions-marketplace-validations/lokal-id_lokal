import { parseNik, type Issue, type NikInfo } from './nik.ts';

export type NpwpKind = 'npwp15' | 'npwp16' | 'nik';

export interface NpwpInfo {
  input: string;
  valid: boolean;
  errors: Issue[];
  /**
   * - `npwp15`: legacy 15-digit NPWP (XX.XXX.XXX.X-XXX.XXX)
   * - `npwp16`: 16-digit NPWP for entities and non-residents (legacy NPWP prefixed with 0)
   * - `nik`: individual residents, whose NPWP is their NIK since PMK 112/2022
   */
  kind?: NpwpKind;
  digits?: string;
  /** The 16-digit form used by DJP today. */
  npwp16?: string;
  /** Legacy dotted format, when the number has a 15-digit form. */
  formatted15?: string;
  nik?: NikInfo;
}

export function formatNpwp15(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12, 15)}`;
}

/** Validates an NPWP in its 15-digit legacy form or its 16-digit form (including NIK-as-NPWP). */
export function parseNpwp(input: string): NpwpInfo {
  const info: NpwpInfo = { input, valid: false, errors: [] };
  const digits = String(input).replace(/[\s.-]/g, '');

  if (!/^\d+$/.test(digits) || (digits.length !== 15 && digits.length !== 16)) {
    info.errors.push({ code: 'format', message: 'NPWP harus 15 digit (format lama) atau 16 digit.' });
    return info;
  }
  info.digits = digits;

  if (digits.length === 15) {
    info.kind = 'npwp15';
    info.npwp16 = `0${digits}`;
    info.formatted15 = formatNpwp15(digits);
  } else if (digits.startsWith('0')) {
    info.kind = 'npwp16';
    info.npwp16 = digits;
    info.formatted15 = formatNpwp15(digits.slice(1));
  } else {
    // A NIK never starts with 0 (province codes are 11–96).
    info.kind = 'nik';
    info.npwp16 = digits;
    info.nik = parseNik(digits);
    if (!info.nik.valid) {
      info.errors.push({
        code: 'nik',
        message: 'NPWP 16 digit yang tidak diawali 0 adalah NIK, tetapi struktur NIK-nya tidak valid.',
      });
    }
  }

  info.valid = info.errors.length === 0;
  return info;
}
