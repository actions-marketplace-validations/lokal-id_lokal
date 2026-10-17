// QRIS (Quick Response Code Indonesian Standard) payloads: the text inside a QRIS code.
//
// A payload is EMVCo merchant-presented TLV: two digits of tag, two digits of length, then the value, ending with a
// CRC-16/CCITT-FALSE checksum in tag 63. Tags 26–51 hold merchant accounts; tag 51 with "ID.CO.QRIS.WWW" carries the
// national merchant ID (NMID) and the merchant criteria. A static code (tag 01 = "11") lets the payer type the amount;
// a dynamic one ("12") carries it in tag 54.
import type { Issue } from './nik.ts';

export interface QrisField {
  tag: string;
  value: string;
  /** Sub-fields of a template: merchant accounts (26–51), additional data (62), language (64), 80–99. */
  children?: QrisField[];
}

export interface QrisMerchantAccount {
  tag: string;
  /** Globally unique identifier: a reverse domain such as "ID.CO.QRIS.WWW" or "COM.GO-JEK.WWW". */
  gui?: string;
  /** Merchant PAN (sub-tag 01), the account number at the acquirer. */
  pan?: string;
  /** Merchant ID at the acquirer (02); in tag 51 this is the NMID. */
  merchantId?: string;
  /** Merchant criteria (03): UMI, UKE, UME, UBE, … */
  criteria?: string;
}

export type QrisTip = { kind: 'prompt' } | { kind: 'fixed'; value: string } | { kind: 'percent'; value: string };

export interface QrisAdditionalData {
  billNumber?: string;
  mobileNumber?: string;
  storeLabel?: string;
  loyaltyNumber?: string;
  referenceLabel?: string;
  customerLabel?: string;
  terminalLabel?: string;
  purpose?: string;
}

export interface QrisInfo {
  input: string;
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** `static` (tag 01 = 11): the payer types the amount. `dynamic` (12): the amount is in the code. */
  type?: 'static' | 'dynamic';
  merchantName?: string;
  merchantCity?: string;
  postalCode?: string;
  /** National Merchant ID from tag 51, such as "ID1020021181745". */
  nmid?: string;
  criteria?: string;
  /** "Usaha Mikro", "Usaha Kecil", … for the criteria codes whose meaning is settled. */
  criteriaLabel?: string;
  /** Merchant category code (ISO 18245), such as "5812" for restaurants. */
  mcc?: string;
  /** ISO 4217 numeric: "360" is Rupiah. */
  currency?: string;
  country?: string;
  /** As written in the code, in Rupiah: "25000". */
  amount?: string;
  tip?: QrisTip;
  accounts: QrisMerchantAccount[];
  additional?: QrisAdditionalData;
  crc?: string;
  fields: QrisField[];
}

const QRIS_GUI = 'ID.CO.QRIS.WWW';
const CRITERIA: Record<string, string> = { UMI: 'Usaha Mikro', UKE: 'Usaha Kecil', UME: 'Usaha Menengah', UBE: 'Usaha Besar' };
const ADDITIONAL: Record<string, keyof QrisAdditionalData> = {
  '01': 'billNumber', '02': 'mobileNumber', '03': 'storeLabel', '04': 'loyaltyNumber', '05': 'referenceLabel',
  '06': 'customerLabel', '07': 'terminalLabel', '08': 'purpose',
};
const AMOUNT = /^(?=.{1,13}$)\d+(?:\.\d{1,2})?$/;

const isTemplate = (tag: number) => (tag >= 26 && tag <= 51) || tag === 62 || tag === 64 || tag >= 80;

