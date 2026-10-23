import { parseNik } from '../nik.ts';
import { parsePhone } from '../phone.ts';
import { fieldType, isGenericNameKey, isPlausibleValue } from './fields.ts';
import {
  AMBIGUOUS_GIVEN_NAMES,
  BALINESE_NAMES,
  CHINESE_FAMILY_NAMES,
  FAMILY_NAMES,
  GIVEN_NAMES,
  SECOND_NAMES,
} from './names.ts';
import { PII_TYPES, type Confidence, type PiiMatch, type PiiType } from './types.ts';

export { PII_TYPES, UU_PDP_CATEGORY, type Confidence, type PiiMatch, type PiiType } from './types.ts';

/** Text in the `window` characters before `index`, on the same line, lowercased. */
function before(text: string, index: number, window = 40): string {
  const slice = text.slice(Math.max(0, index - window), index);
  const nl = slice.lastIndexOf('\n');
  return (nl >= 0 ? slice.slice(nl + 1) : slice).toLowerCase();
}

/** The line above a value that stands alone on its own line, lowercased; empty when the value shares its line. */
function lineAbove(text: string, index: number, length: number): string {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = text.indexOf('\n', index + length);
  if (text.slice(lineStart, index).trim() || text.slice(index + length, lineEnd === -1 ? text.length : lineEnd).trim()) return '';
  if (lineStart === 0) return '';
  return text.slice(text.lastIndexOf('\n', lineStart - 2) + 1, lineStart - 1).toLowerCase();
}

function match(type: PiiType, start: number, value: string, confidence: Confidence): PiiMatch {
  return { type, start, end: start + value.length, value, confidence };
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** NIP ASN: birth date (8) + TMT CPNS year-month (6) + gender 1/2 (1) + serial (3). */
function isNip(d: string): boolean {
  if (d.length !== 18) return false;
  const y = Number(d.slice(0, 4));
  const tmt = Number(d.slice(8, 12));
  const tmtMonth = Number(d.slice(12, 14));
  return (
    y >= 1940 && y <= 2010 && isRealDate(y, Number(d.slice(4, 6)), Number(d.slice(6, 8))) &&
    tmt >= 1970 && tmt <= 2040 && tmt - y >= 17 && tmtMonth >= 1 && tmtMonth <= 12 && /[12]/.test(d[14]!)
  );
}

// Card numbers published by Visa, Mastercard, Amex, Stripe, and payment gateways for testing.
const TEST_CARDS = new Set([
  '4111111111111111', '4242424242424242', '4000056655665556', '4012888888881881', '4007000000027',
  '4222222222222', '5555555555554444', '5105105105105100', '5200828282828210', '2223003122003222',
  '378282246310005', '371449635398431', '378734493671000', '6011111111111117', '6011000990139424',
  '3530111333300000', '3566002020360505', '4811111111111114', '5211111111111117', '4911111111111113',
]);

const KK_KEYWORD = /\b(kk|kartu keluarga)\b[^\d]*$/;
const SIM_KEYWORD = /\b(sim|surat izin mengemudi|driving licen[cs]e)\b[^\d]*$/;
const NIK_KEYWORD = /\b(nik|ktp|nomor induk kependudukan)\b/;
const NPWP_KEYWORD = /\bnpwp\b/;
const NISN_KEYWORD = /\b(nisn|nomor induk siswa nasional)\b[^\d]*$/;
const BPJS_KEYWORD =/\b(bpjs|jkn|kis|kartu indonesia sehat|kpj|jamsostek)\b/;
const BANK_KEYWORD =
  /\b(no\.?\s*rek(ening)?|norek|rekening|rek|account|acc|a\/c|virtual account|va|transfer|tf|bca|bri|bni|mandiri|bsi|cimb|niaga|permata|danamon|btn|jago|seabank|blu|ocbc|panin|maybank|mega|muamalat)\b/;

/**
 * Runs of 8–19 digits, optionally separated by single spaces or dashes ("1234 5678 9012").
 * Classified by length, structure, checksum, and nearby keywords.
 */
function detectDigitRuns(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const run = /(?<![\d\w.])\d(?:[ -]?\d){7,18}(?![\d\w])/g;
  for (const m of text.matchAll(run)) {
    const value = m[0];
    const digits = value.replace(/\D/g, '');
    const ctx = before(text, m.index);
    const label = ctx.slice(-25); // the words right before the number
    const push = (type: PiiType, confidence: Confidence) => out.push(match(type, m.index, value, confidence));

    // Mobile numbers (also used as e-wallet accounts) are left to the phone detector.
    if (/^(08|628)/.test(digits) && parsePhone(digits).valid) continue;

    if (digits.length === 16 && KK_KEYWORD.test(label)) push('KK', 'high');
    else if (digits.length >= 12 && digits.length <= 16 && SIM_KEYWORD.test(label)) push('SIM', 'high');
    else if (digits.length === 16 && parseNik(digits).valid) push('NIK', 'high');
    else if (isNip(digits)) push('NIP', 'high');
    else if (digits.length >= 13 && digits.length <= 19 && /^[3-6]/.test(digits) && luhn(digits)) {
      if (!TEST_CARDS.has(digits)) push('CARD', 'high');
    }
    else if ((digits.length === 15 || digits.length === 16) && NPWP_KEYWORD.test(ctx)) push('NPWP', 'high');
    else if (digits.length === 16 && NIK_KEYWORD.test(ctx)) push('NIK', 'medium');
    else if (digits.length === 10 && NISN_KEYWORD.test(label)) push('NISN', 'high');
    else if ((digits.length === 13 || digits.length === 11) && BPJS_KEYWORD.test(ctx)) push('BPJS', 'high');
    else if (digits.length >= 8 && digits.length <= 18 && BANK_KEYWORD.test(ctx)) push('BANK_ACCOUNT', 'high');
    else if (digits.length >= 8 && digits.length <= 18 && BANK_KEYWORD.test(lineAbove(text, m.index, m[0].length))) {
      // A transfer receipt stacks the bank and the account: "Bank BNI\n0123456789".
      push('BANK_ACCOUNT', 'medium');
    }
  }
  return out;
}

function detectNpwpFormatted(text: string): PiiMatch[] {
  const re = /(?<!\d)\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}(?!\d)/g;
  return [...text.matchAll(re)].map((m) => match('NPWP', m.index, m[0], 'high'));
}

/**
 * Civil registry deeds (akta kelahiran, perkawinan, kematian): Dukcapil numbers them "3201-LT-12052018-0042", region,
 * kind, date, serial. Older deeds have a free-form number after the words "akta kelahiran".
 */
function detectAkta(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const dukcapil = /(?<![\w-])\d{4}[-./ ]?(?:LT|LU|LD|KW|CR|KM)[-./ ]?\d{8}[-./ ]?\d{3,6}(?![\w-])/gi;
  for (const m of text.matchAll(dukcapil)) out.push(match('AKTA', m.index, m[0], 'high'));
  const worded =
    /\bakta\s+(?:kelahiran|lahir|nikah|perkawinan|kematian|cerai|perceraian)(?:nya)?\s+(?:no(?:mor)?\.?\s*:?\s*)?([A-Za-z0-9][\w./-]{3,30}[A-Za-z0-9])/gi;
  for (const m of text.matchAll(worded)) {
    if (m[1]!.replace(/\D/g, '').length < 4) continue;
    out.push(match('AKTA', m.index + m[0].length - m[1]!.length, m[1]!, 'high'));
  }
  return out;
}

function detectPassports(text: string): PiiMatch[] {
  const re = /(?<![A-Za-z0-9])[A-Z]{1,2}\s?\d{6,8}(?![A-Za-z0-9])/g;
  return [...text.matchAll(re)]
    .filter((m) => /\b(paspor|passport)\b/.test(before(text, m.index, 30)))
    .map((m) => match('PASSPORT', m.index, m[0], 'high'));
}

// Words that may sit right before a number with "-" or "/" and still mean "this is a phone".
const PHONE_LABELS = new Set([
  'hp', 'no', 'nomor', 'nohp', 'telp', 'tlp', 'tel', 'telepon', 'telpon', 'phone', 'ph', 'handphone', 'mobile', 'wa',
  'whatsapp', 'wa.me', 'nowa', 'sms', 'call', 'cs', 'cp', 'kontak', 'contact',
]);

/** "INV-081234567890", "ORD/0812…": a number glued to a code is an ID, not a phone. "hp-0812…" and "wa.me/62…" are. */
function gluedToCode(text: string, index: number): boolean {
  const sep = text[index - 1];
  if (sep !== '-' && sep !== '/') return false;
  let i = index - 1;
  while (i > 0 && /[A-Za-z0-9.]/.test(text[i - 1]!)) i--;
  const token = text.slice(i, index - 1).toLowerCase();
  return /[a-z]/.test(token) && !PHONE_LABELS.has(token) && !token.endsWith('wa.me');
}

const PHONE_WORD = /\b(?:telp|telepon|telpon|tlp|tel|phone|fax|faks|hub|hubungi|call|kontak|contact|cp|rumah|kantor|no)\b[^\d]*$/;

function detectPhones(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // Separators never include a line break, and every group after the operator prefix has at least three digits.
  // Otherwise a number at the end of a line swallows the digits that start the next one ("…6789\n14/10/26"),
  // fails validation, and is left unmasked.
  // "0062 812 …" dials out of another country the way "+62" does.
  const mobile = /(?<![\d+\w])(?:\+62|0062|62|0)[ \t-]?8\d{1,2}(?:[ \t.-]?\d{3,4}){2,3}(?![\d\w])/g;
  for (const m of text.matchAll(mobile)) {
    if (parsePhone(m[0].replace(/^00/, '+')).valid && !gluedToCode(text, m.index)) out.push(match('PHONE', m.index, m[0], 'high'));
  }
  const landline = /\((?:\+62[ \t]?|0)\d{2,3}\)[ \t]?\d{3,4}[ \t-]?\d{3,4}(?!\d)|(?<![\d\w])\+62[ \t]?[2-79]\d{1,2}[ \t-]?\d{3,4}[ \t-]?\d{3,4}(?!\d)/g;
  for (const m of text.matchAll(landline)) out.push(match('PHONE', m.index, m[0], 'medium'));
  // "+62 (812) 3456-7890", "(0812) 3456 7890".
  const bracketed = /(?<![\d\w])(?:\+?62[ \t]?\(8\d{1,2}\)|\(08\d{1,2}\))[ \t]?\d{3,4}[ \t.-]?\d{3,4}(?!\d)/g;
  for (const m of text.matchAll(bracketed)) if (parsePhone(m[0]).valid) out.push(match('PHONE', m.index, m[0], 'high'));
  // "08 12 34 56 78 90": any grouping, as long as all the digits make one valid mobile number.
  const grouped = /(?<![\d\w+])(?:\+62[ \t.-]?|62[ \t.-]?|0[ \t.-]?)8(?:[ \t.-]?\d){8,12}(?![\d\w])/g;
  for (const m of text.matchAll(grouped)) {
    // Only what the pattern above cannot read: groups of one or two digits after the prefix. Otherwise
    // "0812-3456-7890\n2 …" would take the next line's "2".
    const groups = m[0].split(/[ \t.-]/);
    // Next to a phone word any grouping goes: 'invalid phone "0812-77-1234-99"'.
    const named = PHONE_WORD.test(before(text, m.index, 30));
    if (!named && (groups.length < 4 || groups.slice(1).some((g) => g.length > 2))) continue;
    // "0 8 1 2 3 …", one digit at a time, only next to a phone word: otherwise it is any list of digits.
    if (/^0[ \t.-]/.test(m[0]) && !named) continue;
    if (parsePhone(m[0]).valid && !gluedToCode(text, m.index)) out.push(match('PHONE', m.index, m[0], 'high'));
  }
  // "rumah 0251 8321234", "telp 021-7654321": an area code without brackets, only next to a phone word.
  const areaCode = /(?<![\d\w+])0(?:2[1-9]|[3-79]\d)\d{0,2}[ \t.-]?\d{3,4}[ \t.-]?\d{3,4}(?![\d\w])/g;
  for (const m of text.matchAll(areaCode)) {
    if (!PHONE_WORD.test(before(text, m.index, 30))) continue;
    const info = parsePhone(m[0]);
    if (info.valid && info.type === 'landline') out.push(match('PHONE', m.index, m[0], 'medium'));
  }
  return out;
}

// Domains reserved for documentation and testing (RFC 2606, RFC 6761) never belong to a person.
const RESERVED_EMAIL_DOMAIN = /@(?:[\w-]+\.)*(?:example\.(?:com|net|org)|[\w-]+\.(?:example|test|invalid|localhost))$/i;

function detectEmails(text: string): PiiMatch[] {
  const re = /(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;
  const out = [...text.matchAll(re)]
    .filter((m) => !RESERVED_EMAIL_DOMAIN.test(m[0]))
    .map((m) => match('EMAIL', m.index, m[0], 'high'));
  // Written out to dodge scrapers: "siti.rahayu88 [at] gmail [dot] com", "budi(at)yahoo.co.id".
  const AT = String.raw`\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\})\s*`;
  const DOT = String.raw`(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\})\s*|\.)`;
  const spelled = new RegExp(String.raw`(?<![\w.+-])[A-Za-z0-9._%+-]+${AT}[A-Za-z0-9-]+(?:${DOT}[A-Za-z0-9-]+)*${DOT}[A-Za-z]{2,}(?![\w-])`, 'gi');
  for (const m of text.matchAll(spelled)) out.push(match('EMAIL', m.index, m[0], 'high'));
  // URL-encoded: "email=siti%40gmail.com".
  for (const m of text.matchAll(/(?<![\w.+-])[A-Za-z0-9._+-]+%40[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g)) {
    out.push(match('EMAIL', m.index, m[0], 'high'));
  }
  return out;
}

function detectIps(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const re = /(?<![\d.\w])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d\w]|\.[\d\w])/g;
  for (const m of text.matchAll(re)) {
    const ip = m[0];
    if (/^(0\.|127\.|255\.255\.255\.255)/.test(ip)) continue;
    // "SK No. 100.3.3.1-6117": a document number. "192.168.2.1-192.168.2.10" is a range of addresses.
    if (/^-\d+(?![\d.])/.test(text.slice(m.index + ip.length)) || /\b(?:no|nomor|sk|surat)\.?\s*$/.test(before(text, m.index, 12))) continue;
    if (/\b(versi|version|ver|v)\.?\s*$/.test(before(text, m.index, 12))) continue;
    // "step 5.2.1.1." in a spec is a section; an address ending a sentence has larger parts ("dari IP 36.72.215.104.").
    if (text[m.index + ip.length] === '.' && ip.split('.').every((part) => part.length === 1)) continue;
    const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
    out.push(match('IP', m.index, ip, priv ? 'medium' : 'high'));
  }
  return out;
}

