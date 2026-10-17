import { parseNik } from '../nik.ts';
import { parsePhone } from '../phone.ts';
import { fieldType, isGenericNameKey, isPlausibleValue } from './fields.ts';
import { PII_TYPES, type Confidence, type PiiMatch, type PiiType } from './types.ts';

export { PII_TYPES, UU_PDP_CATEGORY, type Confidence, type PiiMatch, type PiiType } from './types.ts';

/** Text in the `window` characters before `index`, on the same line, lowercased. */
function before(text: string, index: number, window = 40): string {
  const slice = text.slice(Math.max(0, index - window), index);
  const nl = slice.lastIndexOf('\n');
  return (nl >= 0 ? slice.slice(nl + 1) : slice).toLowerCase();
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
const BPJS_KEYWORD = /\b(bpjs|jkn|kis|kartu indonesia sehat|kpj|jamsostek)\b/;
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
    else if ((digits.length === 13 || digits.length === 11) && BPJS_KEYWORD.test(ctx)) push('BPJS', 'high');
    else if (digits.length >= 8 && digits.length <= 18 && BANK_KEYWORD.test(ctx)) push('BANK_ACCOUNT', 'high');
  }
  return out;
}

function detectNpwpFormatted(text: string): PiiMatch[] {
  const re = /(?<!\d)\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}(?!\d)/g;
  return [...text.matchAll(re)].map((m) => match('NPWP', m.index, m[0], 'high'));
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

function detectPhones(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // Separators never include a line break, and every group after the operator prefix has at least three digits.
  // Otherwise a number at the end of a line swallows the digits that start the next one ("…6789\n14/10/26"),
  // fails validation, and is left unmasked.
  const mobile = /(?<![\d+\w])(?:\+62|62|0)[ \t-]?8\d{1,2}(?:[ \t.-]?\d{3,4}){2,3}(?![\d\w])/g;
  for (const m of text.matchAll(mobile)) {
    if (parsePhone(m[0]).valid && !gluedToCode(text, m.index)) out.push(match('PHONE', m.index, m[0], 'high'));
  }
  const landline = /\((?:\+62[ \t]?|0)\d{2,3}\)[ \t]?\d{3,4}[ \t-]?\d{3,4}(?!\d)|(?<![\d\w])\+62[ \t]?[2-79]\d{1,2}[ \t-]?\d{3,4}[ \t-]?\d{3,4}(?!\d)/g;
  for (const m of text.matchAll(landline)) out.push(match('PHONE', m.index, m[0], 'medium'));
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
  return out;
}

function detectIps(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const re = /(?<![\d.\w])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.\w])/g;
  for (const m of text.matchAll(re)) {
    const ip = m[0];
    if (/^(0\.|127\.|255\.255\.255\.255)/.test(ip)) continue;
    if (/\b(versi|version|ver|v)\.?\s*$/.test(before(text, m.index, 12))) continue;
    const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
    out.push(match('IP', m.index, ip, priv ? 'medium' : 'high'));
  }
  return out;
}

function detectCoordinates(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const re = /(?<![\d.])(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?![\d.])/g;
  for (const m of text.matchAll(re)) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
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
  const re = new RegExp(`\\b(?:lahir|kelahiran|born)\\b[^\\n\\d]{0,40}?(${DATE})`, 'gi');
  return [...text.matchAll(re)].map((m) => match('BIRTH_DATE', m.index + m[0].length - m[1]!.length, m[1]!, 'high'));
}

const CONDITIONS =
  'hiv|aids|odha|tbc|tb paru|tuberkulosis|hepatitis(?: [abc])?|kanker(?: \\w+)?|tumor(?: \\w+)?|diabetes(?: melitus)?|hipertensi|stroke|penyakit jantung|gagal ginjal|cuci darah|covid(?:-19)?|dbd|demam berdarah|malaria|kusta|lepra|skizofrenia|bipolar|depresi(?: berat)?|gangguan jiwa|gangguan mental|odgj|autis(?:me)?|epilepsi|ims|sifilis|gonore|herpes|hamil|keguguran';

// Medicines that name the condition they treat.
const MEDICATIONS =
  'insulin|metformin|glibenclamide|arv|antiretroviral|obat tbc|rifampisin|isoniazid|kemoterapi|kemo|antidepresan|' +
  'antipsikotik|fluoxetine|sertraline|risperidone|haloperidol|lithium|metadon|methadone|warfarin|amlodipine|captopril|' +
  'levothyroxine|tamoxifen|hormon|kb|pil kb';

