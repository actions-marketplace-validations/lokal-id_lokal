// Field names that announce personal data: CSV headers, JSON/YAML keys, and labels in text
// ("Agama: Islam", "Tgl. Lahir: 15-08-1995", "customer_phone", "NAMA_IBU_KANDUNG").
import type { PiiType } from './types.ts';

const FIELDS: Array<[PiiType, string]> = [
  // A column called "pasien" or "pelanggan" holds that person's name.
  ['NAME', 'nama|name|full_?name|nama_?lengkap|first_?name|last_?name|middle_?name|given_?name|family_?name|surname|nama_?depan|nama_?tengah|nama_?belakang|nama_?panggilan|nickname|nama_?ibu_?kandung|mother_?s?_?maiden_?name|penerima|pengirim|recipient|pasien|patient|pelanggan|customer|nasabah|karyawan|employee|pegawai|siswa|mahasiswa|student|peserta|pemohon|debitur|pemilik|owner|pemesan|pembeli|buyer|konsumen|atas_?nama|a_n'],
  ['ADDRESS', 'alamat|address|full_?address|street|street_?address|domisili|alamat_?domisili|alamat_?ktp|alamat_?rumah|alamat_?pengiriman|shipping_?address|home_?address|billing_?address'],
  ['NIK', 'nik|no_?ktp|nomor_?ktp|ktp|nomor_?induk_?kependudukan|national_?id'],
  ['KK', 'kk|no_?kk|nomor_?kk|kartu_?keluarga|no_?kartu_?keluarga|nomor_?kartu_?keluarga|family_?card(_?number)?'],
  ['NPWP', 'npwp|no_?npwp|nomor_?npwp|tax_?id|tin'],
  ['PASSPORT', 'paspor|passport|no_?paspor|nomor_?paspor|passport_?(no|number)'],
  ['SIM', 'sim|no_?sim|nomor_?sim|driver_?s?_?licen[cs]e|driving_?licen[cs]e'],
  ['NIP', 'nip|nip_?baru|nrp|nomor_?induk_?pegawai'],
  ['BPJS', 'bpjs|no_?bpjs|nomor_?bpjs|bpjs_?kesehatan|bpjs_?ketenagakerjaan|kis|no_?kis|jkn|kpj'],
  ['PHONE', 'hp|no_?hp|nomor_?hp|nohp|telp|tlp|telepon|telpon|no_?telp|no_?telepon|nomor_?telepon|phone|phone_?number|mobile|mobile_?phone|handphone|whatsapp|wa|no_?wa|nomor_?wa|msisdn'],
  ['EMAIL', 'email|e_?mail|surel|alamat_?email|email_?address'],
  ['BANK_ACCOUNT', 'rekening|no_?rek|no_?rekening|nomor_?rekening|norek|rek|account_?number|bank_?account|account_?no|va|virtual_?account|no_?va'],
  ['CARD', 'card_?number|no_?kartu|nomor_?kartu|kartu_?kredit|credit_?card|cc_?number|pan'],
  ['IP', 'ip|ip_?address|ip_?addr|client_?ip|remote_?ip|remote_?addr|x_?forwarded_?for'],
  ['GEO', 'lat|lng|lon|latitude|longitude|koordinat|coordinates|coords|geo|geolocation|latlng|lat_?long'],
  ['BIRTH_DATE', 'tanggal_?lahir|tgl_?lahir|tgl_?lhr|tanggal_?kelahiran|tempat_?lahir|ttl|tempat_?tanggal_?lahir|tempat_?tgl_?lahir|tempat_?tgl_?lhr|date_?of_?birth|dob|birth_?date|birthdate|birthday|birth_?place|place_?of_?birth'],
  ['GENDER', 'jenis_?kelamin|jns_?kelamin|kelamin|gender|sex|jk|l_?p'],
  ['RELIGION', 'agama|religion|kepercayaan'],
  ['MARITAL_STATUS', 'status_?perkawinan|status_?kawin|status_?pernikahan|status_?nikah|perkawinan|marital_?status|status_?marital'],
  ['NATIONALITY', 'kewarganegaraan|warga_?negara|wn|nationality|citizenship'],
  ['HEALTH', 'diagnosa|diagnosis|diagnose|penyakit|riwayat_?penyakit|riwayat_?medis|rekam_?medis|kondisi_?medis|kondisi_?kesehatan|keluhan|gejala|alergi|allergy|allergies|golongan_?darah|gol_?darah|blood_?type|hasil_?lab|lab_?result|obat|medication|medications|resep|prescription|icd|icd_?10|medical_?history|medical_?record|disabilitas|disability|kehamilan|pregnancy|status_?vaksin|vaccination_?status|tindakan_?medis'],
  ['FINANCIAL', 'gaji|salary|penghasilan|pendapatan|income|saldo|balance|limit_?kredit|credit_?limit|utang|hutang|debt|pinjaman|loan|loan_?amount|cicilan|installment|tunggakan|arrears|skor_?kredit|credit_?score|slik|kolektibilitas|kekayaan|net_?worth|harta'],
  ['CRIMINAL_RECORD', 'catatan_?kriminal|catatan_?kepolisian|catatan_?pidana|skck|riwayat_?pidana|riwayat_?kriminal|criminal_?record|criminal_?history|status_?hukum'],
  // Not "signature" or "face": in code those are crypto signatures and UI faces.
  ['BIOMETRIC', 'sidik_?jari|fingerprint|foto_?ktp|foto_?wajah|foto_?selfie|selfie|selfie_?ktp|face_?image|face_?photo|face_?embedding|biometri|biometric|biometrik|iris|retina|dna|genetik|genetic|voiceprint|voice_?print|tanda_?tangan|ttd'],
];