function detectCoordinates(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // "-6.914744, 107.609810", and with the axes named: "lat -7.250445, lng 112.768845".
  const re =
    /(?<![\d.])(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?![\d.])|\blat(?:itude)?\s*[:=]?\s*(-?\d{1,2}\.\d{4,})\s*[,;]?\s*(?:lng|lon|long|longitude)\s*[:=]?\s*(-?\d{1,3}\.\d{4,})(?![\d.])/gi;
  for (const m of text.matchAll(re)) {
    const lat = Number(m[1] ?? m[3]);
    const lng = Number(m[2] ?? m[4]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const indonesia = lat >= -11.5 && lat <= 6.5 && lng >= 94 && lng <= 141.5;
    out.push(match('GEO', m.index, m[0], indonesia ? 'high' : 'medium'));
  }
  return out;
}

const MONTHS =
  'Januari|Februari|Pebruari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Nopember|Desember|January|February|March|May|June|July|August|October|December|Jan|Feb|Mar|Apr|Jun|Jul|Agu|Agt|Ags|Aug|Sep|Sept|Okt|Oct|Nov|Des|Dec';
const DATE = `\\d{1,2}[-/. ]\\d{1,2}[-/. ]\\d{2,4}|\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}`;

function detectBirthDates(text: string): PiiMatch[] {
  const re = new RegExp(
    `\\b(?:lahir|lhr|kelahiran|born|ttl|dob|d\\.o\\.b\\.?|date\\s+of\\s+birth|birth\\s*date|birthday)(?![a-z])[^\\n\\d]{0,40}?(${DATE})`,
    'gi',
  );
  return [...text.matchAll(re)].map((m) => match('BIRTH_DATE', m.index + m[0].length - m[1]!.length, m[1]!, 'high'));
}

const CONDITIONS =
  'hiv|aids|odha|tbc|tb paru|tuberkulosis|hepatitis(?: [abc])?|kanker(?: \\w+)?|tumor(?: \\w+)?|diabetes(?: mel+itus)?(?: tipe [12])?|hipertensi|stroke|penyakit jantung|gagal ginjal|cuci darah|covid(?:-19)?|dbd|demam berdarah(?: dengue)?|malaria|kusta|lepra|skizofrenia|bipolar(?: tipe [12i]+)?|depresi(?: berat| sedang| ringan)?|gangguan jiwa|gangguan mental|odgj|autis(?:me)?|epilepsi|ims|sifilis|gonore|herpes|hamil(?: \\d{1,2} (?:bulan|minggu))?|keguguran|asma|lupus|leukemia|th?alas+emia(?: (?:alfa|beta|mayor|minor))?|hemofilia|alzheimer|demensia|' +
  'gastroenteritis(?: akut)?|gastritis|maag|typhoid|pneumonia|bronkitis|sinusitis|apendisitis|usus buntu|batu ginjal|' +
  'hipotiroid|hipertiroid|anemia|glaukoma|katarak|skoliosis|hernia|wasir|ambeien|tbc tulang|meningitis|' +
  'parkinson|tifus|tipes|cacar|campak|polio|difteri|stunting|obesitas|kolesterol tinggi|asam urat|gangguan kecemasan|' +
  'anxiety|ptsd|ocd|adhd|down syndrome|cerebral palsy|lumpuh|tunanetra|tunarungu|tunawicara|tunadaksa|kista|miom|' +
  'endometriosis|pcos|osteoporosis|vertigo|psikosis|gerd|jantung koroner|sakit jantung|gagal jantung|serangan jantung|' +
  'infertil|mandul|impoten|klamidia|kecanduan(?: \\w+)?|pecandu(?: \\w+)?|pengguna (?:narkoba|narkotika|sabu|ganja|heroin|putaw|ekstasi)|' +
  'percobaan bunuh diri|self harm|patah tulang(?: \\w+)?|gegar otak|luka bakar|amputasi|serangan panik|gangguan makan|anoreksia|bulimia';

const SYMPTOMS =
  '(?:demam(?:\\s+tinggi)?|batuk(?:\\s+berdahak)?|pilek|flu|sesak(?:\\s+napas)?|mual|muntah|diare|mencret|pusing|sakit\\s+kepala|nyeri\\s+\\w+|lemas|meriang|gatal-gatal|ruam|pendarahan|kejang|sariawan|radang\\s+tenggorokan|sakit\\s+perut|sakit\\s+gigi)';

// Medicines that name the condition they treat.
const MEDICATIONS =
  'insulin|metformin|glibenclamide|arv|antiretroviral|obat tbc|rifampisin|isoniazid|kemoterapi|kemo|antidepresan|' +
  'antipsikotik|fluoxetine|sertraline|risperidone|haloperidol|lithium|metadon|methadone|warfarin|amlodipine|captopril|' +
  'levothyroxine|tamoxifen|hormon|kb|pil kb';

function detectHealth(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // Strong medical verbs: whatever follows is the condition.
  const strong =
    /\b(?:didiagnosis|didiagnosa|terdiagnosis|terdiagnosa|mengidap|terinfeksi|riwayat penyakit|divonis)\s+(?:menderita\s+|mengidap\s+|penyakit\s+)?(?!(?:yang|dan|atau|di|ke|dari|untuk|ini|itu|tersebut|adalah|dapat|bisa|tidak|belum|anda|kamu|pasien|seseorang)\b)([^\n\r,.;:()]{2,60}?)(?=\s+(?:sejak|selama|dan sudah|dan sedang|tapi|namun|sehingga|jadi)\b|[\n\r,.;:()]|$)/gi;
  // "Dx: TB paru" in a medical note; capitalized, so "dx" in code is not one.
  const dx = /\b(?:Dx|DX|Diagnosis|Diagnosa|Diag)\s*:\s*([^\n\r,;()]{2,60}?)(?=\s*(?:[\n\r,;()]|\.(?:\s|$)|$))/g;
  for (const m of [...text.matchAll(strong), ...text.matchAll(dx)]) {
    out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'high'));
  }
  // Everyday words ("positif", "karena", "saya") only count before a known condition: "saya diabetes",
  // "riwayat hipertensi dan diabetes melitus".
  const gated = new RegExp(
    `\\b(?:(?:dokter|dok|dr)\\.?\\s+(?:bilang|bilangnya|menyatakan|mendiagnosis)(?:\\s+(?:ada|kena|positif))?|positif|menderita|terkena|kena|sakit|pasien|komplikasi|kambuh|kumat|penderita|pengidap|penyintas|mengalami|karena|krn|akibat|gara-gara|punya|riwayat|diagnosa|diagnosis|didiagnosa|pembawa\\s+sifat|carrier|saya|aku|gue|gw|gua|dia|beliau|ayah|bapak|ibu|mama|mamah|papa|papah|suami|istri|anak|anaknya|adik|adek|kakak|nenek|kakek|mertua|pacar|teman|temen)` +
      `\\s+(?:(?:saya|aku|gue|dia|lagi|sedang|sdg|sudah|udah|sdh|sempat|pernah|baru|kena|terkena)\\s+){0,2}` +
      `((?:penyakit\\s+)?(?:${CONDITIONS})(?:\\s*(?:,|dan|serta)\\s+(?:${CONDITIONS}))*)\\b`,
    'gi',
  );
  for (const m of text.matchAll(gated)) {
    out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  }
  // A test result: "hasil tes HIV reaktif", "rapid test covid positif", "tes narkoba negatif".
  const result =
    /\b(?:tes|test|uji|pemeriksaan|skrining|screening|swab|rapid(?:\s+test)?)\s+((?:hiv|hepatitis(?:\s+[abc])?|hbsag|covid(?:-19)?|tbc|tb|sifilis|vdrl|narkoba|urine|kehamilan|dna|pcr|antigen)\s+(?:hasilnya\s+)?(?:reaktif|non-?reaktif|positif|negatif))\b/gi;
  for (const m of text.matchAll(result)) out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  // A genetic test result: "BRCA1 positif", "mutasi BRCA2", "carrier thalassemia" (above).
  for (const m of text.matchAll(/\b(?:mutasi\s+)?(?:BRCA[12]|HLA-B\*?\d{2}:\d{2})(?:\s+(?:positif|negatif|mutasi|carrier))?/g)) {
    if (/positif|negatif|mutasi|carrier/i.test(m[0]) || /\b(?:hasil|tes|test|dinyatakan)\b[^\n]{0,20}$/i.test(before(text, m.index, 30))) {
      out.push(match('HEALTH', m.index, m[0], 'medium'));
    }
  }
  // A disability said of someone stands on its own: "Peserta Lina Marlina, tunarungu, …". Not "sekolah bagi tunarungu".
  for (const m of text.matchAll(/\b(?:tuna[ -]?(?:rungu|netra|wicara|daksa|grahita|laras)|odha|odgj)\b/gi)) {
    if (/\b(?:para|kaum|penyandang|bagi|untuk|buat|sekolah|slb|komunitas|organisasi|yayasan|layanan|hak|ramah)\s+$/i.test(before(text, m.index, 20))) continue;
    out.push(match('HEALTH', m.index, m[0], 'medium'));
  }
  // A known condition on its own in brackets: "obat buat ibu saya (diabetes)".
  for (const m of text.matchAll(new RegExp(`\\((${CONDITIONS})\\)`, 'gi'))) {
    out.push(match('HEALTH', m.index + 1, m[1]!, 'medium'));
  }
  // Treatment that reveals the condition: "obat insulin", "suntik insulin", "terapi ARV", "kemoterapi".
  const treatment = new RegExp(
    `\\b(?:obat|suntik(?:an)?|minum|konsumsi|terapi|resep)\\s+(${MEDICATIONS})\\b|\\b(kemoterapi|radioterapi|hemodialisa|cuci darah)\\b`,
    'gi',
  );
  for (const m of text.matchAll(treatment)) {
    const value = m[1] ?? m[2]!;
    out.push(match('HEALTH', m.index + m[0].length - value.length, value, 'medium'));
  }
  // An allergy is health data whatever it is to: "alergi penisilin". Not "bebas alergi" or "obat alergi".
  for (const m of text.matchAll(/\balergi\s+(?:terhadap\s+)?([a-z][\w-]*(?:\s+dan\s+[a-z][\w-]*)?)/gi)) {
    if (/\b(?:anti|bebas|obat|tes|uji)\s+$/.test(before(text, m.index, 12))) continue;
    out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  }
  // Symptoms after the word for a complaint: "keluhan demam", "gejala sesak napas". Not "keluhan pelanggan".
  const symptom =
    /\b(?:keluhan|gejala|mengeluh(?:kan)?)\s+((?:demam|batuk|pilek|flu|sesak(?:\s+napas)?|mual|muntah|diare|pusing|sakit\s+kepala|nyeri\s+\w+|lemas|meriang|gatal|ruam|benjolan|pendarahan|kejang)(?:\s+(?:dan|,)\s+(?:demam|batuk|pilek|flu|mual|muntah|diare|pusing|lemas))*)/gi;
  for (const m of text.matchAll(symptom)) out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  // Symptoms someone has had for a while: "sudah 3 hari demam dan batuk", "anak saya lagi diare".
  const having = new RegExp(
    `\\b(?:(?:sudah|udah|sdh|sejak|selama|umur|usia)\\s+\\d+\\s+(?:hari|minggu|bulan|tahun|th)|(?:saya|aku|gue|gw|dia|beliau|anak\\s+saya|anakku|anaknya|suami\\s+saya|istri\\s+saya)\\s+(?:lagi|sedang|sering|kena|terkena|mengalami))\\s+(${SYMPTOMS}(?:\\s*(?:dan|,|&)\\s*${SYMPTOMS})*)`,
    'gi',
  );
  for (const m of text.matchAll(having)) out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  // Findings listed in a medical note: "Hasil MCU: …, tekanan darah 150/95, kolesterol tinggi". The list needs a
  // medical word before it; "kolesterol tinggi" in an article about food has none.
  const finding = new RegExp(`(?:[,;:]|\\bdan)\\s*((?:${CONDITIONS})|tekanan\\s+darah\\s+\\d{2,3}\\/\\d{2,3}|tensi\\s+\\d{2,3}\\/\\d{2,3})(?=\\s*(?:[,;.]|dan\\b|$))`, 'gi');
  for (const m of text.matchAll(finding)) {
    if (!/\b(?:mcu|medical|check-?up|hasil\s+(?:lab|pemeriksaan)|pasien|dokter|dok|tekanan\s+darah|tensi|keluhan|riwayat|diagnos[ai]s?|klinik|puskesmas|rs|rsud)\b/i.test(text.slice(Math.max(0, m.index - 80), m.index))) continue;
    out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  }
  // A condition right after someone's age: "Alif (8 th), autis", "Bu Narti, 54 tahun, stroke".
  const afterAge = new RegExp(`(?:\\(\\d{1,2}[^)\\n]{0,8}\\)|\\b\\d{1,2}\\s*(?:th|thn|tahun))\\s*,\\s*((?:${CONDITIONS})(?:\\s*(?:,|dan)\\s*(?:${CONDITIONS}))*)\\b`, 'gi');
  for (const m of text.matchAll(afterAge)) out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  // Being in hospital is health data too: "dirawat di RSUD Cibinong", "opname di RS Hermina".
  const hospital =
    /\b(?:dirawat|opname|rawat inap|diopname|dioperasi|isolasi)\s+(?:di\s+)?(?:(?:RSUD|RSU|RSIA|RSJ|RSAB|RS|Rumah Sakit|Puskesmas|Klinik)\b[^\n,.;:()]{0,40}?)(?=\s+(?:karena|krn|sejak|selama|dan|tapi|jadi|sampai)\b|[\n,.;:()]|$)/gi;
  for (const m of text.matchAll(hospital)) out.push(match('HEALTH', m.index, m[0], 'medium'));
  return out;
}

const PERSON_NEAR =
  /\b(?:saya|aku|gue|gw|gua|dia|beliau|kami|suami|istri|ayah|bapak|ibu|mama|papa|anak|adik|kakak|pernah|udah|sudah|lagi|sedang|jadi)\b/;