function detectHealth(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // Strong medical verbs: whatever follows is the condition.
  const strong =
    /\b(?:didiagnosis|didiagnosa|terdiagnosis|terdiagnosa|mengidap|terinfeksi|riwayat penyakit|divonis)\s+(?:menderita\s+|mengidap\s+|penyakit\s+)?([^\n,.;:()]{2,60}?)(?=\s+(?:sejak|selama|dan sudah|dan sedang|tapi|namun|sehingga|jadi)\b|[\n,.;:()]|$)/gi;
  for (const m of text.matchAll(strong)) {
    out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'high'));
  }
  // Everyday words ("positif", "karena", "saya") only count before a known condition: "saya diabetes".
  const gated = new RegExp(
    `\\b(?:positif|menderita|terkena|kena|sakit|pasien|penderita|pengidap|penyintas|mengalami|karena|krn|akibat|gara-gara|punya|saya|aku|gue|gw|gua|dia|beliau)\\s+((?:penyakit\\s+)?(?:${CONDITIONS}))\\b`,
    'gi',
  );
  for (const m of text.matchAll(gated)) {
    out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
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
  // Being in hospital is health data too: "dirawat di RSUD Cibinong", "opname di RS Hermina".
  const hospital =
    /\b(?:dirawat|opname|rawat inap|diopname|dioperasi|isolasi)\s+(?:di\s+)?(?:(?:RSUD|RSU|RSIA|RSJ|RSAB|RS|Rumah Sakit|Puskesmas|Klinik)\b[^\n,.;:()]{0,40}?)(?=\s+(?:karena|krn|sejak|selama|dan|tapi|jadi|sampai)\b|[\n,.;:()]|$)/gi;
  for (const m of text.matchAll(hospital)) out.push(match('HEALTH', m.index, m[0], 'medium'));
  return out;
}

function detectFinancial(text: string): PiiMatch[] {
  const re =
    /\b(?:gaji|penghasilan|pendapatan|saldo|utang|hutang|pinjaman|cicilan|tunggakan|limit(?:\s+kartu)?(?:\s+kredit)?)(?:\s+(?:saya|aku|gue|gw|gua|dia|beliau|bulanan|tahunan|per\s+bulan|sebulan|setahun|bersih|kotor|rekening|terakhir|total|di\s+\w+))*\s*(?:sebesar|sekitar|kira-kira|cuma|hanya|adalah|ada|masih|tinggal|sisa|senilai|:|=)?\s*((?:Rp\.?\s?)?\d[\d.,]*(?:\s*(?:rb|ribu|k|jt|juta|m|miliar|milyar|t|triliun)\b)?)/gi;
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(re)) {
    const amount = m[1]!.replace(/[.,]+$/, '');
    if (!/rp|[a-z]$/i.test(amount) && amount.replace(/\D/g, '').length < 4) continue;
    out.push(match('FINANCIAL', m.index + m[0].length - m[1]!.length, amount, 'medium'));
  }
  return out;
}

function detectReligion(text: string): PiiMatch[] {
  const re =
    /\b(?:beragama|agamanya|agama\s+(?:saya|aku|dia|beliau|kami|mereka))\s+(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Hindu|Buddha|Budha|Konghucu|Khonghucu|Kong Hu Cu)\b/gi;
  return [...text.matchAll(re)].map((m) => match('RELIGION', m.index + m[0].length - m[1]!.length, m[1]!, 'high'));
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
  return out;
}

// Titles between the honorific and the name are skipped: "Bapak Presiden Joko Widodo" → "Joko Widodo".
const TITLE_WORDS = new Set([
  'bapak', 'ibu', 'pak', 'bu', 'mas', 'mbak', 'kak', 'bang', 'presiden', 'wakil', 'menteri', 'direktur',
  'dokter', 'dr', 'drs', 'dra', 'prof', 'ir', 'h', 'hj', 'guru', 'lurah', 'camat', 'bupati', 'walikota', 'wali',
  'gubernur', 'kepala', 'dosen', 'ketua', 'manajer', 'admin', 'kurir', 'driver', 'ustadz', 'ustadzah', 'sdr',
  'sdri', 'saudara', 'saudari', 'tn', 'ny', 'nn',
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
    'badan dinas direktorat komisi mahkamah pengadilan kepolisian polri tni sekretariat umum nasional pusat'
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
    if (capitalized && !/^[A-Z]/.test(word) && !NAME_PARTICLES.has(bare)) break;
    words.push({ start: wordStart, end: wordStart + word.length, bare });
    if (word.endsWith('.') && bare.length > 1) break; // "… Budi." ends the sentence; "M. Rizky" goes on
  }
  while (words.length && NAME_PARTICLES.has(words[words.length - 1]!.bare)) words.pop();
  if (!words.length || ORGANIZATION.has(words[0]!.bare)) return undefined;
  const value = text.slice(words[0]!.start, words[words.length - 1]!.end).replace(/[.,]+$/, '');
  if (value.replace(/[^A-Za-z]/g, '').length < 2) return undefined;
  return match('NAME', words[0]!.start, value, confidence);
}

