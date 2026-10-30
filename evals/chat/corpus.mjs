// The chat corpus: made-up Indonesian chat messages, tickets, and WhatsApp exports, with every person's name labelled.
// It measures what the main benchmark cannot: names written the way people chat, with no label or cue in front
// ("saya di chat sama rianto surya tadi pagi", "ada yang ngeliat minan minanto ga ya"), mostly in lower case.
//
// Nobody here is real. Half the given names are common Indonesian names; the other half are made up from syllables,
// so a detector cannot pass by knowing a list of names. Dev and test use different templates, different common
// names, and different made-up names, as in evals/bench:
//   dev   for working on the detectors; look at its misses as much as you like.
//   test  held out: only for reporting. Do not tune a detector on a test document; add a dev template instead.
//
// generate({ split, seed, perTemplate }) returns documents { id, split, format, style, text, spans: [{ start, end,
// type: 'NAME', kind }], neutral: [] }, the same shape as the main benchmark's, so its exports work with the same tools.

// --- deterministic randomness ------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
  chance(p) {
    return this.next() < p;
  }
}

const pad = (n) => String(n).padStart(2, '0');

// --- names -------------------------------------------------------------------------------------------------------

const COMMON = {
  dev: {
    given: [
      'Rianto', 'Dodi', 'Ratna', 'Fadel', 'Yudi', 'Sri', 'Hendro', 'Wening', 'Pandu', 'Sekar', 'Gilang', 'Ningsih',
      'Arif', 'Susi', 'Bambang', 'Yuli', 'Ikhsan', 'Nurul', 'Jefri', 'Tika', 'Supri', 'Endah', 'Robby', 'Lilis',
    ],
    family: ['Surya', 'Pratomo', 'Hasibuan', 'Wijayakusuma', 'Lubis', 'Kartasasmita', 'Siahaan', 'Halim', 'Ramli', 'Pohan'],
  },
  test: {
    given: [
      'Hasan', 'Nining', 'Johan', 'Ayuning', 'Krisna', 'Septi', 'Darto', 'Wulandari', 'Aldi', 'Rosita', 'Fahmi', 'Kurnia',
      'Benny', 'Oktavia', 'Sugeng', 'Mirna', 'Yosef', 'Ratih', 'Herman', 'Dina', 'Usman', 'Febri', 'Agustina', 'Rendra',
    ],
    family: ['Gunadi', 'Simbolon', 'Wiratama', 'Tanoto', 'Hamzah', 'Situmeang', 'Prakoso', 'Lestaluhu', 'Daeng', 'Harjono'],
  },
};

// Made-up names: syllables and a name-like ending, never an Indonesian word in COMMON_WORDS.
const ONSETS = ['b', 'd', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'w', 'y', 'c', 'ny', 'z', 'f'];
const VOWELS = ['a', 'i', 'u', 'e', 'o'];
const ENDINGS = ['to', 'ti', 'na', 'ni', 'di', 'wan', 'wati', 'man', 'no', 'ra', 'an', 'in', 'ri', 'sa', 'yah', 'dra', 'ko', 'nto', 'ndi', 'mi', 'ah', 'el'];
const FAMILY_ENDINGS = ['jaya', 'wijaya', 'sasmita', 'kusuma', 'atmaja', 'putra', 'harja', 'negara', 'tama', 'pradja'];
// Words a made-up name must not be: chat words and the words of the templates.
const COMMON_WORDS = new Set(`
  ada aja aku amin anak apa atau bagus bahan baik balik bani banyak bapak baru bawa beli belum benar besok bisa
  bilang buka bukan bulan cara cari cuma dalam dan dari datang dia dina diri dong duduk gajian gimana guna habis
  hari harus ini itu jadi jalan jam jangan janji juga kabar kakak kalau kami kamu kan kana kantor kasih kata kayak
  kena kenapa kirim kita kok kosan kota kurang lagi lama lewat lima lihat lupa main makan malam mana mandi mantap
  masih mau minta minggu mulai muda nama nanti naik nasi nih nyampe orang pagi paham paling pasar pergi pesan pulang
  pura raja rasa ratu rumah rusak saja sakit salah sama sampai sana sapi saya sedang sehat semua sendiri siang siap
  sini soto suka sudah tadi tahu tahun tani tapi tau tempat tetap tiga tolong tuan tujuh turun udah untuk wah waktu
  yang yuk zaman pagi seni sena roti mati hati mata rata kata gula mina dana tari tanah jari lari bina cinta
  wanita pria warga negara kami putra putri sama surya bayi gigi pipi kaki tali sari dari tanto benar lain lagi
  mana dino hari bumi padi tenda kendi rendi mandi pindah
`.split(/\s+/).filter(Boolean));