function detectFinancial(text: string): PiiMatch[] {
  const re =
    /\b(?:gaji|penghasilan|pendapatan|saldo|utang|hutang|pinjaman|cicilan|tunggakan|limit(?:\s+kartu)?(?:\s+kredit)?|tagihan\s+(?:kartu\s+kredit|cc|paylater|pinjol|kpr|cicilan)|(deposito|tabungan|simpanan|habis|rugi|kerugian|kalah|sisa\s+(?:pokok|pinjaman|utang|hutang|cicilan)|pokok\s+(?:pinjaman|utang|hutang)|outstanding|plafond?))(?:\s+(?:saya|aku|gue|gw|gua|dia|beliau|suami|istri|ayah|bapak|ibu|ortu|orang\s+tua|keluarga|bulanan|tahunan|pokok|tetap|per\s+bulan|sebulan|setahun|bersih|kotor|rekening|tabungan|deposito|terakhir|total|anda|kamu|kalian|pinjol|paylater|kpr|kta|online|leasing|kartu\s+kredit|per\s+hari\s+ini|hari\s+ini|saat\s+ini|sekarang|udah|sudah|sdh|baru|itu|ini|tsb|motor|mobil|rumah|hp|laptop|apartemen|bulan\s+ini|ovo|gopay|dana|shopeepay|linkaja|jenius|bca|bri|bni|mandiri|bsi|jago|seabank|di\s+\w+|ke\s+\w+))*\s*(?:sebesar|sekitar|kira-kira|cuma|hanya|adalah|ada|masih|tinggal|sisa|senilai|:|=)?\s*((?:Rp\.?\s?)?\d[\d.,]*(?:\s*(?:rb|ribu|k|jt|juta|m|miliar|milyar|t|triliun)\b)?)/gi;
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(re)) {
    const amount = m[2]!.replace(/[.,]+$/, '');
    if (!/rp|[a-z]$/i.test(amount) && amount.replace(/\D/g, '').length < 4) continue;
    // "Deposito 100 juta, bunga 5%" in a bank's ad is a product; it is personal data when someone holds it.
    if (m[1] && !/\b(?:punya|memiliki|milik|nasabah|pak|bu|bapak|ibu|saya|aku|gue|gw|dia|beliau|debitur|peminjam)\b/i.test(before(text, m.index, 40) + m[0])) continue;
    out.push(match('FINANCIAL', m.index + m[0].length - m[2]!.length, amount, 'medium'));
  }
  // Statuses that say it without an amount: "udah galbay 3 bulan", "saya masuk BI checking".
  const status =
    /\b(?:galbay|gagal\s+bayar|kredit\s+macet|kol(?:ektibilitas)?\s*[2-5]|masuk\s+(?:bi\s*checking|slik)|di-?blacklist\s+(?:bank|bi|ojk)|(?:dikejar|ditagih|didatangi)\s+(?:dc|debt\s+collector)|terlilit\s+(?:utang|hutang|pinjol))\b/gi;
  for (const m of text.matchAll(status)) {
    // "risiko gagal bayar obligasi" is about markets; it is personal data when it is someone's status.
    if (!/^galbay$/i.test(m[0]) && !PERSON_NEAR.test(before(text, m.index, 30))) continue;
    out.push(match('FINANCIAL', m.index, m[0], 'medium'));
  }
  return out;
}

/** Marital status said of a person: "saya sudah cerai", "sekarang janda dengan 2 anak". */
function detectMaritalStatus(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // "Pemohon an. Wulandari, status cerai hidup" names the status in a sentence; a form label ("Status: …") is a field.
  // "sudah 3 tahun menikah", "Bu Wati sudah bercerai": a status that needs no subject in front.
  const re =
    /\b(?:saya|aku|gue|gw|dia|beliau|ibu|bapak|ayah|mama|papa|kakak|adik)\s+(?:(?:sudah|udah|sdh|baru|belum|blm|masih|sekarang|kini|seorang|berstatus|statusnya)\s+)*(cerai(?:\s+(?:hidup|mati))?|bercerai|janda|duda|menikah|kawin|lajang|single|nikah\s+siri|nikah|pisah\s+ranjang)\b|\b(?:sekarang|kini|berstatus|seorang|itu|statusnya)\s+(janda|duda|lajang)\b|\b(janda|duda)(?=\s+(?:anak|beranak|dengan\s+\d|\d|cerai|ditinggal|tanpa\s+anak|muda|kembang)\b)|\bstatus(?:nya)?\s+(?:perkawinan\s+|pernikahan\s+)?(cerai\s+(?:hidup|mati)|janda|duda|kawin|menikah|sudah\s+menikah|belum\s+(?:kawin|menikah)|lajang|nikah\s+siri)\b|\b(pisah\s+ranjang)\b|\b(?:sudah|udah|sdh|telah)\s+(?:\d+\s+tahun\s+(menikah|nikah|berumah\s+tangga)|(bercerai|cerai(?:\s+(?:hidup|mati))?|menjanda|menduda))\b/gi;
  for (const m of text.matchAll(re)) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7]!;
    // "saya menikah tahun depan" is a plan; "saya sudah menikah" or "berstatus janda" is a status.
    if (/^(?:menikah|kawin|nikah)$/i.test(value) && !/\b(?:sudah|udah|sdh|belum|blm|berstatus|status|statusnya|perkawinan|pernikahan|tahun)\s+$/i.test(m[0].slice(0, -value.length))) continue;
    out.push(match('MARITAL_STATUS', m.index + m[0].length - value.length, value, 'medium'));
  }
  return out;
}