// Phrases that introduce a name, in any case: "atas nama budi santoso", "nama saya Rina", "bernama Rizky".
const NAME_INTRO =
  /\b(?:a\.\s?n\.?|a\/n|atas\s+nama|nama\s+(?:lengkap\s+)?(?:saya|aku|ku|gue|gw|sy)|namaku|namanya|nama\s+(?:lengkap\s+)?(?:anak|ibu|bapak|ayah|suami|istri|adik|kakak|teman|orang\s+tua)\s+(?:saya|aku|kami|gue)|bernama|dengan\s+nama|my\s+name\s+is)(?![A-Za-z])[ \t]*(?:[:=][ \t]*)?/gi;
// Weaker cues, so the name itself must be capitalized: "saya Rina Wulandari", "halo, dengan Agus", "Penerima Budi".
const NAME_CUE =
  /\b(?:saya|aku|gue|gw)[ \t]*,?[ \t]+|\b(?:halo|hai|hallo|selamat\s+(?:pagi|siang|sore|malam))[ \t]*,?[ \t]*(?:ini|dengan|dgn)[ \t]+|\b(?:penerima|pengirim|pemesan|pembeli)[ \t]+/gi;
const HONORIFIC = /(?<![\w-])(?:Bapak|Ibu|Pak|Bu|Sdr\.?|Sdri\.?|Saudara|Saudari|Mas|Mbak|Kak|Bang|Tn\.|Ny\.|Nn\.)[ \t]+/gi;

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

const DIGITS_AT = /\d+/y;

const THING_TABLE =
  /produk|product|barang|item|sku|kategori|categor|menu|toko|store|shop|merchant|brand|merek|layanan|service|paket|package|kota|city|provinsi|province|wilayah|region|kecamatan|kelurahan|desa|district|bank|kurir|courier|ekspedisi|tag|role|permission|setting|config|status|metode|method/i;

/** `INSERT INTO pelanggan (nama, nik, …) VALUES ('Hendra', '1371…'), (…);` with values matched to their columns. */
function detectSqlInserts(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const insert = /\bINSERT\s+INTO\s+([`"\w.]+)\s*\(([^)]{1,2000})\)\s*VALUES\s*/gi;
  for (const m of text.matchAll(insert)) {
    const thingTable = THING_TABLE.test(m[1]!);
    const columns = m[2]!.split(',').map((c) => c.trim().replace(/^[`"[]|[`"\]]$/g, ''));
    // `produk.nama` is a product; only a person's table makes a bare "nama" column a name.
    const types = columns.map((c) => (thingTable && /^(?:nama|name|title|judul)$/i.test(c) ? undefined : fieldType(c)));
    if (!types.some(Boolean)) continue;
    let i = m.index + m[0].length;
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
  return out;
}

function detectStreetAddresses(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // A street only counts as personal data when it is pinned to a house: No., Blok, Kav., or RT/RW.
  const street =
    /\b(?:Jl|Jln|Jalan|Gg|Gang|Komp|Kompleks|Perum|Perumahan)\.?\s+[A-Za-z0-9][^\n;]{1,80}?(?:\b(?:No|Nomor|Blok|Kav)\.?\s*[A-Za-z]?\d+[A-Za-z]?(?:\/\d+)?(?:,?\s*RT\.?\s*\d{1,3}\s*\/\s*RW\.?\s*\d{1,3})?|\bRT\.?\s*\d{1,3}\s*\/\s*RW\.?\s*\d{1,3})/g;
  for (const m of text.matchAll(street)) out.push(match('ADDRESS', m.index, m[0], 'high'));
  const rtrw = /\bRT\.?\s*0*\d{1,3}\s*\/\s*RW\.?\s*0*\d{1,3}\b/gi;
  for (const m of text.matchAll(rtrw)) out.push(match('ADDRESS', m.index, m[0], 'medium'));
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
  if (MULTI_PART.has(type)) {
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
    const digit = v.search(/\d/);
    if (digit >= 0) v = v.slice(0, digit);
    v = takeWords(v, 5);
  }
  return v.replace(/[\s.,}\]]+$/, '').trim();
}

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
  for (const m of text.matchAll(/[ \t]*(?::(?![:\/])|=(?![=>]))[ \t]*/g)) {
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
function detectCsvColumns(text: string): PiiMatch[] {
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
  detectPlates,
  detectNames,
  detectChatSenders,
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
