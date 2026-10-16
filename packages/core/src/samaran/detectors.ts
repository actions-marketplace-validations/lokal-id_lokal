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

function detectPhones(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  const mobile = /(?<![\d+\w])(?:\+62|62|0)[\s-]?8\d{1,2}(?:[\s.-]?\d){6,10}(?![\d\w])/g;
  for (const m of text.matchAll(mobile)) {
    if (parsePhone(m[0]).valid) out.push(match('PHONE', m.index, m[0], 'high'));
  }
  const landline = /\((?:\+62\s?|0)\d{2,3}\)\s?\d{3,4}[\s-]?\d{3,4}(?!\d)|(?<![\d\w])\+62\s?[2-79]\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4}(?!\d)/g;
  for (const m of text.matchAll(landline)) out.push(match('PHONE', m.index, m[0], 'medium'));
  return out;
}

// Domains reserved for documentation and testing (RFC 2606, RFC 6761) never belong to a person.
const RESERVED_EMAIL_DOMAIN = /@(?:[\w-]+\.)*(?:example\.(?:com|net|org)|[\w-]+\.(?:example|test|invalid|localhost))$/i;

function detectEmails(text: string): PiiMatch[] {
  const re = /(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;
  return [...text.matchAll(re)]
    .filter((m) => !RESERVED_EMAIL_DOMAIN.test(m[0]))
    .map((m) => match('EMAIL', m.index, m[0], 'high'));
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

function detectHealth(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  // Strong medical verbs: whatever follows is the condition.
  const strong =
    /\b(?:didiagnosis|didiagnosa|terdiagnosis|terdiagnosa|mengidap|terinfeksi|riwayat penyakit|divonis)\s+(?:menderita\s+|mengidap\s+|penyakit\s+)?([^\n,.;:()]{2,60}?)(?=\s+(?:sejak|selama|dan sudah|dan sedang|tapi|namun|sehingga|jadi)\b|[\n,.;:()]|$)/gi;
  for (const m of text.matchAll(strong)) {
    out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'high'));
  }
  // Everyday verbs ("positif", "menderita", "pasien") only count before a known condition.
  const gated = new RegExp(
    `\\b(?:positif|menderita|terkena|kena|sakit|pasien|penderita|pengidap|penyintas|mengalami)\\s+((?:penyakit\\s+)?(?:${CONDITIONS}))\\b`,
    'gi',
  );
  for (const m of text.matchAll(gated)) {
    out.push(match('HEALTH', m.index + m[0].length - m[1]!.length, m[1]!, 'medium'));
  }
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

const NAME_STOP = /\s(?:dan|dengan|yang|nik|hp|no|nomor|umur|usia|alamat|email|tinggal|lahir|asal|dari|di|ke|untuk|sebagai|mau|ingin|minta|tolong)\b/i;
const MULTI_PART: ReadonlySet<PiiType> = new Set(['ADDRESS', 'BIRTH_DATE', 'HEALTH', 'GEO']);

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
      v = words.slice(0, cut).join(' ');
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
    const stop = v.search(NAME_STOP);
    if (stop >= 0) v = v.slice(0, stop);
    const digit = v.search(/\d/);
    if (digit >= 0) v = v.slice(0, digit);
    v = v.split(/\s+/).slice(0, 5).join(' ');
  }
  return v.replace(/[\s.,}\]]+$/, '').trim();
}

const LABEL = /((?:["'`]?[A-Za-z][A-Za-z0-9_./-]*["'`]?[ \t]+){0,4}["'`]?[A-Za-z][A-Za-z0-9_./-]*["'`]?)$/;

/**
 * "Label: value" in prose, forms, logs, JSON, YAML and .env:
 * "Agama: Islam", "NAMA : BUDI SANTOSO", "tgl. lahir: 15-08-1995", "nama: budi", "customer_email" = "…".
 */
function detectLabeledFields(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(/[ \t]*(?::(?![:\/])|=(?![=>]))[ \t]*/g)) {
    const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
    const label = LABEL.exec(text.slice(lineStart, m.index).trimEnd());
    if (!label) continue;
    const words = label[1]!.trim().split(/[ \t]+/);
    let type: PiiType | undefined;
    let key = '';
    for (let i = 0; i < words.length && !type; i++) {
      key = words.slice(i).join(' ');
      type = fieldType(key);
    }
    if (!type) continue;

    const valueStart = m.index + m[0].length;
    const lineEnd = text.indexOf('\n', valueStart);
    const raw = text.slice(valueStart, lineEnd === -1 ? text.length : lineEnd).replace(/\r$/, '');
    let value: string;
    let start = valueStart;
    const quote = raw[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      const close = raw.indexOf(quote, 1);
      if (close === -1) continue;
      value = raw.slice(1, close);
      start += 1;
    } else {
      value = cutValue(type, raw);
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
  detectStreetAddresses,
  detectLabeledFields,
  detectCsvColumns,
];

export interface DetectOptions {
  types?: readonly PiiType[];
  /** "high" only keeps validated or keyword-anchored matches. Default "medium". */
  minConfidence?: Confidence;
}

/** All personal data in the text, non-overlapping, in reading order. */
export function detectPii(text: string, options: DetectOptions = {}): PiiMatch[] {
  const types = new Set(options.types ?? PII_TYPES);
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