function detectReligion(text: string): PiiMatch[] {
  const re =
    /\b(?:beragama|agamanya|agama\s+(?:saya|aku|dia|beliau|kami|mereka))\s+(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Hindu|Buddha|Budha|Konghucu|Khonghucu|Kong Hu Cu)\b/gi;
  const out = [...text.matchAll(re)].map((m) => match('RELIGION', m.index + m[0].length - m[1]!.length, m[1]!, 'high'));
  // An adjective of a person: "saya muslim", "suami saya kristen protestan". Not "umat Muslim" or "Gereja Kristen".
  const adjective =
    /\b(?:saya|aku|gue|gw|dia|beliau|kami|keluarga\s+(?:saya|kami)|(?:suami|istri|ayah|bapak|ibu|mama|papa|ortu|orang\s+tua|anak|adik|kakak|pacar|calon)(?:\s+(?:saya|aku|gue|dia)|nya|ku)?)\s+(?:(?:seorang|itu|adalah|sudah|udah|baru|jadi)\s+)?(muslim(?:ah)?|islam|nasrani|kristiani?|kristen(?:\s+protestan)?|protestan|katolik|katholik|hindu|buddhis|buddha|budha|konghucu|khonghucu|mualaf|muallaf|ateis|atheis|agnostik|non[- ]?muslim)\b/gi;
  for (const m of text.matchAll(adjective)) out.push(match('RELIGION', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  // A conversion: "baru pindah agama, sekarang Kristen", "masuk Islam tahun lalu".
  const conversion =
    /\b(?:pindah\s+agama|murtad|convert|mualaf)\b[^\n.]{0,30}?\b(?:jadi|menjadi|ke|sekarang|kini)\s+(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Hindu|Buddha|Budha|Konghucu|Khonghucu)\b|\bmasuk\s+(Islam|Kristen|Katolik|Hindu|Buddha)\b/gi;
  for (const m of text.matchAll(conversion)) {
    const value = m[1] ?? m[2]!;
    out.push(match('RELIGION', m.index + m[0].length - value.length, value, 'medium'));
  }
  return out;
}

// Indonesian plate region codes (kode wilayah TNKB).
const PLATE_REGIONS =
  'AA|AB|AD|AE|AG|BA|BB|BD|BE|BG|BH|BK|BL|BM|BN|BP|DA|DB|DC|DD|DE|DG|DH|DK|DL|DM|DN|DP|DR|DT|EA|EB|ED|KB|KH|KT|KU|PA|PB|A|B|D|E|F|G|H|K|L|M|N|P|R|S|T|W|Z';

function detectPlates(text: string): PiiMatch[] {
  const re = new RegExp(`(?<![A-Za-z0-9])(?:${PLATE_REGIONS})\\s?\\d{1,4}\\s?[A-Z]{1,3}(?![A-Za-z0-9])`, 'g');
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(re)) {
    const spaced = /\s\d+\s/.test(m[0]);
    const keyword = /\b(plat|nopol|no\.?\s*pol|tnkb|kendaraan|motor|mobil)\b/.test(before(text, m.index));
    if (!spaced && !keyword) continue;
    out.push(match('PLATE', m.index, m[0], keyword ? 'high' : 'medium'));
  }
  // "motor b3456xyz": any case, but only right after a vehicle word.
  const loose = new RegExp(`(?<![A-Za-z0-9])(?:${PLATE_REGIONS})\\s?\\d{1,4}\\s?[A-Z]{1,3}(?![A-Za-z0-9])`, 'gi');
  for (const m of text.matchAll(loose)) {
    if (/\b(plat|nopol|no\.?\s*pol|tnkb|kendaraan|motor|mobil)\b/.test(before(text, m.index, 20))) {
      out.push(match('PLATE', m.index, m[0], 'medium'));
    }
  }
  return out;
}

// Titles between the honorific and the name are skipped: "Bapak Presiden Joko Widodo" \u2192 "Joko Widodo".
const TITLE_WORDS = new Set([
  'bapak', 'ibu', 'pak', 'bu', 'mas', 'mbak', 'kak', 'bang', 'presiden', 'wakil', 'menteri', 'direktur',
  'dokter', 'dr', 'drs', 'dra', 'prof', 'ir', 'h', 'hj', 'guru', 'lurah', 'camat', 'bupati', 'walikota', 'wali',
  'gubernur', 'kepala', 'dosen', 'ketua', 'manajer', 'admin', 'kurir', 'driver', 'ustadz', 'ustadzah', 'sdr',
  'sdri', 'saudara', 'saudari', 'tn', 'ny', 'nn', 'mr', 'mrs', 'ms', 'miss', 'mister', 'koh', 'ko', 'cik', 'ci', 'cici',
  'om', 'tante', 'kang', 'teh', 'bli', 'cak', 'mbok', 'habib', 'gus', 'romo', 'pastor', 'pendeta', 'pdt', 'alm', 'almh',
  'almarhum', 'almarhumah', 'kh', 'dear',
]);
// Words that end (or rule out) a name in chat: "nama saya budi mau refund", "Ibu Kota", "atas nama perusahaan".
const NOT_NAME = new Set(
  (
    'yang dan atau dengan dgn di ke dari dr untuk utk pada dalam ini itu tsb tersebut saya sy aku aq kamu km anda dia ' +
    'beliau kami kita mereka gue gw gua lu nya ya iya yaa ok oke kak sih dong deh nih tuh kok lah kah pun juga aja saja ' +
    'sudah udah sdh belum blm mau ingin pengen pingin minta mohon tolong bisa bisakah boleh akan sedang lagi masih baru ' +
    'tadi kemarin besok nanti sekarang hari sekali sekalian semua para terima kasih makasih selamat pagi siang sore malam ' +
    'halo hai permisi maaf refund transfer tf pesanan pesan order barang paket produk nomor no nik hp wa alamat email ' +
    'rekening rek umur usia lahir tinggal asal sebagai adalah ialah tidak tak gak ga nggak bukan jadi kalau kalo karena ' +
    'krn tapi namun perusahaan kantor toko pt cv ud yayasan koperasi instansi bank kota negara pertiwi jari hamil ' +
    'menyusui rumah tiri mertua kandung terdaftar sendiri ada punya kirim dikirim cek dicek tanya nanya bertanya sama ' +
    'bersama tentang soal mengenai sini situ sana apa siapa gimana bagaimana kenapa mana kapan berapa harap segera ' +
    'langsung dulu lalu kemudian terus menyatakan bahwa yg sekalian islam kristen katolik hindu buddha konghucu ' +
    'jl jln jalan gg gang the and i am is a an of to for want my senin selasa rabu kamis jumat sabtu minggu januari ' +
    'februari maret april mei juni juli agustus september oktober november desember ' +
    // Common words people capitalize in chat ("saya Cuma mau tanya"), roles, groups, and things that get named.
    'cuma hanya pernah sering selalu benar betul yakin setuju kecewa senang puas bingung orang customer pelanggan ' +
    'pembeli penjual member anggota warga mahasiswa siswa karyawan pegawai seller buyer user pengguna manajemen ' +
    'management direksi pimpinan tim team seluruh keluarga pribadi rt rw satpam ojol cs domain file folder tabel ' +
    'table kolom column variabel fungsi function class akun aplikasi app server database program manfaat ' +
    // Institutions: "atas nama Pengendali Data", "atas nama Menteri Keuangan".
    'pengendali prosesor pemerintah kementerian keuangan negeri daerah republik indonesia rakyat dewan lembaga ' +
    'badan dinas direktorat komisi mahkamah pengadilan kepolisian polri tni sekretariat umum nasional pusat ' +
    // What follows a role or a greeting when it is not a name: "Pelanggan Setia", "Karyawan Tetap", "Halo Semua".
    'setia prioritas vip tetap kontrak berprestasi terbaik terhormat yth tercinta terkasih kesayangan aktif harian ' +
    'magang honorer swasta asing lokal premium reguler perorangan individu lama kakak adik semuanya sir madam all ' +
    'everyone there world guys team folks friends bro sis gan min bos boss say sayang beb dek service support ' +
    'masukkan isi ketik pilih enter your sobat ' +
    // Cities, which a greeting or a list can put where a name would be: "Halo Bandung".
    'jakarta bandung surabaya medan semarang makassar palembang bogor depok tangerang bekasi yogyakarta jogja solo ' +
    'malang denpasar bali batam pekanbaru padang manado balikpapan samarinda pontianak banjarmasin ambon jayapura ' +
    'kupang mataram lampung aceh cirebon tasikmalaya sukabumi serang cilegon purwokerto kediri jember madiun ' +
    'magelang salatiga'
  ).split(' '),
);
// Particles inside a name: "Nur Aisyah binti Ahmad", "Van der Berg".
const NAME_PARTICLES = new Set(['bin', 'binti', 'van', 'der', 'de', 'al', 'el', 'da', 'dos']);
const ORGANIZATION = new Set(['pt', 'cv', 'ud', 'toko', 'yayasan', 'koperasi', 'perusahaan', 'bank']);
const NAME_TOKEN = /[ \t]*([A-Za-z][A-Za-z'’-]*\.?)/y;

/**
 * Up to five words starting at `start`, stopping at a word that is not part of a name. Leading titles
 * are skipped. `capitalized` requires each word to start with a capital (for weak triggers like "saya").
 */
function nameAt(text: string, start: number, confidence: Confidence, capitalized = false): PiiMatch | undefined {
  const words: Array<{ start: number; end: number; bare: string }> = [];
  let lowercaseAmbiguous = false; // "saya budi" alone is a name only if a second name follows
  let pos = start;
  while (words.length < 5) {
    NAME_TOKEN.lastIndex = pos;
    const m = NAME_TOKEN.exec(text);
    if (!m) break;
    const word = m[1]!;
    const bare = word.replace(/\.$/, '').toLowerCase();
    const wordStart = m.index + m[0].length - word.length;
    pos = NAME_TOKEN.lastIndex;
    if (!words.length && (TITLE_WORDS.has(bare) || bare === 'adalah' || bare === 'ialah')) continue;
    if (NOT_NAME.has(bare) || bare.endsWith('nya') || (!words.length && NAME_PARTICLES.has(bare))) break;
    if (words.length && TITLE_WORDS.has(bare)) return undefined; // "barangnya buat mbak yuni": not one name
    if (capitalized && !/^[A-Z]/.test(word) && !NAME_PARTICLES.has(bare)) {
      // A cue plus a common name is enough without capitals: "aku andi yg td chat", "saya siti rahayu".
      if (words.length ? !isKnownName(bare) : !GIVEN_NAMES.has(bare) && !AMBIGUOUS_GIVEN_NAMES.has(bare)) break;
      if (!words.length && AMBIGUOUS_GIVEN_NAMES.has(bare)) lowercaseAmbiguous = true;
    }
    words.push({ start: wordStart, end: wordStart + word.length, bare });
    if (word.endsWith('.') && bare.length > 1) break; // "… Budi." ends the sentence; "M. Rizky" goes on
  }
  while (words.length && NAME_PARTICLES.has(words[words.length - 1]!.bare)) words.pop();
  if (!words.length || ORGANIZATION.has(words[0]!.bare)) return undefined;
  if (lowercaseAmbiguous && words.length === 1) return undefined;
  const value = text.slice(words[0]!.start, words[words.length - 1]!.end).replace(/[.,]+$/, '');
  if (value.replace(/[^A-Za-z]/g, '').length < 2) return undefined;
  return match('NAME', words[0]!.start, value, confidence);
}

// Phrases that introduce a name, in any case: "atas nama budi santoso", "nama saya Rina", "bernama Rizky".
const NAME_INTRO =
  /\b(?:a\.\s?n\.?|a\/n|an\.|atas\s+nama|nama\s+(?:lengkap\s+)?(?:saya|aku|ku|gue|gw|sy)|namaku|namanya|nama\s+(?:lengkap\s+)?(?:anak|ibu|bapak|ayah|suami|istri|adik|kakak|teman|orang\s+tua)\s+(?:saya|aku|kami|gue)|nama\s+(?:akun|pengguna|pemilik|penerima|pengirim|pelanggan|nasabah|pasien|siswa|karyawan|pemesan)|bernama|dengan\s+nama|my\s+name\s+is|nami\s+(?:abdi|kulo|kula|simkuring|sim\s+kuring)|jeneng(?:ku|\s+(?:kula|kulo|aku|kulo))|asma\s+kula)(?![A-Za-z])[ \t]*(?:[:=][ \t]*)?/gi;
// Weaker cues, so the name itself must be capitalized: "saya Rina Wulandari", "halo, dengan Agus", "Penerima Budi".
const NAME_CUE =
  /\b(?:saya|aku|gue|gw)[ \t]*,?[ \t]+|\b(?:halo|hai|hallo|selamat\s+(?:pagi|siang|sore|malam))[ \t]*,?[ \t]*(?:ini|dengan|dgn)[ \t]+|\b(?:penerima|pengirim|pemesan|pembeli)[ \t]+/gi;
const HONORIFIC = /(?<![\w-])(?:Bapak|Bpk\.?|Bp\.|Ananda|Ibu|Pak|Bu|Sdr\.?|Sdri\.?|Saudara|Saudari|Mas|Mbak|Kak|Bang|Tn\.|Ny\.|Nn\.)[ \t]+/gi;
// Titles and forms of address in their usual case only: "CI Pipeline" and "Uni Eropa" are not people.
const TITLE_CUE =
  /(?<![\w-])(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Mister|Dr\.|Prof\.|Ir\.|Drs\.|Dra\.|H\.|Hj\.|KH\.|Pdt\.|Alm\.|Almh\.|[Aa]lmarhum(?:ah)?|[Kk]oh?|[Cc]ik|[Cc]ici|[Oo]m|[Tt]ante|[Kk]ang|[Bb]li|[Cc]ak|[Mm]bok|[Hh]abib|[Gg]us|[Uu]stadz(?:ah)?|[Rr]omo|[Pp]astor|[Pp]endeta)[ \t]+/g;
// Roles that a name follows in support tickets, reports, and logs: "Pelanggan Budi Santoso", "Kurir Supardi".
const ROLE_CUE =
  /\b(?:pelanggan|customer|konsumen|pembeli|pemesan|nasabah|pasien|patient|kurir|driver|sopir|supir|karyawan|karyawati|pegawai|staf|staff|siswa|siswi|murid|santri|mahasiswa|mahasiswi|tamu|pemilik|penyewa|penghuni|peminjam|debitur|pelapor|terlapor|korban|pelaku|tersangka|terdakwa|saksi|kepala\s+keluarga|penggugat|tergugat|pemohon|termohon|pewaris|klien|konseli|tertanggung|penumpang|berinisial|inisial|istrinya|suaminya|anaknya|adiknya|kakaknya|ayahnya|ibunya|wakilnya|atasannya|temannya|tetangga|pacar|calon|bayi(?:[ \t]+(?:laki-laki|perempuan))?|balita|cucu(?:nya)?|keponakan(?:nya)?|anggota|member|warga|jamaah|jemaat|u\/|utk\.?|untuk|kepada|kpd\.?)[ \t]+/gi;
const LOOSE_ROLE = /^(?:customer|patient|driver|staff|staf|tamu|calon|pacar|korban|saksi|pelaku|tetangga|utk|untuk|kepada|kpd|anggota|member|warga|jamaah|jemaat)\b/i;
// Greetings that open a message to someone: "Halo Budi,", "Dear Mr. Hendra Gunawan,".
// "Pagi, Budi!" opens a line; "Sinar Pagi, Bogor" in the middle of one is a village.
const GREETING_CUE =
  /(?:^|(?<=[\s,.!]))(?:halo|hallo|hai|hi|hello|hey|dear|selamat\s+(?:pagi|siang|sore|malam)|assalamu'?alaikum)[ \t]*,?[ \t]+|^[ \t]*(?:pagi|siang|sore|malam)[ \t]*,?[ \t]+/gim;

function isKnownName(bare: string): boolean {
  return GIVEN_NAMES.has(bare) || AMBIGUOUS_GIVEN_NAMES.has(bare) || FAMILY_NAMES.has(bare) || SECOND_NAMES.has(bare);
}

// Javanese names the list cannot hold one by one end the same way: Hartini, Sumiyati, Rosmawati, Suryanto, Hadiyono.
const JAVANESE_NAME = /^[a-z]{2,}(?:wati|yati|iyati|ningsih|ningrum|astuti|tini|rini|yanto|yono|wanto|harjo)$/;

/** Names introduced without a colon: "a.n. Budi Santoso", "nama saya budi", "Bapak Budi", "bu sari". */
function detectNames(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const add = (found: PiiMatch | undefined) => found && out.push(found);
  for (const m of text.matchAll(NAME_INTRO)) add(nameAt(text, m.index + m[0].length, 'high'));
  for (const m of text.matchAll(NAME_CUE)) add(nameAt(text, m.index + m[0].length, 'medium', true));
  for (const m of text.matchAll(HONORIFIC)) {
    // "Ibu Sari Dewi di Depok" stops at "di". After "bapak/ibu/mbak" a lowercase name is common in chat
    // ("bapak ahmad"); the short ones ("kak", "pak", "bu") too often just address the reader.
    const lowercaseOk = /^(?:bapak|ibu|mbak)\b/.test(m[0]);
    add(nameAt(text, m.index + m[0].length, 'medium', !lowercaseOk));
  }
  for (const m of text.matchAll(TITLE_CUE)) add(nameAt(text, m.index + m[0].length, 'medium', true));
  for (const m of text.matchAll(ROLE_CUE)) {
    const found = nameAt(text, m.index + m[0].length, 'medium', true);
    // "Kurir JNE" is a company; "berinisial RK" is the only place two capitals are a person.
    if (!found || (/^[A-Z]{2,5}$/.test(found.value) && !/inisial/i.test(m[0]))) continue;
    // "untuk Google Chrome", "Driver Printer Canon", "Tamu Undangan": after a preposition or a word that is also
    // English or generic, at least one word must be a known name.
    if (LOOSE_ROLE.test(m[0]) && !found.value.split(/\s+/).some((w) => isKnownName(w.toLowerCase()))) continue;
    add(found);
  }
  for (const m of text.matchAll(GREETING_CUE)) {
    const found = nameAt(text, m.index + m[0].length, 'medium', true);
    // A greeting names someone only when the name closes it: "Halo Budi," but not "Halo Kak, Saya mau" or
    // "Hello, Node.js User!".
    if (found && /^[ \t]*(?:[,!:\r\n]|\.(?!\S)|$)/.test(text.slice(found.end))) add(found);
  }
  // "tadi budi bilang …": reported speech names whoever spoke, unless that is a role or a thing.
  for (const m of text.matchAll(REPORTED_SPEECH)) {
    const word = m[1]!;
    const bare = word.toLowerCase();
    if (NOT_NAME.has(bare) || TITLE_WORDS.has(bare) || NOT_A_SPEAKER.has(bare)) continue;
    out.push(match('NAME', m.index + /^\S+[ \t]+/.exec(m[0])![0].length, word, 'medium'));
  }
  // "halo kak ini rina, …": a one-word lowercase self-introduction, only when a comma or line end closes it.
  for (const m of text.matchAll(GREETING_SELF)) {
    const found = nameAt(text, m.index + m[0].length, 'medium');
    if (found && !/\s/.test(found.value) && /^\s*(?:[,.!\n]|$)/.test(text.slice(found.end))) add(found);
  }
  return out;
}

const REPORTED_SPEECH =
  /\b(?:tadi|kemarin|kemaren|katanya|kata)[ \t]+([A-Za-z]{3,15})[ \t]+(bilang|ngomong|nanya|nanyain|minta|cerita|nelpon|telpon|ngechat|nge-?wa|kasih\s+tau|ngasih\s+tau)\b/gi;
// Speakers that are relatives, roles, or software rather than a named person.
const NOT_A_SPEAKER = new Set(
  ('mama mamah papa papah ayah bunda emak abah suami istri anak adik adek kakak abang teman temen sahabat tetangga ' +
    'bos atasan boss orangnya mereka kalian sistem system aplikasi website web bot google kurir driver ojol sopir ' +
    'penjual pembeli seller admin cs operator petugas dokter perawat bidan guru dosen polisi pacar doi beliau').split(' '),
);

const GREETING_SELF =
  /\b(?:halo|hai|hallo|hi|permisi|assalamualaikum|selamat\s+(?:pagi|siang|sore|malam))[ \t]*,?[ \t]*(?:(?:kak|kakak|min|admin|gan|sis|mas|mbak|pak|bu|bang)[ \t]*,?[ \t]+)?(?:ini|sama|dengan|dgn)[ \t]+/gi;

// Chat export lines: Android "12/10/26 09.14 - Dewi Lestari: …", iOS "[12/10/26 09.14.33] Dewi Lestari: …",
// and the export title "Chat WhatsApp dengan Dewi Lestari". The sender is whoever saved that contact name.
const CHAT_SENDER =
  /^‎?\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?[ \t]+\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?:[ \t ]?[AP]M)?\]?(?:[ \t]+-)?[ \t]+([^:\n]{1,60}?):[ \t]/dgm;
const CHAT_TITLE = /^(?:Chat WhatsApp dengan|WhatsApp Chat with|Chat dengan|Riwayat chat dengan)[ \t]+([^\n]{1,60}?)[ \t]*$/dgim;
// Senders that are a business or a system role, not a customer.
const NOT_A_PERSON =
  /\b(?:toko|shop|store|official|olshop|admin|cs|customer service|support|tim|team|pt|cv|ud|bot|system|sistem|info|layanan|grosir)\b|^(?:error|warn|warning|info|debug|trace|fatal|notice)$/i;

function detectChatSenders(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const re of [CHAT_SENDER, CHAT_TITLE]) {
    for (const m of text.matchAll(re)) {
      const sender = m[1]!.replace(/^~\s*/, '').trim();
      // Unsaved contacts show as a number; the phone detector already covers those.
      if (!/\p{L}/u.test(sender) || /^[+\d\s()-]+$/.test(sender) || NOT_A_PERSON.test(sender)) continue;
      const start = m.indices![1]![0] + m[1]!.indexOf(sender);
      out.push(match('NAME', start, sender, 'high'));
    }
  }
  return out;
}

// A word right before a capitalized run that makes it a place or an organization: "Jl. Ahmad Yani", "RS Siti
// Khadijah", "Universitas Ahmad Dahlan", "Toko Budi Jaya".
const PLACE_WORDS = new Set(
  (
    'jl jln jalan gg gang lorong komp komplek kompleks perum perumahan cluster universitas univ institut sekolah ' +
    'fakultas akademi politeknik kampus sd sdn smp smpn sma sman smk smkn mi mts ma pondok ponpes pesantren masjid ' +
    'musholla mushola langgar gereja pura vihara klenteng rs rsu rsud rsia rsj sakit puskesmas klinik apotek toko ' +
    'warung pt cv ud yayasan koperasi bank stasiun terminal bandara pelabuhan gedung wisma hotel mall plaza pasar ' +
    'taman museum stadion lapangan gor gelora kampung desa kelurahan kecamatan kabupaten kota provinsi gunung ' +
    'pantai pulau sungai danau monumen tugu bendungan rusun apartemen tower blok aula balai lembaga dinas kantor ' +
    'perpustakaan piala liga festival bung way tanjung teluk ujung muara kuala bukit lubuk pematang sei ' +
    // Batak and Karo villages are often a clan name after one of these: "Lumban Siregar", "Pintu Pohan".
    'lumban lobu huta dolok bandar urung nagori talun pamah perkebunan sosor aek banjar pintu raja siraja debata ' +
    'kel kec kab kp ds dsn ' +
    // Products and events are named like people too: "Paket Hemat Ramadhan", "Promo Spesial Kartini".
    'paket promo program diskon menu edisi spesial special event lomba produk varian'
  ).split(' '),
);
// Words that end a run of names in a place name: "Indra Jaya", "Laras Selatan", "Sido Makmur".
const PLACE_SUFFIX = new Set(
  ('jaya makmur raya selatan utara barat timur tengah permai asri sejahtera sentosa abadi mulya baru lama damai ' +
    'harapan mekar gemilang kencana rejo mukti karya bakti jitu pahlawan').split(' '),
);
const CAPITALIZED_RUN = /(?<![\w@.'’-])[A-Z][A-Za-z'’-]*\.?(?:[ \t]+(?:[A-Z][A-Za-z'’-]*\.?|bin|binti|van|der|de|al|el))+/g;

/**
 * Names with no cue around them, recognized by their parts: a common given name before another name ("Hendra
 * Gunawan", "SITI RAHAYU" in a bank statement), a family or clan name ("Togar Simanjuntak"), a Balinese name ("I Made
 * Wirawan"), or a Chinese-Indonesian one ("Lim Swie Hong").
 */
function detectKnownNames(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(CAPITALIZED_RUN)) {
    const words = [...m[0].matchAll(/\S+/g)].map((w) => ({
      start: m.index + w.index,
      end: m.index + w.index + w[0].replace(/[.,]+$/, '').length,
      word: w[0],
      bare: w[0].replace(/\.$/, '').toLowerCase(),
    }));
    const prev = /([A-Za-z]+)\.?[ \t]*$/.exec(text.slice(Math.max(0, m.index - 30), m.index))?.[1]?.toLowerCase();
    if (prev && PLACE_WORDS.has(prev)) continue;
    const nameish = (k: number) => {
      const w = words[k];
      if (!w) return false;
      if (NAME_PARTICLES.has(w.bare)) return k + 1 < words.length; // "bin Abdullah", never a trailing "bin"
      return /^[A-Z]/.test(w.word) && !NOT_NAME.has(w.bare) && !TITLE_WORDS.has(w.bare) && !ORGANIZATION.has(w.bare) &&
        !PLACE_WORDS.has(w.bare) && !PLACE_SUFFIX.has(w.bare) && !w.bare.endsWith('nya');
    };
    const extend = (from: number) => {
      let k = from;
      while (k < words.length && k - from < 5 && nameish(k)) {
        k++;
        // "… Togar Simanjuntak. Tamu: …" ends with the sentence; "M. Rizky" goes on.
        if (words[k - 1]!.word.endsWith('.') && words[k - 1]!.bare.length > 1) break;
      }
      while (k > from && NAME_PARTICLES.has(words[k - 1]!.bare)) k--;
      return k - from;
    };
    for (let i = 0; i < words.length - 1; i++) {
      const w = words[i]!;
      if (PLACE_WORDS.has(w.bare) || ORGANIZATION.has(w.bare)) break; // the rest names the place
      const next = words[i + 1]!.bare;
      let len = 0;
      // "I" is also English, so it is checked before the other rules rule it out.
      if ((w.word === 'I' || w.word === 'Ni') && BALINESE_NAMES.has(next)) len = 1 + extend(i + 1);
      else if (!nameish(i)) continue;
      else if (CHINESE_FAMILY_NAMES.has(w.bare) && [1, 2].every((d) => nameish(i + d) && /^[A-Za-z]{2,5}$/.test(words[i + d]!.word))) len = 3;
      else if (GIVEN_NAMES.has(w.bare) && nameish(i + 1)) len = extend(i);
      // "Dewi Lestari", "Wahyu Hidayat"; not two words that are both also common nouns ("Permata Intan").
      else if (
        AMBIGUOUS_GIVEN_NAMES.has(w.bare) && nameish(i + 1) &&
        (GIVEN_NAMES.has(next) || FAMILY_NAMES.has(next) || SECOND_NAMES.has(next))
      ) {
        len = extend(i);
      } else {
        // A family name after one unknown word ("Togar Simanjuntak") or after known names only. "BI-FAST CR SITI
        // RAHAYU" starts at SITI, not at BI-FAST. Two clan names in a row ("Simamora Hasibuan") name a village.
        for (let j = i + 1; j <= i + 3 && nameish(j); j++) {
          if (!FAMILY_NAMES.has(words[j]!.bare)) {
            if (!isKnownName(words[j]!.bare)) break;
            continue;
          }
          const lone = j === i + 1 && !FAMILY_NAMES.has(w.bare);
          if (lone || GIVEN_NAMES.has(w.bare) || AMBIGUOUS_GIVEN_NAMES.has(w.bare)) len = Math.max(j - i + 1, extend(i));
          break;
        }
      }
      if (len < 2) continue;
      const last = words[i + len - 1]!;
      out.push(match('NAME', w.start, text.slice(w.start, last.end), 'medium'));
      i += len - 1;
    }
  }
  return out;
}

// Closings that put the sender's name on the same or the next line: "Salam,\nRina Kartika Sari".
const SIGN_OFF =
  /^[ \t]*(?:salam(?:\s+hangat)?|hormat\s+(?:saya|kami)|terima\s*kasih|makasih|regards|best\s+regards|kind\s+regards|warm\s+regards|best|thanks|thank\s+you|cheers|sincerely|yours\s+sincerely|wassalam(?:u'?alaikum)?)[ \t]*[,.!]?[ \t]*(?:\r?\n[ \t]*)+/gim;

function detectSignatures(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(SIGN_OFF)) {
    const start = m.index + m[0].length;
    const lineEnd = text.indexOf('\n', start);
    const line = text.slice(start, lineEnd === -1 ? text.length : lineEnd).replace(/\r$/, '').trim();
    const found = nameAt(text, start, 'medium', true);
    // The whole line is the name (titles and degrees aside): "Agus Salim Nasution", "Dr. Rina, M.Sc.".
    if (found && found.value.length >= line.replace(/^(?:\w+\.\s*)+/, '').replace(/,.*$/, '').length - 1) out.push(found);
  }
  // A review or a quote signed with a dash: "… sudah ramah. - Rizal, Makassar". A dash also starts list items, so the
  // name must be a known one and close the line or be followed by a comma.
  for (const m of text.matchAll(/(?:^|(?<=[.!?)"”]))[ \t]*[-–—~][ \t]*(?=[A-Z])/gm)) {
    const found = nameAt(text, m.index + m[0].length, 'medium', true);
    if (!found || !found.value.split(/\s+/).some((w) => isKnownName(w.toLowerCase()))) continue;
    if (/^[ \t]*(?:,|\r?\n|$)/.test(text.slice(found.end))) out.push(found);
  }
  return out;
}

/** The display name in front of an e-mail address: "From: Budi Santoso <budi.s@gmail.com>". */
function detectDisplayNames(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const re = /(?:^|(?<=[\s:,;(]))"?((?:[A-Z][A-Za-z'’.-]*[ \t]+){0,4}[A-Z][A-Za-z'’.-]*)"?[ \t]*<[^<>\s@]+@[^<>\s]+>/gm;
  for (const m of text.matchAll(re)) {
    const group = m.index + m[0].indexOf(m[1]!);
    const groupEnd = group + m[1]!.length;
    // The name is what reaches the "<": "MIT License. Einar Otto Stangvik <…>" is Einar Otto Stangvik.
    for (const w of m[1]!.matchAll(/\S+/g)) {
      const found = nameAt(text, group + w.index, 'high', true);
      if (found && found.end >= groupEnd - 1) {
        out.push(found);
        break;
      }
    }
  }
  return out;
}

// Words after "@" that are code: JSDoc tags, CSS at-rules, decorators, and annotations.
const CODE_AT = new Set(
  (
    'param params arg argument returns return type typedef template example deprecated see link throws throw ' +
    'default since version author license preserve todo fixme internal private public protected override readonly ' +
    'module namespace callback property prop event fires listens description summary inheritdoc abstract async ' +
    'media import keyframes supports layer tailwind apply use forward include mixin extend charset container page ' +
    'font-face component injectable input output test before after inject directive pipe ngmodule effect select ' +
    'staticmethod classmethod dataclass pytest app router api client mock patch fixture ts-ignore ts-expect-error ' +
    'jsx jsximportsource vite babel types entity column table get post put delete controller service observable ' +
    'satisfies overload implements augments class constructor enum function member memberof method name this ' +
    'constant const copyright exports external file fileoverview global ignore instance interface kind lends mixes ' +
    'package requires static tutorial yields alias generator beta alpha experimental remarks typeparam defaultvalue ' +
    'label linkcode linkplain virtual sealed decorator args options props context state value data'
  ).split(' '),
);
const HANDLE_CUE = /\b(?:ig|instagram|insta|tiktok|twitter|threads|telegram|tele|dm|akun|account|follow|mention|tag|username|handle|fb|facebook|line|youtube|yt)\b/;

/** Social media handles in chat and tickets: "cek DM dari @siti.rahayu88". Not "@param", "@media", or "@types/node". */
function detectHandles(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // After a space or punctuation, never inside a word or an address ("b***@gmail.com").
  for (const m of text.matchAll(/(?<![^\s(,:;"'[])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)(?![\w@/(-]|\.\w)/g)) {
    const handle = m[1]!;
    if (CODE_AT.has(handle.toLowerCase()) || CODE_AT.has(handle.split('.')[0]!.toLowerCase()) || /^\d+$/.test(handle)) continue;
    if (/\.(?:com|net|org|id|io|co|dev|app|me)$/i.test(handle)) continue; // a domain
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lead = text.slice(lineStart, m.index);
    // A decorator stands alone at the start of a line ("@pytest.fixture"); doc comments are code ("* @param").
    if (/^\s*(?:\*|\/\/|#)/.test(lead)) continue;
    if (!lead.trim() && !text.slice(m.index + m[0].length).split('\n', 1)[0]!.trim()) continue;
    const shaped = /[\d._]/.test(handle) && handle.length >= 5 && /^[a-z0-9_.]+$/.test(handle);
    if (!shaped && !HANDLE_CUE.test(before(text, m.index, 40))) continue;
    out.push(match('NAME', m.index + 1, handle, 'medium'));
  }
  return out;
}

/**
 * A label on its own line and the value on the next, as receipts, bank transfer screens, and KTP scans without colons
 * lay them out: "Penerima\nDEWI LESTARI", "Agama\nISLAM".
 */
const STACKED_TYPES: ReadonlySet<PiiType> = new Set([
  'NAME', 'NIK', 'KK', 'NPWP', 'NIP', 'SIM', 'BPJS', 'PHONE', 'BANK_ACCOUNT', 'EMAIL', 'BIRTH_DATE', 'RELIGION',
  'GENDER', 'MARITAL_STATUS',
]);
const RELIGION_WORD = /^(?:islam|kristen(?:\s+protestan)?|protestan|katolik|katholik|hindu|buddha|budha|konghucu|khonghucu|kepercayaan.*)$/i;
const MARITAL_WORD = /^(?:kawin|belum\s+kawin|cerai\s+hidup|cerai\s+mati|menikah|belum\s+menikah|lajang|janda|duda|single|married|divorced|widowed)$/i;

function detectStackedLabels(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // Lines split on "\n" only, so a CRLF file keeps the value on the very next line.
  const lines: Array<{ start: number; text: string }> = [];
  for (let pos = 0; pos <= text.length; ) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    lines.push({ start: pos, text: text.slice(pos, end).replace(/\r$/, '') });
    pos = end + 1;
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    const label = lines[i]!.text.trim();
    if (!label || label.length > 30 || /[:=]/.test(label) || label.split(/\s+/).length > 3) continue;
    const type = fieldType(label);
    if (!type || !STACKED_TYPES.has(type)) continue;
    const next = lines[i + 1]!;
    const value = next.text.trim();
    if (!value || value.length > 60 || fieldType(value) || !isPlausibleValue(type, value, label)) continue;
    if (type === 'NAME' && !value.split(/\s+/).every((w) => /^[A-Z]/.test(w) && !NOT_NAME.has(w.toLowerCase()))) continue;
    if (type === 'RELIGION' && !RELIGION_WORD.test(value)) continue;
    if (type === 'MARITAL_STATUS' && !MARITAL_WORD.test(value)) continue;
    out.push(match(type, next.start + next.text.indexOf(value), value, 'medium'));
  }
  return out;
}

/**
 * KTP scans that lost their colons keep label and value on one line: "Jenis Kelamin LAKI-LAKI", "Agama KRISTEN".
 * The values come from a closed list, so nothing else on such a line is taken.
 */
function detectColonlessLabels(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const re =
    /^[ \t]*(Jenis[ \t]+Kelamin|Kelamin|Agama|Status[ \t]+Perkawinan|Status[ \t]+Kawin|Perkawinan)[ \t]+(?![:=])([A-Za-z][A-Za-z -]{1,24}?)(?=[ \t]*(?:\r?$|[ \t]{2,}|[ \t]+(?:Gol|Golongan|RT|RW)\b))/gim;
  for (const m of text.matchAll(re)) {
    const type = fieldType(m[1]!);
    const value = m[2]!;
    if (type === 'GENDER' && !GENDER_WORD_RE.test(value)) continue;
    if (type === 'RELIGION' && !RELIGION_WORD.test(value)) continue;
    if (type === 'MARITAL_STATUS' && !MARITAL_WORD.test(value)) continue;
    if (type) out.push(match(type, m.index + m[0].length - value.length, value, 'medium'));
  }
  return out;
}
const GENDER_WORD_RE = /^(?:laki-?\s?laki|lelaki|perempuan|pria|wanita)$/i;

/** A name in brackets right after a phone number: "WA: 0812 3456 7890 (Andi)", "0813-1111-2222 (Bu Sari)". */
function detectPhoneOwners(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const re =
    /(?:\+62|0062|62|0)[ \t-]?8[\d \t.-]{7,16}\d[ \t]*\([ \t]*((?:(?:Pak|Bu|Bapak|Ibu|Mas|Mbak|Kak|Bang)[ \t]+)?[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2})[ \t]*\)/g;
  for (const m of text.matchAll(re)) {
    const name = m[1]!;
    const words = name.split(/[ \t]+/).map((w) => w.toLowerCase());
    if (words.some((w) => NOT_NAME.has(w) && !TITLE_WORDS.has(w))) continue; // "(Kantor)", "(Rumah)", "(WA)"
    out.push(match('NAME', m.index + m[0].lastIndexOf(name), name, 'medium'));
  }
  return out;
}

/** `user=dimas.anggara` in a logfmt line names a person; `user=root` or `user=postgres` is an account. */
function detectLogUsers(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(/(?<![\w.-])(?:user|usr|login|uname)=(["']?)([A-Za-z][\w.-]{2,40})\1(?=[\s,;&]|$)/g)) {
    const user = m[2]!;
    if (!user.split(/[._-]+/).some((w) => isKnownName(w.toLowerCase().replace(/\d+$/, '')))) continue;
    out.push(match('NAME', m.index + m[0].length - user.length - m[1]!.length, user, 'medium'));
  }
  return out;
}

/** Chat-app copies with only a time: Slack "[10:21] rizky_pratama: …", Discord, IRC logs. */
function detectTimedSenders(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(/^\[\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:[ \t]?[AP]M)?\][ \t]+([A-Za-z][\w. -]{1,38}?):[ \t]/dgm)) {
    const sender = m[1]!;
    if (NOT_A_PERSON.test(sender)) continue;
    // A log level or a service ("[10:21] Server: ready") is not a person: a handle shape or a known name is.
    const shaped = /^[a-z][a-z0-9]*[._][a-z0-9._]+$/.test(sender);
    if (!shaped && !sender.split(/[ ._-]+/).some((w) => isKnownName(w.toLowerCase()))) continue;
    out.push(match('NAME', m.indices![1]![0], sender, 'medium'));
  }
  return out;
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

/** Form fields and tables in HTML: `<input name="nama" value="…">`, `<th>Nama</th>` over `<td>Budi Santoso</td>`. */
function detectHtml(text: string): PiiMatch[] {
  if (!/<(?:input|td|th)\b/i.test(text)) return [];
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(/<input\b[^>]*>/gi)) {
    const name = /\b(?:name|id)\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    const value = /\bvalue\s*=\s*(["'])([^"']*)\1/i.exec(m[0]);
    const type = name ? fieldType(name) : undefined;
    if (!type || !value || !isPlausibleValue(type, value[2]!, name!)) continue;
    out.push(match(type, m.index + value.index + value[0].indexOf(value[2]!, 1), value[2]!, 'high'));
  }
  let columns: Array<PiiType | undefined> | undefined;
  let headers: string[] = [];
  for (const row of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<(t[hd])\b[^>]*>([^<]*)<\/t[hd]>/gi)].map((c) => ({
      header: c[1]!.toLowerCase() === 'th',
      text: decodeEntities(c[2]!).trim(),
      start: row.index + row[0].indexOf(row[1]!) + c.index + c[0].indexOf('>') + 1,
      raw: c[2]!,
    }));
    if (!cells.length) continue;
    const types = cells.map((c) => (c.text.length <= 40 ? fieldType(c.text) : undefined));
    // "<th>Nama</th><td>Budi Santoso</td>": a label cell and its value.
    if (cells.length === 2 && types[0] && !types[1]) {
      const [label, cell] = cells as [(typeof cells)[0], (typeof cells)[0]];
      if (cell.text && isPlausibleValue(types[0], cell.text, label.text)) {
        out.push(match(types[0], cell.start + cell.raw.indexOf(cell.text.slice(0, 1)), cell.raw.trim(), 'high'));
      }
      continue;
    }
    if (cells.every((c) => c.header) || (!columns && types.some(Boolean) && cells.every((c) => !/\d{3}/.test(c.text)))) {
      columns = types;
      headers = cells.map((c) => c.text);
      continue;
    }
    if (!columns) continue;
    cells.forEach((c, i) => {
      const type = columns![i];
      if (!type || !c.text || !isPlausibleValue(type, c.text, headers[i]!)) return;
      out.push(match(type, c.start + c.raw.indexOf(c.raw.trim()), c.raw.trim(), isGenericNameKey(headers[i]!) ? 'medium' : 'high'));
    });
  }
  return out;
}

// HL7 v2 segments from hospital systems: field number → what it holds.
const HL7_FIELDS: Record<string, Record<number, PiiType>> = {
  PID: { 5: 'NAME', 6: 'NAME', 7: 'BIRTH_DATE', 8: 'GENDER', 11: 'ADDRESS', 13: 'PHONE', 14: 'PHONE', 19: 'NIK' },
  NK1: { 2: 'NAME', 4: 'ADDRESS', 5: 'PHONE', 6: 'PHONE' },
  DG1: { 3: 'HEALTH', 4: 'HEALTH' },
  IN1: { 16: 'NAME' },
};

/** "PID|1||RM-00123||SUSANTO^BUDI||19800412|M": every field a segment defines as personal, whatever its content. */
function detectHl7(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(/^(PID|NK1|DG1|IN1)\|[^\r\n]*/gm)) {
    const fields = HL7_FIELDS[m[1]!]!;
    let pos = m.index;
    m[0].split('|').forEach((value, i) => {
      const type = fields[i];
      if (type && value.replace(/[\^~&\s]/g, '')) {
        out.push(match(type, pos, value.replace(/[\^~]+$/, ''), 'high'));
      }
      pos += value.length + 1;
    });
  }
  return out;
}

// UU PDP Article 4: criminal records. Phrases that say it of a person, not news about crime in general.
const CRIME = '[a-z]+(?:\\s+(?:online|anak|uang|dana|berat|ringan|narkotika|pidana))?';
const CRIMINAL =
  new RegExp(
    `\\b(?:mantan|eks|bekas)\\s+(?:napi|narapidana|tahanan|tapol|terpidana|residivis)(?:\\s+kasus\\s+${CRIME})?` +
    `|\\bresidivis(?:\\s+kasus\\s+${CRIME})?` +
    `|\\b(?:napi|narapidana|terpidana|tersangka|terdakwa|terjerat|tersandung|terlibat)\\s+kasus\\s+${CRIME}` +
    `|\\bpernah\\s+(?:dipenjara|dibui|dipidana|ditahan|dihukum(?:\\s+penjara)?|masuk\\s+(?:penjara|bui|lapas|rutan)|ditangkap(?:\\s+polisi)?)(?:\\s+(?:selama\\s+)?\\d+\\s+(?:tahun|bulan))?(?:\\s+(?:karena\\s+|atas\\s+)?kasus\\s+${CRIME})?` +
    `|\\bdivonis\\s+\\d+\\s+(?:tahun|bulan)(?:\\s+penjara)?` +
    // "SKCK: ada catatan kasus penggelapan", "catatan kepolisian kasus KDRT".
    `|\\bcatatan\\s+(?:(?:kriminal|kepolisian|pidana)\\s+)?kasus\\s+${CRIME}` +
    // Penjelasan Pasal 4 ayat (2) huruf d: "pencantuman dalam daftar pencegahan atau penangkalan".
    `|\\b(?:masuk|dimasukkan\\s+ke|tercantum\\s+di)\\s+(?:dalam\\s+)?daftar\\s+(?:cekal|pencegahan|penangkalan|hitam\\s+imigrasi|pencarian\\s+orang|dpo|buronan)` +
    `|\\b(?:dicekal|berstatus\\s+(?:dpo|buron(?:an)?)|masuk\\s+dpo|jadi\\s+(?:dpo|buron(?:an)?))\\b` +
    // "baru keluar lapas", "bebas dari penjara tahun lalu", "kasusnya penipuan".
    `|\\b(?:keluar|bebas)\\s+(?:dari\\s+)?(?:lapas|lp|penjara|bui|rutan|tahanan)\\b|\\bkasusnya\\s+${CRIME}`,
    'gi',
  );

function detectCriminal(text: string): PiiMatch[] {
  return [...text.matchAll(CRIMINAL)].map((m) => match('CRIMINAL_RECORD', m.index, m[0], 'medium'));
}

/**
 * Identifiers glued to letters, which the digit-run and phone detectors leave alone: "KTP_3201…0001.jpg",
 * "NIK3201…", "wa081234567890". A NIK must validate; a phone must follow a phone label.
 */
function detectGluedIds(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(/(?<=[A-Za-z_])\d{16}(?![\dA-Za-z])/g)) {
    const prefix = /[A-Za-z_]+$/.exec(text.slice(Math.max(0, m.index - 20), m.index))![0];
    const head = text[m.index - prefix.length - 1];
    // "a3f…" in a hash has digits before the letters; a lone letter is too little to go on.
    if ((head !== undefined && /\d/.test(head)) || prefix.replace(/_/g, '').length < 2 && !prefix.includes('_')) continue;
    if (parseNik(m[0]).valid) out.push(match('NIK', m.index, m[0], 'high'));
  }
  for (const m of text.matchAll(/(?<=[A-Za-z])(?:\+?62|0)8\d{8,11}(?!\d)/g)) {
    const label = /[A-Za-z.]+$/.exec(text.slice(Math.max(0, m.index - 12), m.index))![0].toLowerCase();
    if (PHONE_LABELS.has(label) && parsePhone(m[0]).valid) out.push(match('PHONE', m.index, m[0], 'high'));
  }
  return out;
}

const DIGIT_WORD = '(?:nol|kosong|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan)';

/** A phone number read out in a voice-bot or call transcript: "nol delapan satu dua tiga …". */
function detectSpokenPhones(text: string): PiiMatch[] {
  const re = new RegExp(`\\b(?:nol|kosong)[\\s,.-]+delapan(?:[\\s,.-]+${DIGIT_WORD}){8,11}\\b`, 'gi');
  return [...text.matchAll(re)].map((m) => match('PHONE', m.index, m[0], 'medium'));
}

/**
 * A single common given name in running text, not at the start of a sentence: "kepala keluarga Bambang", "tadi
 * dikirim Joko". A sentence may start with any capitalized word, so there it needs a cue.
 */
function detectLoneGivenNames(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(/(?<![\w@.'’-])[A-Z][a-z]{2,14}(?![\w'’-]|\.\w|[ \t]+[A-Z])/g)) {
    const bare = m[0].toLowerCase();
    if (!GIVEN_NAMES.has(bare) && !JAVANESE_NAME.test(bare)) continue;
    const lead = text.slice(Math.max(0, m.index - 30), m.index);
    // Not at a sentence or line start, and not after a capitalized word ("Toko Batik Sekar").
    if (!/(?:(?<![A-Za-z])[a-z]+|,)[ \t]+$/.test(lead)) continue;
    const prev = /([A-Za-z]+)[ \t]+$/.exec(lead)?.[1]?.toLowerCase();
    // "tinggal di Wina", "arah Malik": after a word of place, a lone name is a village.
    if (prev && (PLACE_WORDS.has(prev) || ORGANIZATION.has(prev) || /^(?:di|daerah|arah|wilayah|kawasan|menuju|sekitar)$/.test(prev))) continue;
    out.push(match('NAME', m.index, m[0], 'medium'));
  }
  return out;
}

// Headings and references that a bracketed number follows: "Pasal 5 (2)", "Tabel (3)".
const NOT_AN_AGE = new Set(
  ('pasal ayat bab bagian lampiran gambar tabel grafik nomor no langkah tahap poin butir huruf angka versi kelas ruang ' +
    'lantai gate pintu loket jalur map set array object date number string buffer promise error symbol').split(' '),
);

const ROLE_AT_START = new RegExp(`^(?:${ROLE_CUE.source.replace(/^\\b/, '')})`, 'i');

/** A name followed by an age in brackets, as news and case notes write it: "Kevin (19)", "Narti (54 th)". */
function detectNamesWithAge(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const re = /(?<![\w@.'’-])([A-Z][a-z'’-]+(?:[ \t]+(?:[A-Z][a-z'’-]+|bin|binti)){0,3})[ \t]+\([ \t]*\d{1,2}[ \t]*(?:th|thn|tahun|thn\.|th\.)?[ \t]*\)/g;
  for (const m of text.matchAll(re)) {
    // "Pelaku Kevin (19)": the role in front is not part of the name.
    const role = ROLE_AT_START.exec(m[1]!)?.[0] ?? '';
    const name = m[1]!.slice(role.length);
    const words = name.split(/[ \t]+/).map((w) => w.toLowerCase());
    if (!name || words.some((w) => NOT_NAME.has(w) || NOT_AN_AGE.has(w) || TITLE_WORDS.has(w) || PLACE_WORDS.has(w))) continue;
    out.push(match('NAME', m.index + role.length, name, 'medium'));
  }
  return out;
}

/** Attendance lists: "Tidak hadir: Wahyu (sakit), Dinda (izin)". A word with an attendance status is a person. */
function detectAttendance(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // Also a relation in emergency contacts: "Wulan (istri) 0812…".
  const re = /(?<![\w@.'’-])([A-Z][a-z'’-]+(?:[ \t]+[A-Z][a-z'’-]+){0,3})[ \t]+\((?:sakit|izin|ijin|alpa|alpha|absen|cuti|dinas(?:[ \t]+luar)?|terlambat|telat|hadir|wfh|wfo|istri|suami|ayah|ibu|bapak|anak|kakak|adik|ortu|orang[ \t]+tua|wali|saudara|keluarga|teman|wife|husband|mother|father)\)/g;
  for (const m of text.matchAll(re)) {
    if (m[1]!.split(/[ \t]+/).some((w) => NOT_NAME.has(w.toLowerCase()) || TITLE_WORDS.has(w.toLowerCase()))) continue;
    out.push(match('NAME', m.index, m[1]!, 'medium'));
  }
  return out;
}

/** A common given name opening a sentence and doing something: "Dodi masih punya utang", "Agus bilang besok". */
function detectSentenceSubjects(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const re =
    /(?:^|(?<=[.!?]\s)|(?<=\n))[ \t]*([A-Z][a-z]{2,14})(?=[ \t]+(?:masih|sudah|udah|belum|lagi|sedang|bilang|minta|punya|mau|tidak|nggak|gak|ga|pernah|sakit|kerja|tinggal|baru|katanya|pinjam|hutang|utang|janji|nanya|nelpon|telat|izin|cuti|dirawat|meninggal)\b)/gm;
  for (const m of text.matchAll(re)) {
    const bare = m[1]!.toLowerCase();
    if (!GIVEN_NAMES.has(bare) && !JAVANESE_NAME.test(bare)) continue;
    out.push(match('NAME', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  }
  return out;
}

/**
 * Two names joined by "&" or "dan" where one is a known given name: "Dimas & Anggun", "Rina dan Kelvin". The other
 * is a name too, even if the list does not know it.
 */
function detectNamePairs(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(/(?<![\w@.'’-])([A-Z][a-z]{2,14})[ \t]*(?:&|dan)[ \t]*([A-Z][a-z]{2,14})(?![\w'’-]|[ \t]+[A-Z])/g)) {
    const [a, b] = [m[1]!, m[2]!];
    const ok = (w: string) => !NOT_NAME.has(w.toLowerCase()) && !PLACE_WORDS.has(w.toLowerCase()) && !TITLE_WORDS.has(w.toLowerCase());
    if (!ok(a) || !ok(b)) continue;
    if (GIVEN_NAMES.has(a.toLowerCase())) out.push(match('NAME', m.index + m[0].lastIndexOf(b), b, 'medium'));
    if (GIVEN_NAMES.has(b.toLowerCase())) out.push(match('NAME', m.index, a, 'medium'));
  }
  return out;
}

/** A handle in brackets after a name: "User Andreas Wijaya (andreas.w)". It must contain a known name. */
function detectBracketHandles(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(/\(([a-z][a-z0-9]*(?:[._][a-z0-9]+)+)\)/g)) {
    if (!m[1]!.split(/[._]/).some((w) => GIVEN_NAMES.has(w.replace(/\d+$/, '')) || FAMILY_NAMES.has(w.replace(/\d+$/, '')))) continue;
    out.push(match('NAME', m.index + 1, m[1]!, 'medium'));
  }
  return out;
}

/** The security code on the back of a card: "cvv 123". */
function detectCardCodes(text: string): PiiMatch[] {
  const re = /\b(?:cvv2?|cvc2?|cid|kode\s+keamanan)\b[ \t]*[:=]?[ \t]*(\d{3,4})(?!\d)/gi;
  return [...text.matchAll(re)].map((m) => match('CARD', m.index + m[0].length - m[1]!.length, m[1]!, 'high'));
}

const DIGITS_AT = /\d+/y;

const THING_TABLE =
  /produk|product|barang|item|sku|kategori|categor|menu|toko|store|shop|merchant|brand|merek|layanan|service|paket|package|kota|city|provinsi|province|wilayah|region|kecamatan|kelurahan|desa|district|bank|kurir|courier|ekspedisi|tag|role|permission|setting|config|status|metode|method/i;

const COLUMN_QUOTES = /^[`"[]|[`"\]]$/g;
const COLUMN_NAME = /^(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[\w$]+)/;
const NOT_A_COLUMN = /^(?:PRIMARY|KEY|UNIQUE|CONSTRAINT|INDEX|FOREIGN|CHECK|FULLTEXT|SPATIAL|EXCLUDE|LIKE|PERIOD)\b/i;
const CREATE_TABLE = /\bCREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\w.]+)\s*\(/gi;
const INSERT_COLUMNS = /\b(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+([`"\w.]+)\s*\(([^)]{1,2000})\)\s*VALUES\s*/gi;
const INSERT_VALUES = /\b(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+([`"\w.]+)\s+VALUES\s*/gi;
const COPY_FROM_STDIN = /^COPY\s+([`"\w.]+)\s*\(([^)]{1,2000})\)\s+FROM\s+stdin;\r?\n/gim;

/** `public.pelanggan`, `"pelanggan"`, and `` `pelanggan` `` name the same table. */
function tableKey(name: string): string {
  return name.replace(/[`"]/g, '').split('.').pop()!.toLowerCase();
}

function columnTypes(table: string, columns: string[]): Array<PiiType | undefined> {
  // `produk.nama` is a product; only a person's table makes a bare "nama" column a name.
  const thingTable = THING_TABLE.test(table);
  return columns.map((c) => (thingTable && /^(?:nama|name|title|judul)$/i.test(c) ? undefined : fieldType(c)));
}

/**
 * The columns of every `CREATE TABLE` in the text, in order, so that rows without column names (`INSERT INTO t
 * VALUES (…)` as mysqldump and `pg_dump --inserts` write them) can still be read by column.
 */
function createdTables(text: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  for (const m of text.matchAll(CREATE_TABLE)) {
    const columns: string[] = [];
    let depth = 1;
    let from = m.index + m[0].length;
    const limit = Math.min(text.length, from + 100_000);
    const take = (to: number) => {
      const item = text.slice(from, to).trim();
      const name = COLUMN_NAME.exec(item);
      if (name && !NOT_A_COLUMN.test(item)) columns.push(name[0].replace(COLUMN_QUOTES, ''));
    };
    for (let i = from; i < limit && depth > 0; i++) {
      const ch = text[i]!;
      if (ch === "'") {
        // A default or comment: `DEFAULT 'a,b'`, `COMMENT 'nama (lengkap)'`.
        let j = i + 1;
        while (j < limit && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" || text[j] === '\\' ? 2 : 1;
        i = j;
      } else if (ch === '(') depth++;
      else if (ch === ')') {
        if (--depth === 0) take(i);
      } else if (ch === ',' && depth === 1) {
        take(i);
        from = i + 1;
      }
    }
    if (depth === 0) tables.set(tableKey(m[1]!), columns);
  }
  return tables;
}

/** Walks the VALUES tuples from `i`, matching each value to its column. */
function sqlValues(text: string, i: number, types: Array<PiiType | undefined>, columns: string[], out: PiiMatch[]): void {
  let col = 0;
  let depth = 0;
  // Walk the tuples character by character so quoted commas and parentheses stay inside their value.
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === ch && text[j + 1] !== ch)) j += text[j] === ch || text[j] === '\\' ? 2 : 1;
      const type = depth === 1 ? types[col] : undefined;
      const value = text.slice(i + 1, j);
      if (type && isPlausibleValue(type, value, columns[col]!)) out.push(match(type, i + 1, value, 'high'));
      i = j + 1;
      continue;
    }
    if (ch === '(') {
      depth++;
      if (depth === 1) col = 0;
    } else if (ch === ')') depth--;
    else if (ch === ',' && depth === 1) col++;
    else if (ch === ';' && depth === 0) break;
    else if (depth === 0 && !/[\s,]/.test(ch)) break;
    else if (depth === 1 && /\d/.test(ch) && /[(,\s]/.test(text[i - 1]!)) {
      // An unquoted number in a personal column: `nik` stored as BIGINT.
      DIGITS_AT.lastIndex = i;
      const num = DIGITS_AT.exec(text)![0];
      const type = types[col];
      if (type && isPlausibleValue(type, num, columns[col]!)) out.push(match(type, i, num, 'high'));
      i += num.length;
      continue;
    }
    i++;
  }
}

/**
 * SQL dumps, with values matched to their columns: `INSERT INTO pelanggan (nama, nik, …) VALUES ('Hendra', '1371…'),
 * (…);`, rows without column names under a `CREATE TABLE` (mysqldump, `pg_dump --inserts`), and `COPY … FROM stdin`
 * blocks (pg_dump's default), whose rows are tab-separated.
 */
function detectSqlInserts(text: string): PiiMatch[] {
  if (!/\b(?:INTO|COPY)\b/i.test(text)) return [];
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(INSERT_COLUMNS)) {
    const columns = m[2]!.split(',').map((c) => c.trim().replace(COLUMN_QUOTES, ''));
    const types = columnTypes(m[1]!, columns);
    if (types.some(Boolean)) sqlValues(text, m.index + m[0].length, types, columns, out);
  }
  let tables: Map<string, string[]> | undefined;
  for (const m of text.matchAll(INSERT_VALUES)) {
    tables ??= createdTables(text);
    const columns = tables.get(tableKey(m[1]!));
    if (!columns) continue;
    const types = columnTypes(m[1]!, columns);
    if (types.some(Boolean)) sqlValues(text, m.index + m[0].length, types, columns, out);
  }
  for (const m of text.matchAll(COPY_FROM_STDIN)) {
    const columns = m[2]!.split(',').map((c) => c.trim().replace(COLUMN_QUOTES, ''));
    const types = columnTypes(m[1]!, columns);
    if (!types.some(Boolean)) continue;
    let pos = m.index + m[0].length;
    while (pos < text.length) {
      let end = text.indexOf('\n', pos);
      if (end === -1) end = text.length;
      const line = text.slice(pos, end > pos && text[end - 1] === '\r' ? end - 1 : end);
      if (line === '\\.') break;
      let at = pos;
      line.split('\t').forEach((cell, idx) => {
        const type = types[idx];
        // \N is NULL.
        if (type && cell !== '\\N' && isPlausibleValue(type, cell, columns[idx]!)) out.push(match(type, at, cell, 'high'));
        at += cell.length + 1;
      });
      pos = end + 1;
    }
  }
  return out;
}

const STREET =
  'Jl|Jln|Jalan|Gg|Gang|Komp|Kompl|Komplek|Kompleks|Perum|Perumahan|Cluster|Klaster|Apartemen|Apartment|Apt|Rusun|' +
  'Rusunawa|Tower|Ruko|Wisma|Asrama|Dusun|Dsn|Dukuh|Kampung|Kp|Lingkungan|Ling';
// What pins a street to one house: No., Blok, Kav., or an apartment's floor and unit. Chat writes "blok b no 9".
const PIN = '[Nn][Oo]|[Nn]omor|[Bb]lok|[Kk]av|[Uu]nit|[Ll]t|[Ll]antai|[Kk]amar|[Kk]mr|NO|BLOK';
const RT_RW = 'RT\\.?\\s*0*\\d{1,3}\\s*[/,]?\\s*RW\\.?\\s*0*\\d{1,3}';

function detectStreetAddresses(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // A street only counts as personal data when it is pinned to a house: No., Blok, Kav., a unit, or RT/RW.
  const street = new RegExp(
    `\\b(?:${STREET})\\.?\\s+[A-Za-z0-9][^\\n;]{1,80}?(?:\\b(?:${PIN})\\.?\\s*[A-Za-z]?\\d+[A-Za-z]?(?:\\/\\d+)?(?:,?\\s*(?:${PIN})\\.?\\s*[A-Za-z]?\\d+[A-Za-z]?(?:\\/\\d+)?)*(?:,?\\s*${RT_RW})?|\\b${RT_RW})`,
    'g',
  );
  for (const m of text.matchAll(street)) out.push(match('ADDRESS', m.index, m[0], 'high'));
  // Chat writes the estate in lowercase: "perum griya asri blok c3 no 12". Not "jalan", which is also a verb.
  const lower =
    /\b(?:perum|perumahan|komplek|kompleks|komp|cluster|klaster|apartemen|apt|rusun|asrama|jl|jln|gg|gang)\.?\s+[a-z0-9][^\n;]{1,60}?\b(?:no|nomor|blok|kav|unit)\.?\s*[a-z]?\d+[a-z]?(?:\/\d+)?(?:,?\s*(?:no|nomor|blok|kav|unit)\.?\s*[a-z]?\d+[a-z]?)*/g;
  for (const m of text.matchAll(lower)) out.push(match('ADDRESS', m.index, m[0], 'medium'));
  for (const m of text.matchAll(new RegExp(`\\b${RT_RW}\\b`, 'gi'))) out.push(match('ADDRESS', m.index, m[0], 'medium'));
  // "jl mawar 5 cibinong": chat skips "No.". Only after "jl" or "gg", and not "jl. raya macet 2 jam".
  const bare =
    /\b(?:[Jj]ln?|[Gg]g)\.?\s+[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3}?\s+\d{1,4}[A-Za-z]?\b(?!\s*(?:jam|menit|detik|km|meter|m\b|kali|hari|minggu|bulan|tahun|orang|lantai|lajur|jalur|%|x\b))/g;
  for (const m of text.matchAll(bare)) out.push(match('ADDRESS', m.index, m[0], 'medium'));
  return out;
}

const NAME_STOP =
  /\s(?:dan|dengan|yang|nik|hp|no|nomor|umur|usia|alamat|email|tinggal|lahir|asal|dari|di|ke|untuk|sebagai|mau|ingin|minta|tolong|saya|aku|gue|gua|gw|mohon|terima|makasih|thanks|thank|thx|tks|trims|bisa|boleh|apakah|kapan|berapa|gimana|bagaimana|kenapa|mengapa|tanya|nanya|sudah|udah|sdh|belum|blm|akan|sedang)\b/i;
// Chat words after a name: "Nama: Budi Santoso ya kak". Lowercase only, so "Lee Dong Hae" keeps its "Dong".
const NAME_STOP_CHAT =
  /\s(?:ya|yah|yaa|iya|kak|kakak|gan|sis|min|pak|bu|dong|deh|sih|kok|nih|aja|saja|juga|lho|loh|ok|oke|okay|lagi|baru|tadi|kemarin|kemaren|besok|nanti|sekarang)\b/;
// A name ends at an emoji, a pictograph, or ! and ?: "Nama: Budi Santoso 🙏".
const NAME_END = /[!?\u2190-\u2bff\ud800-\udfff\ufe0f]/;
const MULTI_PART: ReadonlySet<PiiType> = new Set(['ADDRESS', 'BIRTH_DATE', 'HEALTH', 'GEO']);

/**
 * The first `n` words of `s` exactly as written. Rejoining `split(/\s+/)` with single spaces would shorten
 * "Siti   Aminah", and the mask would then stop short and leave the end of the name visible.
 */
function takeWords(s: string, n: number): string {
  return s.split(/(\s+)/).slice(0, Math.max(0, 2 * n - 1)).join('');
}

/** Cuts an unquoted value where the next field begins. */
function cutValue(type: PiiType, raw: string): string {
  let v = raw;
  const semi = v.search(/[;|&]/);
  if (semi >= 0) v = v.slice(0, semi);
  // logfmt: "nik=3201… hp=0812… err=…" — the next key=value pair starts a new field.
  const pair = v.search(/\s+[A-Za-z_][\w.-]*=(?!=)/);
  if (pair >= 0) v = v.slice(0, pair);
  // These never contain spaces: "user_email=budi@x.com tadi" ends at the space.
  if (type === 'EMAIL' || type === 'IP') v = v.split(/\s/, 1)[0]!;
  // Another "Label:" later on the line ends this value.
  const nextColon = v.search(/:(?!\/\/)/);
  if (nextColon > 0) {
    const head = v.slice(0, nextColon);
    const comma = head.lastIndexOf(',');
    if (comma >= 0) v = head.slice(0, comma);
    else {
      const words = head.split(/\s+/);
      let cut = words.length - 1;
      for (let i = 1; i < words.length; i++) {
        if (fieldType(words.slice(i).join(' '))) {
          cut = i;
          break;
        }
      }
      v = takeWords(head, cut);
    }
  }
  if (type === 'HEALTH') {
    // "diagnosa: Diabetes tipe 2. Plat B 1234 XYZ": a condition ends with its sentence.
    const end = v.search(/\.\s+[A-Z]/);
    if (end >= 0) v = v.slice(0, end);
  }
  if (MULTI_PART.has(type)) {
    // "Alamat: Jl. Melati 12, Bandung. Rekening BCA 123…": a sentence that opens with a field name is the next field.
    // Not after "Jl." or "Kec.", whose next word is part of the address.
    for (const m of v.matchAll(/([A-Za-z]*)\.\s+/g)) {
      if (m[1]!.length < 4) continue;
      const lead = v.slice(m.index + m[0].length).split(/\s+/).slice(0, 3);
      if (lead.some((_, i) => fieldType(lead.slice(0, i + 1).join(' ')))) {
        v = v.slice(0, m.index + m[1]!.length);
        break;
      }
    }
    // "Alamat: Jl. Mawar No. 5, Depok, HP 0812…": keep commas until a segment opens with a field name.
    const parts = v.split(',');
    let keep = 1;
    for (; keep < parts.length; keep++) {
      const lead = parts[keep]!.trim().split(/\s+/).slice(0, 3);
      if (lead.some((_, i) => fieldType(lead.slice(0, i + 1).join(' ')))) break;
    }
    v = parts.slice(0, keep).join(',');
  } else {
    v = v.split(',')[0]!;
  }
  if (type === 'NAME') {
    for (const re of [NAME_END, NAME_STOP, NAME_STOP_CHAT]) {
      const stop = v.search(re);
      if (stop >= 0) v = v.slice(0, stop);
    }
    // A digit ends a name, but not the "20" in "Siti%20Rahayu" (same length, so the index still fits).
    const digit = v.replace(/%[0-9A-Fa-f]{2}/g, '%xx').search(/\d/);
    if (digit >= 0) v = v.slice(0, digit);
    v = takeWords(v, 5);
  }
  // "NPWP: 01.234.567.8-901.000 a.n. CV Maju Jaya": a number ends where its digits do.
  if (NUMBER_TYPES.has(type)) {
    const digits = /^[+(]?\d[\d \t.\-/()]*\d\)?/.exec(v.trim());
    if (digits) return digits[0].trim();
  }
  return v.replace(/[\s.,}\]]+$/, '').trim();
}
const NUMBER_TYPES: ReadonlySet<PiiType> = new Set(['NIK', 'KK', 'NPWP', 'NIP', 'SIM', 'BPJS', 'NISN', 'PHONE', 'BANK_ACCOUNT', 'CARD']);

/**
 * "Label: value" in prose, forms, logs, JSON, YAML and .env:
 * "Agama: Islam", "NAMA : BUDI SANTOSO", "tgl. lahir: 15-08-1995", "nama: budi", "customer_email" = "…".
 */
const isQuote = (c: string | undefined) => c === '"' || c === "'" || c === '`';
const isLabelChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_./-]/.test(c);
const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);
const isJsSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

/**
 * The label that ends at `end`, as `LABEL.exec(text.slice(lineStart, end).trimEnd())` would find it, but scanning
 * right to left over at most five words instead of the whole line. On a 2 MB single-line JSON file the regex made
 * this detector quadratic, long enough for the guard hook to time out (and fail open).
 */
function labelBefore(text: string, lineStart: number, end: number): string | undefined {
  while (end > lineStart && isJsSpace(text[end - 1])) end--;
  let pos = end;
  let start = -1;
  for (let words = 0; words < 5; words++) {
    // One word: an optional quote, a letter, label characters, an optional quote.
    let p = pos;
    if (p > lineStart && isQuote(text[p - 1])) p--;
    const runEnd = p;
    while (p > lineStart && isLabelChar(text[p - 1])) p--;
    let first = p;
    while (first < runEnd && !isLetter(text[first])) first++;
    if (first >= runEnd) break;
    start = first === p && p > lineStart && isQuote(text[p - 1]) ? p - 1 : first;
    // The label continues leftwards only over a whole word followed by spaces or tabs.
    if (first !== p) break;
    let q = start;
    while (q > lineStart && (text[q - 1] === ' ' || text[q - 1] === '\t')) q--;
    if (q === start) break;
    pos = q;
  }
  return start < 0 ? undefined : text.slice(start, end);
}

/**
 * How much of the line after a label `cutValue` can look at: up to the first `;`, `|` or `&`, or just past the first
 * colon that ends the value (not one in "://", and not one right at the start, which cutValue ignores). Cutting
 * the line there gives the same result and keeps long lines linear.
 */
function valueExtent(text: string, start: number, end: number): number {
  const endsValue = (i: number) => text[i] === ':' && !(text[i + 1] === '/' && text[i + 2] === '/');
  // cutValue only looks at the first such colon; at the very start it cuts nothing, so no colon does.
  const colonsCut = !endsValue(start);
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c === ';' || c === '|' || c === '&') return i;
    if (colonsCut && endsValue(i)) return Math.min(end, i + 3);
  }
  return end;
}

function detectLabeledFields(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  let lineStart = 0;
  let lineEnd = text.indexOf('\n');
  if (lineEnd === -1) lineEnd = text.length;
  for (const m of text.matchAll(/[ \t]*(?::(?![:\/])|=>|=(?![=>]))[ \t]*/g)) {
    // PHP, Ruby and Perl hashes: "'name' => 'Ahmad Fauzan'". Only after a quoted key; "phone => format(phone)" is a
    // JavaScript arrow function.
    if (m[0].includes('=>') && !isQuote(text[m.index - 1])) continue;
    while (m.index > lineEnd) {
      lineStart = lineEnd + 1;
      lineEnd = text.indexOf('\n', lineStart);
      if (lineEnd === -1) lineEnd = text.length;
    }
    const label = labelBefore(text, lineStart, m.index);
    if (!label) continue;
    const words = label.trim().split(/[ \t]+/);
    let type: PiiType | undefined;
    let key = '';
    for (let i = 0; i < words.length && !type; i++) {
      key = words.slice(i).join(' ');
      type = fieldType(key);
    }
    if (!type) continue;

    const valueStart = m.index + m[0].length;
    const rawEnd = lineEnd > valueStart && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    let value: string;
    let start = valueStart;
    const quote = text[valueStart];
    if (valueStart < rawEnd && isQuote(quote)) {
      let close = valueStart + 1;
      while (close < rawEnd && text[close] !== quote) close++;
      if (close >= rawEnd) continue;
      value = text.slice(valueStart + 1, close);
      // 'labels like "Nama:" and "a.n."': the quote closes a quoted label; it does not open a value.
      if (/^\s/.test(value)) continue;
      start += 1;
    } else {
      const raw = text.slice(valueStart, valueExtent(text, valueStart, rawEnd));
      value = cutValue(type, raw);
      // cutValue trims; "nama: Budi" starts after the no-break space, not at it.
      if (value) start += raw.indexOf(value);
    }
    if (!isPlausibleValue(type, value, key)) continue;
    // `name: "Default Greeting"` is everywhere in code; only Indonesian/role labels are high-confidence.
    out.push(match(type, start, value, isGenericNameKey(key) ? 'medium' : 'high'));
  }
  return out;
}

/** Splits one CSV line into fields with their offsets, honoring double quotes. */
function csvFields(line: string, delimiter: string): Array<{ start: number; end: number }> {
  const fields: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && !(line[j] === '"' && line[j + 1] !== '"')) j += line[j] === '"' ? 2 : 1;
      fields.push({ start: i + 1, end: j });
      i = line.indexOf(delimiter, j);
    } else {
      const next = line.indexOf(delimiter, i);
      fields.push({ start: i, end: next === -1 ? line.length : next });
      i = next;
    }
    if (i === -1) break;
    i += delimiter.length;
  }
  return fields;
}

/** Every cell under a header that says what it holds: nama, nik, agama, diagnosa, gaji, … */
const NUMBERED_LINE = /^ *(\d{1,7})(?:\t|\u2192)/;
const NUMBERED_LINES = /^ *\d{1,7}(?:\t|\u2192)/gm;

/**
 * A file shown with line numbers, as an agent's Read tool or `cat -n` prints it ("1\u2192nama,nik" or "     1<TAB>nama,nik"),
 * with the numbers blanked out: the header row is then a header again. Same length, so offsets stay put.
 */
function blankLineNumbers(text: string): string {
  const first = NUMBERED_LINE.exec(text);
  const breakAt = text.indexOf('\n');
  const second = breakAt >= 0 ? NUMBERED_LINE.exec(text.slice(breakAt + 1)) : null;
  if (!first || !second || Number(second[1]) !== Number(first[1]) + 1) return text;
  return text.replace(NUMBERED_LINES, (prefix) => ' '.repeat(prefix.length));
}

function detectCsvColumns(text: string): PiiMatch[] {
  text = blankLineNumbers(text);
  const firstBreak = text.indexOf('\n');
  if (firstBreak === -1) return [];
  const header = text.slice(0, firstBreak).replace(/\r$/, '');
  const delimiter = [',', ';', '\t', '|'].find((d) => header.includes(d));
  if (!delimiter) return [];
  const headerFields = csvFields(header, delimiter).map((f) => header.slice(f.start, f.end).trim());
  // A header is short labels, and the next row has as many fields — not a sentence with commas.
  const secondLine = text.slice(firstBreak + 1).split('\n', 1)[0]!.replace(/\r$/, '');
  if (
    headerFields.length < 2 ||
    headerFields.some((h) => h.length > 40 || /[.!?]$/.test(h)) ||
    csvFields(secondLine, delimiter).length !== headerFields.length
  ) {
    return [];
  }
  const columns = headerFields.map((h) => fieldType(h));
  if (!columns.some(Boolean)) return [];
  // "Nama<TAB>Budi Santoso" then "NIK<TAB>3201…" is a list of labels and values, not a table with a header.
  const second = csvFields(secondLine, delimiter);
  if (columns.some((t, i) => t && fieldType(secondLine.slice(second[i]!.start, second[i]!.end).trim()))) return [];

  const out: PiiMatch[] = [];
  let offset = firstBreak + 1;
  for (const rawLine of text.slice(offset).split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    csvFields(line, delimiter).forEach((f, idx) => {
      const type = columns[idx];
      const cell = line.slice(f.start, f.end);
      const value = cell.trim();
      if (!type || !isPlausibleValue(type, value, headerFields[idx]!)) return;
      const start = offset + f.start + cell.indexOf(value);
      // A plain "name" column can hold product names as easily as people.
      out.push(match(type, start, value, isGenericNameKey(headerFields[idx]!) ? 'medium' : 'high'));
    });
    offset += rawLine.length + 1;
  }
  return out;
}

/**
 * Tab-separated tables anywhere in the text: cells copied from Excel or Word, and tables in PDF text, where a wide
 * gap between cells becomes a tab. "Nama Pelanggan<TAB>Budi Santoso" is a label and its value. A row of short
 * cells with at least one field name, followed by rows with as many cells or fewer, is a table with typed columns.
 */
function detectTabTables(text: string): PiiMatch[] {
  if (!text.includes('\t')) return [];
  text = blankLineNumbers(text);
  const out: PiiMatch[] = [];
  let header: string[] | undefined;
  let columns: Array<PiiType | undefined> = [];
  let pos = 0;
  while (pos <= text.length) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    const line = text.slice(pos, end > pos && text[end - 1] === '\r' ? end - 1 : end);
    const cells: Array<{ start: number; value: string }> = [];
    if (line.includes('\t')) {
      let at = 0;
      for (const part of line.split('\t')) {
        const value = part.trim();
        cells.push({ start: pos + at + (value ? part.indexOf(value) : 0), value });
        at += part.length + 1;
      }
    }
    const filled = cells.filter((c) => c.value);
    if (header && filled.length >= 2 && cells.length <= header.length) {
      cells.forEach((c, i) => {
        const type = columns[i];
        if (!type || !c.value || !isPlausibleValue(type, c.value, header![i]!)) return;
        out.push(match(type, c.start, c.value, isGenericNameKey(header![i]!) ? 'medium' : 'high'));
      });
    } else {
      header = undefined;
      const types = cells.map((c) => (c.value ? fieldType(c.value) : undefined));
      const [label, value] = filled;
      if (filled.length === 2 && /^[A-Z]/.test(label!.value) && fieldType(label!.value) && !fieldType(value!.value)) {
        // "Nama Pelanggan<TAB>Budi Santoso". "Nama<TAB>: Budi" is a labeled field, found by detectLabeledFields.
        const type = fieldType(label!.value)!;
        if (!/^[:=]/.test(value!.value) && isPlausibleValue(type, value!.value, label!.value)) {
          out.push(match(type, value!.start, value!.value, isGenericNameKey(label!.value) ? 'medium' : 'high'));
        }
      } else if (
        filled.length >= 2 &&
        filled.every((c) => c.value.length <= 40 && /[A-Za-z]/.test(c.value) && !/[.!?]$|\d{3}/.test(c.value)) &&
        // Data files have tabs too ("n01687978<TAB>agama"): a document table's header is capitalized, or names two fields.
        (types.filter(Boolean).length >= 2 || (types.some(Boolean) && filled.every((c) => /^[A-Z]/.test(c.value))))
      ) {
        header = cells.map((c) => c.value);
        columns = types;
      }
    }
    pos = end + 1;
  }
  return out;
}

const DETECTORS: Array<(text: string) => PiiMatch[]> = [
  detectDigitRuns,
  detectNpwpFormatted,
  detectPassports,
  detectPhones,
  detectEmails,
  detectIps,
  detectCoordinates,
  detectBirthDates,
  detectHealth,
  detectFinancial,
  detectReligion,
  detectMaritalStatus,
  detectPlates,
  detectNames,
  detectChatSenders,
  detectKnownNames,
  detectSignatures,
  detectDisplayNames,
  detectHandles,
  detectStackedLabels,
  detectColonlessLabels,
  detectPhoneOwners,
  detectTimedSenders,
  detectLogUsers,
  detectHtml,
  detectHl7,
  detectAkta,
  detectCriminal,
  detectGluedIds,
  detectCardCodes,
  detectSpokenPhones,
  detectLoneGivenNames,
  detectNamesWithAge,
  detectNamePairs,
  detectAttendance,
  detectSentenceSubjects,
  detectBracketHandles,
  detectSqlInserts,
  detectStreetAddresses,
  detectLabeledFields,
  detectCsvColumns,
  detectTabTables,
];

export interface DetectOptions {
  /** Only look for these types. Default: all of PII_TYPES. */
  types?: readonly PiiType[];
  /**
   * Never report these types, e.g. `['FINANCIAL']` when income and installments are the data an app needs to read
   * (a dealer's credit simulation), or `['NAME']` when names are not sent anywhere sensitive.
   */
  exclude?: readonly PiiType[];
  /** "high" only keeps validated or keyword-anchored matches. Default "medium". */
  minConfidence?: Confidence;
}

/** All personal data in the text, non-overlapping, in reading order. */
export function detectPii(text: string, options: DetectOptions = {}): PiiMatch[] {
  for (const t of [...(options.types ?? []), ...(options.exclude ?? [])]) {
    if (!PII_TYPES.includes(t)) throw new RangeError(`Unknown PII type "${t}". Valid types: ${PII_TYPES.join(', ')}`);
  }
  const types = new Set(options.types ?? PII_TYPES);
  for (const t of options.exclude ?? []) types.delete(t);
  const minRank = options.minConfidence === 'high' ? 2 : 1;
  const rank = (m: PiiMatch) => (m.confidence === 'high' ? 2 : 1);

  const candidates = DETECTORS.flatMap((d) => d(text)).filter(
    (m) => m.end > m.start && types.has(m.type) && rank(m) >= minRank,
  );
  // Prefer confident, then longer matches; drop anything overlapping an accepted match.
  candidates.sort((a, b) => rank(b) - rank(a) || b.end - b.start - (a.end - a.start) || a.start - b.start);
  // One flag per character: checking a candidate costs its own length, not the number of matches so far.
  const taken = new Uint8Array(text.length + 1);
  const accepted: PiiMatch[] = [];
  for (const c of candidates) {
    let free = true;
    for (let i = c.start; i < c.end && free; i++) free = taken[i] === 0;
    if (!free) continue;
    taken.fill(1, c.start, c.end);
    accepted.push(c);
  }
  return accepted.sort((a, b) => a.start - b.start);
}