// "nama_pelanggan", "customer_phone", "alamat_pengiriman": the field, optionally qualified by whose it is.
const ENTITY =
  'customer|pelanggan|nasabah|pasien|patient|user|pengguna|member|anggota|karyawan|employee|pegawai|siswa|student|mahasiswa|penerima|pengirim|recipient|sender|ibu|ayah|wali|orang_?tua|pemohon|applicant|debitur|peserta|pemilik|owner|contact|kontak|pemesan|pembeli|buyer|konsumen';
const QUALIFIER = `${ENTITY}|lengkap|baru|lama|asli|utama|rumah|kantor|ktp|domisili|pengiriman|pribadi|aktif|1|2`;

const KEY_RES: Array<[PiiType, RegExp]> = FIELDS.map(([type, alts]) => [
  type,
  new RegExp(`^(?:(?:${ENTITY})_)?(?:${alts})(?:_(?:${QUALIFIER}))?$`),
]);

export function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The kind of personal data a field name announces, if any. */
export function fieldType(key: string): PiiType | undefined {
  const k = normalizeKey(key);
  if (!k || k.length > 40) return undefined;
  for (const [type, re] of KEY_RES) if (re.test(k)) return type;
  return undefined;
}

/** `name` and `title`-like keys are everywhere in code; only a full name counts for them. */
export function isGenericNameKey(key: string): boolean {
  return /^(name|nickname)$/.test(normalizeKey(key));
}

/**
 * One part of a person's name, as payment gateways and CRMs split it (`"first_name":"Siti","last_name":"Rahayu"`).
 * A single capitalized word is the whole value here, so it counts.
 */
function isNamePartKey(key: string): boolean {
  return /^(?:(?:customer|billing|shipping|user|contact)_)?(?:first|last|middle|given|family)_?name$|^surname$/.test(normalizeKey(key));
}

// Form labels rather than a person: `first_name: "First Name"`, `last_name: "Nama Belakang"`.
const NAME_LABEL_WORDS = /^(?:first|last|middle|given|family|sur|name|nama|depan|belakang|tengah|lengkap|full)$/i;

const GENDER_WORD = /^(?:laki-?\s?laki|lelaki|perempuan|pria|wanita|male|female|man|woman|cowok|cewek)$/i;
const GENDER_VALUE = { test: (v: string) => /^[LPMF]$/.test(v) || GENDER_WORD.test(v) };
const DATE_KEY = /tanggal|tgl|date|dob|birthday|birthdate|ttl/;
const DATE_LIKE =
  /\d{1,4}[-/. ]\d{1,2}[-/. ]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\b(?:19|20)\d{2}\b/;

const ROLE_KEY =
  /^(pasien|patient|pelanggan|customer|nasabah|karyawan|employee|pegawai|siswa|mahasiswa|student|peserta|pemohon|debitur|pemilik|owner|penerima|pengirim|recipient|pemesan|pembeli|buyer|konsumen)$/;