function madeUpWord(rng, endings) {
  let w = '';
  const syllables = rng.int(1, 2);
  for (let i = 0; i < syllables; i++) w += rng.pick(ONSETS) + rng.pick(VOWELS) + (rng.chance(0.25) ? rng.pick(['n', 'r', 's', 'm']) : '');
  return w + rng.pick(endings);
}

function madeUpNames(seed, count, endings, banned) {
  const rng = new Rng(seed);
  const out = new Set();
  while (out.size < count) {
    const w = madeUpWord(rng, endings);
    // No doubled consonant ("tinnto"): it does not look like a name.
    if (w.length >= 4 && w.length <= 10 && !/([^aiueo])\1/.test(w) && !COMMON_WORDS.has(w) && !banned.has(w)) out.add(w);
  }
  return [...out];
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
let madeUp;
function madeUpPools() {
  if (!madeUp) {
    // Dev first; test's made-up names exclude every dev one, and both exclude the common names.
    const common = new Set([...COMMON.dev.given, ...COMMON.test.given, ...COMMON.dev.family, ...COMMON.test.family].map((w) => w.toLowerCase()));
    const devGiven = madeUpNames(11, 300, ENDINGS, common);
    const devFamily = madeUpNames(12, 120, FAMILY_ENDINGS, common);
    const seen = new Set([...common, ...devGiven, ...devFamily]);
    madeUp = {
      dev: { given: devGiven.map(cap), family: devFamily.map(cap) },
      test: { given: madeUpNames(21, 300, ENDINGS, seen).map(cap), family: madeUpNames(22, 120, FAMILY_ENDINGS, seen).map(cap) },
    };
  }
  return madeUp;
}

// A name: one word (most chat), two, or three; from common or made-up names. `full` wants at least two words.
function name(rng, split, { full = false } = {}) {
  const made = rng.chance(0.5);
  const pool = made ? madeUpPools()[split] : COMMON[split];
  const words = [rng.pick(pool.given)];
  const n = full ? (rng.chance(0.8) ? 2 : 3) : rng.chance(0.6) ? 1 : rng.chance(0.8) ? 2 : 3;
  if (n === 3) words.push(rng.pick(pool.given));
  if (n >= 2) words.push(rng.pick(pool.family));
  return { text: words.join(' '), kind: `${made ? 'made-up' : 'common'}, ${n === 1 ? 'one word' : `${n} words`}` };
}

// --- fillers -----------------------------------------------------------------------------------------------------

const PLACES = ['cikarang', 'bekasi', 'depok', 'sleman', 'tanah abang', 'pasar minggu', 'kemayoran', 'bintaro', 'cibubur', 'kuningan', 'margonda', 'stasiun manggarai', 'terminal kampung rambutan', 'serpong', 'kota tua', 'blok m'];
const BRANDS = ['indomaret', 'alfamart', 'gojek', 'grab', 'shopee', 'tokopedia', 'bca', 'starbucks', 'mcd', 'kfc', 'gramedia', 'ace hardware'];
const FOODS = ['nasi padang', 'soto betawi', 'bakso', 'martabak', 'seblak', 'gado-gado', 'mie ayam', 'es teh', 'kopi susu', 'pecel lele'];
const DAYS = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];

const FILL = {
  PLACE: (rng) => rng.pick(PLACES),
  BRAND: (rng) => rng.pick(BRANDS),
  FOOD: (rng) => rng.pick(FOODS),
  DAY: (rng) => rng.pick(DAYS),
  DATE: (rng) => `${pad(rng.int(1, 28))}/${pad(rng.int(1, 12))}/26`,
  CLOCK: (rng) => `${pad(rng.int(6, 22))}.${pad(rng.int(0, 59))}`,
};

// --- templates ---------------------------------------------------------------------------------------------------
// Written in lower case, as chat is; the style of each document sets the case. {N}, {N2}, {N3} are three different
// people in one document; {N:full} is a name of at least two words (a saved contact). {~X} is filler from FILL.

