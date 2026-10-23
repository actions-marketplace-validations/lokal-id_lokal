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
  | 'BIOMETRIC';

export const PII_TYPES: readonly PiiType[] = [
  'NIK', 'KK', 'NPWP', 'PASSPORT', 'SIM', 'NIP', 'BPJS', 'NISN', 'AKTA', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CARD', 'PLATE', 'IP',
  'GEO', 'NAME', 'ADDRESS', 'BIRTH_DATE', 'GENDER', 'RELIGION', 'MARITAL_STATUS', 'NATIONALITY', 'HEALTH',
  'FINANCIAL', 'CRIMINAL_RECORD', 'BIOMETRIC',
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
}