const NICKNAME = /\s+\([A-Z]?[a-z][A-Za-z .'-]*\)$/; // "(Ami)", not an acronym like "(GSS)"
const EMPTY = /^(?:-+|null|none|nil|n\/?a|undefined|tidak ada|kosong|\?)$/i;
const TYPE_WORDS = new Set([
  'string', 'number', 'boolean', 'bool', 'int', 'integer', 'bigint', 'varchar', 'char', 'text', 'date', 'datetime',
  'timestamp', 'float', 'double', 'decimal', 'any', 'object', 'array', 'null', 'undefined', 'true', 'false', 'required',
  'optional', 'nullable', 'unique', 'str', 'list', 'dict', 'enum', 'json', 'uuid', 'unknown', 'void',
]);

const DIGIT_TYPES: ReadonlySet<PiiType> = new Set([
  'NIK', 'KK', 'NPWP', 'NIP', 'SIM', 'BPJS', 'PHONE', 'BANK_ACCOUNT', 'CARD',
]);

/** Values that are code, schema, or placeholders rather than someone's data. */
export function isPlausibleValue(type: PiiType, value: string, key: string): boolean {
  // "Siti Aminah (Ami)": a nickname in brackets is part of the name, not a function call.
  const v = type === 'NAME' ? value.trim().replace(NICKNAME, '') : value.trim();
  if (!v || EMPTY.test(v)) return false;
  if (TYPE_WORDS.has(v.toLowerCase())) return false;
  if (/^\[[A-Z_]+_\d+\]$/.test(v)) return false; // already masked
  // Code, not data: `req.body.nama`, `z.string()`, `${user.phone}`, `=> …`.
  if (/[{}<>`$[\]]|=>|^\w+\.\w+\(/.test(v)) return false;
  if (type === 'ADDRESS' && !/\s/.test(v)) return false; // a real address has more than one word
  if (type !== 'ADDRESS' && (/[()]/.test(v) || /^[a-z_$][\w$]*\.[a-z_$][\w$.]*$/i.test(v))) return false;
  const digitCount = v.replace(/\D/g, '').length;
  if (DIGIT_TYPES.has(type) && digitCount < 6) return false;
  if ((type === 'GEO' || type === 'IP') && digitCount < 2) return false;
  // `"ip-address": "^10.2.0"` in a lockfile is a package version; an address is a dotted quad or IPv6.
  if (type === 'IP' && !/^(?:\d{1,3}\.){3}\d{1,3}/.test(v) && !v.includes(':')) return false;
  if (type === 'EMAIL' && !v.includes('@')) return false;
  // `gender: "m"` in an i18n file is grammatical gender; a person's is one of these.
  if (type === 'GENDER' && !GENDER_VALUE.test(v)) return false;
  if (type === 'BIRTH_DATE' && DATE_KEY.test(normalizeKey(key))) {
    // `ttl: 60000` is a time-to-live. A birth date looks like a date (or an Excel date serial).
    const serialOk = normalizeKey(key) !== 'ttl' && /^\d{5}$/.test(v) && Number(v) >= 7000 && Number(v) <= 55000;
    if (!DATE_LIKE.test(v) && !serialOk) return false;
  }
  if (type === 'NAME') {
    if (!/[A-Za-z]/.test(v) || /[\d_(){}[\]<>=]/.test(v)) return false;
    // `fullName = new codegen.Name(…)`: an expression, not a name.
    if (/^(?:new|this|await|null|undefined|true|false|typeof|function|return|self|None)\b/.test(v)) return false;
    if (/^[A-Z][a-z]+[A-Z]/.test(v)) return false; // PascalCase identifier
    const words = v.split(/\s+/);
    if (isNamePartKey(key)) {
      if (words.length > 4 || !words.every((w) => /^[A-Z]/.test(w)) || words.every((w) => NAME_LABEL_WORDS.test(w))) return false;
    } else if (isGenericNameKey(key)) {
      // `name: Build and test` in a CI file is not a person.
      if (words.length < 2 || words.length > 5 || !words.every((w) => /^[A-Z]/.test(w))) return false;
    } else if (ROLE_KEY.test(normalizeKey(key)) && words.length === 1 && !/^[A-Z]/.test(v)) {
      // `"owner": "lokal-id"` is an account; "Siti" or "siti aminah" under `pasien` is a person.
      return false;
    }
  }
  return true;
}
