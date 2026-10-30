export type PiiType =
  // Identifiers
  | 'NIK'
  | 'KK'
  | 'NPWP'
  | 'PASSPORT'
  | 'SIM'
  | 'NIP'
  | 'BPJS'
  | 'NISN'
  | 'AKTA'
  | 'PHONE'
  | 'EMAIL'
  | 'BANK_ACCOUNT'
  | 'CARD'
  | 'PLATE'
  | 'IP'
  | 'GEO'
  | 'NAME'
  | 'ADDRESS'
  | 'BIRTH_DATE'
  // Attributes listed in UU PDP Pasal 4
  | 'GENDER'
  | 'RELIGION'
  | 'MARITAL_STATUS'
  | 'NATIONALITY'
  | 'HEALTH'
  | 'FINANCIAL'
  | 'CRIMINAL_RECORD'
  | 'BIOMETRIC'
  // A team's own rules (CustomRule), masked under their own label: [EMPLOYEE_ID_1]
  | 'CUSTOM';

export const PII_TYPES: readonly PiiType[] = [
  'NIK', 'KK', 'NPWP', 'PASSPORT', 'SIM', 'NIP', 'BPJS', 'NISN', 'AKTA', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CARD', 'PLATE', 'IP',
  'GEO', 'NAME', 'ADDRESS', 'BIRTH_DATE', 'GENDER', 'RELIGION', 'MARITAL_STATUS', 'NATIONALITY', 'HEALTH',
  'FINANCIAL', 'CRIMINAL_RECORD', 'BIOMETRIC', 'CUSTOM',
];

/**
 * UU PDP (UU 27/2022) Pasal 4: "spesifik" data needs stricter handling (health, biometrics, genetics,
 * criminal records, children's data, personal finance). Everything else here is "umum" — general
 * personal data, including identifiers that single out a person when combined.
 */
export const UU_PDP_CATEGORY: Readonly<Record<PiiType, 'spesifik' | 'umum'>> = Object.fromEntries(
  PII_TYPES.map((t) => [
    t,
    ['HEALTH', 'BIOMETRIC', 'CRIMINAL_RECORD', 'FINANCIAL', 'BANK_ACCOUNT', 'CARD', 'NISN'].includes(t) ? 'spesifik' : 'umum',
  ]),
) as Record<PiiType, 'spesifik' | 'umum'>;

export type Confidence = 'high' | 'medium';

export interface PiiMatch {
  type: PiiType;
  start: number;
  end: number;
  value: string;
  confidence: Confidence;
  /** For CUSTOM matches: the rule's label, which names the placeholder. */
  label?: string;
}

/**
 * How much of an input a check could see. Every Lokal integration reports one of these, so "no personal data found"
 * is never confused with "never looked":
 * - `scanned`: all of it.
 * - `partial`: some of it, such as a PDF with scanned pages, or a request with an image in it.
 * - `unsupported`: none of it, because Lokal does not read this kind of input (.xls, archives, images, too large).
 * - `failed`: none of it, because this input could not be read although its kind is supported (damaged, encrypted).
 */
export type ScanStatus = 'scanned' | 'partial' | 'unsupported' | 'failed';

export const SCAN_STATUSES: readonly ScanStatus[] = ['scanned', 'partial', 'unsupported', 'failed'];