const TEMPLATES = {
  dev: [
    ['subject', '{N} udah sampe kantor belum ya?'],
    ['subject', 'td pagi {N} nelpon, katanya mau resign'],
    ['subject', 'kayaknya {N} lagi sakit deh, dari kemarin ga masuk'],
    ['subject', '{N} bilang laporannya baru bisa dikirim besok'],
    ['subject', 'btw {N} jadi ikut ke {~PLACE} ga?'],
    ['subject', 'kemarin {N} sama {N2} berantem lagi di grup'],
    ['object', 'saya di chat sama {N} tadi pagi'],
    ['object', 'ada yang ngeliat {N} ga ya'],
    ['object', 'tolong hubungi {N} ya, dia yang pegang laporan'],
    ['object', 'aku titip barang ke {N} soalnya dia lewat {~PLACE}'],
    ['object', 'udah transfer ke {N} belum? jangan lupa ya'],
    ['object', 'nanti tanya {N} aja, dia yang paham'],
    ['object', 'lagi nungguin {N} dari jam 7 belum dateng2'],
    ['object', 'sm {N} aja ya berangkatnya'],
    ['possessive', 'motornya {N} mogok lagi di depan {~BRAND}'],
    ['possessive', 'rumah {N} yang di {~PLACE} jadi dijual?'],
    ['possessive', 'anaknya {N} ulang tahun minggu depan'],
    ['vocative', '{N}, udah makan belum?'],
    ['vocative', 'woy {N} bales chat gue dong'],
    ['vocative', 'makasih banyak ya {N} 🙏'],
    ['vocative', 'makasihh kakk, {N} udah bantuin banyak'],
    ['object', 'td dibeliin {N} martabak, baik bgt'],
    ['subject', 'nyusul aja ya, {N} masih di jalan'],
    ['list', 'yang belum bayar kas: {N}, {N2}, sama {N3}'],
    ['list', 'tim shift malam: {N} dan {N2}'],
    ['cue', 'pak {N} minta laporannya dikirim sebelum jam 3'],
    ['cue', 'mbak {N} yg di bagian keuangan cuti sampe jumat'],
    ['cue', 'kata bu {N} rapatnya diundur'],
    ['cue', 'halo min, pesanan atas nama {N} belum sampai'],
    ['whatsapp', '[{~DATE} {~CLOCK}] {N:full}: guys besok jadi kumpul?\n[{~DATE} {~CLOCK}] {N2:full}: jadi, di {~PLACE} ya\n[{~DATE} {~CLOCK}] {N:full}: oke siap'],
    ['whatsapp', '{~DATE} {~CLOCK} - {N:full}: {N2} udah otw belum?\n{~DATE} {~CLOCK} - {N3:full}: katanya bentar lagi'],
    ['trap', 'besok rapat jam 9, jangan lupa bawa laptop ya'],
    ['trap', 'harga beras naik lagi di {~PLACE}'],
    ['trap', 'kirim aja ke gudang {~PLACE} sebelum makan siang'],
    ['trap', 'td beli {~FOOD} di {~BRAND}, enak banget'],
    ['trap', 'gimana kabar kantor? masih sibuk ga'],
    ['trap', 'promo {~BRAND} hari {~DAY} lumayan juga'],
    ['trap', 'bunga mawar di depan rumah udah mekar, indah banget'],
    ['trap', 'wkwk iya bener, mantap jiwa'],
    ['trap', 'yaudah gas aja, ntar kabarin ya'],
    ['trap', 'ojek online nya nyasar ke {~PLACE} masa'],
  ],
  test: [
    ['subject', '{N} katanya telat, macet di {~PLACE}'],
    ['subject', 'barusan {N} ngabarin kalau paketnya udah nyampe'],
    ['subject', 'tadi siang {N} dateng ke rumah bawa {~FOOD}'],
    ['subject', 'kok {N} ga ada kabar ya dari kemarin'],
    ['subject', 'akhirnya {N} lulus juga sidangnya'],
    ['subject', '{N} sama {N2} jadi nikah bulan depan'],
    ['object', 'aku baru telponan sama {N} barusan'],
    ['object', 'coba kabarin {N} kalau rapatnya batal'],
    ['object', 'semalem ketemu {N} di {~BRAND} deket kosan'],
    ['object', 'jangan lupa bayar utang ke {N} wkwk'],
    ['object', 'gue nebeng {N} pulangnya'],
    ['object', 'td dimarahin {N} gara2 telat'],
    ['object', 'udah izin ke {N} belum buat besok?'],
    ['object', 'ada yg tau nomornya {N} ga?'],
    ['possessive', 'hp {N} ketinggalan di mobil'],
    ['possessive', 'istrinya {N} baru lahiran kemarin'],
    ['possessive', 'laptopnya {N} kena air, ga bisa nyala'],
    ['vocative', '{N} jangan lupa nanti sore ya'],
    ['vocative', 'met ultah {N}! semoga sehat selalu'],
    ['vocative', 'oi {N}, file nya udah gue kirim'],
    ['list', 'yang ikut futsal: {N}, {N2}, {N3}'],
    ['list', 'piket hari ini {N} sama {N2}'],
    ['cue', 'bang {N} udah nyampe belum?'],
    ['cue', 'kak {N} pesanan saya kok belum dikirim'],
    ['cue', 'om {N} nitip salam buat keluarga'],
    ['cue', 'min paket saya atas nama {N} statusnya masih diproses'],
    ['whatsapp', '{~DATE}, {~CLOCK} - {N:full}: ada yg liat {N2} ga?\n{~DATE}, {~CLOCK} - {N3:full}: td di kantin'],
    ['whatsapp', '[{~CLOCK}] {N:full}: siap\n[{~CLOCK}] {N2:full}: {N3} nanti jemput ya'],
    ['trap', 'rapat diundur ke hari {~DAY} ya, jamnya tetap'],
    ['trap', 'stok {~FOOD} di {~BRAND} habis terus'],
    ['trap', 'jalanan ke {~PLACE} banjir, mending lewat tol'],
    ['trap', 'udah gajian belum? mau ke {~BRAND} nih'],
    ['trap', 'cuaca hari ini cerah, bintang di langit keliatan jelas'],
    ['trap', 'nitip {~FOOD} dong kalau lewat {~PLACE}'],
    ['trap', 'haha iya sih, santai aja'],
    ['trap', 'besok libur nasional kan? kantor tutup'],
    ['trap', 'putri malu di taman udah tumbuh lagi'],
    ['trap', 'grup ini buat koordinasi acara {~DAY} ya'],
  ],
};