/** CRC-16/CCITT-FALSE (polynomial 0x1021, initial 0xFFFF) over the UTF-8 bytes, as four uppercase hex digits. */
export function qrisCrc(data: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(data)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Splits TLV text into fields, or returns the position where it stops making sense. */
function tlv(s: string): QrisField[] | number {
  const out: QrisField[] = [];
  let pos = 0;
  while (pos < s.length) {
    const tag = s.slice(pos, pos + 2);
    const len = s.slice(pos + 2, pos + 4);
    if (!/^\d\d$/.test(tag) || !/^\d\d$/.test(len) || pos + 4 + Number(len) > s.length) return pos;
    const value = s.slice(pos + 4, pos + 4 + Number(len));
    out.push({ tag, value });
    pos += 4 + Number(len);
  }
  return out;
}

const field = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`;

/** Reads a QRIS payload: who gets paid, how much, and whether the code is intact. */
export function parseQris(input: string): QrisInfo {
  const info: QrisInfo = { input, valid: false, errors: [], warnings: [], accounts: [], fields: [] };
  const s = String(input).trim();
  const fields = tlv(s);
  if (typeof fields === 'number') {
    info.errors.push({
      code: 'format',
      message: `Payload QRIS tidak terbaca di posisi ${fields}: setiap bagian harus dua digit tag, dua digit panjang, lalu isinya.`,
    });
    return info;
  }
  for (const f of fields) {
    if (isTemplate(Number(f.tag))) {
      const children = tlv(f.value);
      if (typeof children === 'number') info.errors.push({ code: 'format', message: `Isi tag ${f.tag} bukan TLV yang valid.` });
      else f.children = children;
    }
  }
  info.fields = fields;
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.tag)) info.errors.push({ code: 'duplicate', message: `Tag ${f.tag} muncul lebih dari sekali.` });
    seen.add(f.tag);
  }
  const get = (tag: string) => fields.find((f) => f.tag === tag);
  const sub = (f: QrisField | undefined, tag: string) => f?.children?.find((c) => c.tag === tag)?.value;

  if (fields[0]?.tag !== '00' || fields[0].value !== '01') {
    info.errors.push({ code: 'payload_format', message: 'Payload QRIS harus diawali 000201 (Payload Format Indicator).' });
  }

  const last = fields[fields.length - 1];
  if (last?.tag !== '63' || last.value.length !== 4) {
    info.errors.push({ code: 'crc_missing', message: 'CRC (tag 63, 4 karakter) harus ada di akhir payload.' });
  } else {
    info.crc = last.value;
    const expected = qrisCrc(s.slice(0, -4));
    if (last.value.toUpperCase() !== expected) {
      info.errors.push({
        code: 'crc',
        message: `CRC tidak cocok: tertulis ${last.value}, seharusnya ${expected}. Kode ini rusak, terpotong, atau sudah diubah.`,
      });
    }
  }

  const poi = get('01')?.value;
  if (poi === '11') info.type = 'static';
  else if (poi === '12') info.type = 'dynamic';
  else if (poi !== undefined) info.warnings.push({ code: 'point_of_initiation', message: `Tag 01 bernilai ${poi}, seharusnya 11 (statis) atau 12 (dinamis).` });

  for (const f of fields) {
    const n = Number(f.tag);
    if (n < 26 || n > 51 || !f.children) continue;
    const account: QrisMerchantAccount = { tag: f.tag };
    const gui = sub(f, '00');
    if (gui !== undefined) account.gui = gui;
    const pan = sub(f, '01');
    if (pan !== undefined) account.pan = pan;
    const id = sub(f, '02');
    if (id !== undefined) account.merchantId = id;
    const criteria = sub(f, '03');
    if (criteria !== undefined) account.criteria = criteria;
    info.accounts.push(account);
  }
  if (!info.accounts.length) {
    info.errors.push({ code: 'merchant_account', message: 'Tidak ada informasi akun merchant (tag 26 sampai 51).' });
  }
  const national = info.accounts.find((a) => a.gui?.toUpperCase() === QRIS_GUI);
  if (national) {
    if (national.merchantId !== undefined) {
      info.nmid = national.merchantId;
      if (!/^ID\d{13}$/.test(national.merchantId)) {
        info.warnings.push({ code: 'nmid', message: `NMID ${national.merchantId} tidak berformat seperti biasanya: ID diikuti 13 digit.` });
      }
    }
  } else if (info.accounts.length) {
    info.warnings.push({ code: 'not_qris', message: `Tidak ada akun dengan ${QRIS_GUI}: ini kode QR pembayaran EMVCo, tapi mungkin bukan QRIS.` });
  }
  const criteria = national?.criteria ?? info.accounts.find((a) => a.criteria)?.criteria;
  if (criteria !== undefined) {
    info.criteria = criteria;
    if (Object.hasOwn(CRITERIA, criteria)) info.criteriaLabel = CRITERIA[criteria];
  }

  const mcc = get('52')?.value;
  if (mcc !== undefined) info.mcc = mcc;
  if (!mcc || !/^\d{4}$/.test(mcc)) info.errors.push({ code: 'mcc', message: 'Kode kategori merchant (tag 52) wajib ada, 4 digit.' });

  const currency = get('53')?.value;
  if (currency !== undefined) info.currency = currency;
  if (currency !== '360') info.errors.push({ code: 'currency', message: 'Mata uang (tag 53) harus 360, yaitu Rupiah.' });

  const amount = get('54')?.value;
  if (amount !== undefined) {
    info.amount = amount;
    if (!AMOUNT.test(amount)) info.errors.push({ code: 'amount', message: 'Nominal (tag 54) hanya boleh angka dengan paling banyak 2 desimal, maksimal 13 karakter.' });
  } else if (info.type === 'dynamic') {
    info.warnings.push({ code: 'dynamic_without_amount', message: 'QRIS dinamis biasanya berisi nominal (tag 54).' });
  }

  const tip = get('55')?.value;
  if (tip === '01') info.tip = { kind: 'prompt' };
  else if (tip === '02' || tip === '03') {
    const value = get(tip === '02' ? '56' : '57')?.value;
    if (value === undefined) {
      info.errors.push({ code: 'tip', message: `Tag 55 bernilai ${tip} butuh ${tip === '02' ? 'biaya tetap di tag 56' : 'persentase di tag 57'}.` });
    } else info.tip = tip === '02' ? { kind: 'fixed', value } : { kind: 'percent', value };
  } else if (tip !== undefined) info.errors.push({ code: 'tip', message: `Tag 55 bernilai ${tip}, seharusnya 01, 02, atau 03.` });

  const country = get('58')?.value;
  if (country !== undefined) info.country = country;
  if (country !== 'ID') info.errors.push({ code: 'country', message: 'Kode negara (tag 58) harus ID.' });

  const name = get('59')?.value;
  if (name !== undefined) info.merchantName = name;
  if (!name || name.length > 25) info.errors.push({ code: 'merchant_name', message: 'Nama merchant (tag 59) wajib ada, paling banyak 25 karakter.' });

  const city = get('60')?.value;
  if (city !== undefined) info.merchantCity = city;
  if (!city || city.length > 15) info.errors.push({ code: 'merchant_city', message: 'Kota merchant (tag 60) wajib ada, paling banyak 15 karakter.' });

  const postal = get('61')?.value;
  if (postal !== undefined) {
    info.postalCode = postal;
    if (!/^\d{5}$/.test(postal)) info.warnings.push({ code: 'postal_code', message: `Kode pos ${postal} bukan 5 digit.` });
  }

  const additional = get('62');
  if (additional?.children) {
    const data: QrisAdditionalData = {};
    for (const c of additional.children) {
      const key = Object.hasOwn(ADDITIONAL, c.tag) ? ADDITIONAL[c.tag] : undefined;
      if (key) data[key] = c.value;
    }
    if (Object.keys(data).length) info.additional = data;
  }

  info.valid = info.errors.length === 0;
  return info;
}

export interface QrisAmountOptions {
  /** A fixed fee in Rupiah (tag 56), or a percentage (tag 57), added on top of the amount. */
  tip?: { fixed: number | string } | { percent: number | string };
}

function amountText(value: number | string, what: string): string {
  // A number with more than 2 decimals is refused rather than rounded: money should not change on the way in.
  const text =
    typeof value !== 'number' ? value.trim()
    : Number.isInteger(value) ? String(value)
    : Number(value.toFixed(2)) === value ? value.toFixed(2)
    : String(value);
  if (!AMOUNT.test(text) || Number(text) <= 0) {
    throw new RangeError(`${what} harus lebih dari 0, angka dengan paling banyak 2 desimal, maksimal 13 karakter: ${String(value)}`);
  }
  return text;
}

/**
 * Turns a QRIS code into a dynamic one for an amount: tag 01 becomes 12, the amount goes into tag 54, and the CRC is
 * recomputed. Every other field stays as it was, so the payment still goes to the same merchant account.
 */
export function setQrisAmount(input: string, amount: number | string, options: QrisAmountOptions = {}): string {
  const info = parseQris(input);
  if (!info.valid) throw new RangeError(`QRIS tidak valid: ${info.errors[0]!.message}`);
  const value = amountText(amount, 'Nominal');
  const tipFields: Array<[string, string]> = [];
  if (options.tip) {
    if ('fixed' in options.tip) tipFields.push(['55', '02'], ['56', amountText(options.tip.fixed, 'Biaya tetap')]);
    else {
      const percent = amountText(options.tip.percent, 'Persentase');
      if (Number(percent) > 100) throw new RangeError(`Persentase paling banyak 100: ${percent}`);
      tipFields.push(['55', '03'], ['57', percent]);
    }
  }
  const drop = new Set(['01', '54', '63', ...(options.tip ? ['55', '56', '57'] : [])]);
  const kept = info.fields.filter((f) => !drop.has(f.tag)).map((f): [string, string] => [f.tag, f.value]);
  const inserted: Array<[string, string]> = [['54', value], ...tipFields];
  const at = kept.findIndex(([tag]) => Number(tag) > 54);
  kept.splice(at < 0 ? kept.length : at, 0, ...inserted);
  kept.splice(1, 0, ['01', '12']);
  const body = `${kept.map(([tag, v]) => field(tag, v)).join('')}6304`;
  return body + qrisCrc(body);
}