// How a document is written: all lower case (most chat), proper case, proper case with the names in lower case, or
// all capitals. Saved contacts in a WhatsApp export keep their own case.
const STYLES = [['lower', 0.55], ['proper', 0.25], ['name-lower', 0.15], ['upper', 0.05]];

function pickStyle(rng) {
  let r = rng.next();
  for (const [style, p] of STYLES) {
    if ((r -= p) < 0) return style;
  }
  return 'lower';
}

function render(template, rng, split, style) {
  const people = {};
  const spans = [];
  let text = '';
  const caseText = (s) => (style === 'upper' ? s.toUpperCase() : s);
  const caseName = (s, contact) => {
    if (contact) return rng.chance(0.2) ? s.toLowerCase() : s;
    if (style === 'upper') return s.toUpperCase();
    return style === 'proper' ? s : s.toLowerCase();
  };
  for (const part of template.split(/(\{[^}]+\})/)) {
    const slot = /^\{(~?)([A-Z0-9]+)(?::(\w+))?\}$/.exec(part);
    if (!slot) {
      text += caseText(part);
      continue;
    }
    const [, filler, key, option] = slot;
    if (filler) {
      text += caseText(FILL[key](rng));
      continue;
    }
    const contact = option === 'full';
    people[key] ??= name(rng, split, { full: contact });
    if (contact && !people[key].text.includes(' ')) people[key] = name(rng, split, { full: true });
    const value = caseName(people[key].text, contact);
    spans.push({ start: text.length, end: text.length + value.length, type: 'NAME', kind: people[key].kind });
    text += value;
  }
  // Proper case starts each line with a capital.
  if (style === 'proper' || style === 'name-lower') text = text.replace(/(^|\n)([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return { text, spans };
}

export const SPLITS = Object.keys(TEMPLATES);
// Bumped when templates or name pools change: numbers from different corpus versions cannot be compared.
export const CORPUS_VERSION = 1;

export function generate({ split = 'test', seed = split === 'dev' ? 1 : 2, perTemplate = 50 } = {}) {
  const templates = TEMPLATES[split];
  if (!templates) throw new Error(`unknown split ${split}`);
  const rng = new Rng(seed);
  const docs = [];
  for (const [t, [format, template]] of templates.entries()) {
    for (let i = 0; i < perTemplate; i++) {
      const style = pickStyle(rng);
      const { text, spans } = render(template, rng, split, style);
      docs.push({ id: `chat-${split}-${t}-${i}`, split, format, style, text, spans, neutral: [] });
    }
  }
  return docs;
}
