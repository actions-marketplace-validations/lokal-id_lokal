// Free-text Indonesian addresses → Kemendagri regions. "Jl. Margonda Raya No. 100 RT 3/5 Kemiri Muka, Beji, Depok
// 16424" becomes the street, RT/RW, kode pos, and the kelurahan, kecamatan, kota, and provinsi with their codes.
// Region names are matched against the Kemendagri data; a region only counts when the rest of the address agrees with
// it (its parents, a level word such as "kec.", or the kode pos), since many villages share a name.
import { getWilayah, regionNames, villagesWithPostalCode, type Wilayah, type WilayahLevel } from './wilayah.ts';

export type AlamatLevel = 'provinsi' | 'kabupatenKota' | 'kecamatan' | 'kelurahanDesa';
const LEVEL_KEYS: AlamatLevel[] = ['provinsi', 'kabupatenKota', 'kecamatan', 'kelurahanDesa'];

export interface ParsedAlamat {
  /** Street, house number, block, and housing estate, as written: "Jl. Margonda Raya No. 100". */
  street?: string;
  /** Three digits, as Dukcapil writes them: "003". */
  rt?: string;
  rw?: string;
  /** The kode pos as written in the address. */
  postalCode?: string;
  provinsi?: Wilayah;
  kabupatenKota?: Wilayah;
  kecamatan?: Wilayah;
  kelurahanDesa?: Wilayah;
  /** Code of the most specific region found, e.g. "32.76.02.1005". */
  code?: string;
  /** Levels taken from the region's code or the kode pos, not read from the text. */
  inferred: AlamatLevel[];
  /**
   * high: the kelurahan/desa and its kecamatan or kota were read from the text and agree with the kode pos.
   * medium: a region was found and agrees with something else in the address. low: a guess. none: no region.
   */
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** Things to check, such as a kode pos that belongs to another kelurahan. */
  issues: string[];
  /** Other regions the address could mean, most likely first. */
  alternatives: Wilayah[];
  /** The address in the usual order: street, RT/RW, kelurahan, kecamatan, kota, provinsi, kode pos. */
  formatted?: string;
}

// --- region names --------------------------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const PROVINCE_ALIASES: Record<string, string[]> = {
  '11': ['nad', 'nanggroe aceh darussalam'],
  '12': ['sumut'],
  '13': ['sumbar'],
  '16': ['sumsel'],
  '19': ['babel', 'bangka belitung'],
  '21': ['kepri'],
  '31': ['dki', 'dki jakarta', 'jakarta'],
  '32': ['jabar'],
  '33': ['jateng'],
  '34': ['diy', 'yogyakarta', 'jogja', 'jogjakarta', 'yogya', 'di yogyakarta'],
  '35': ['jatim'],
  '52': ['ntb'],
  '53': ['ntt'],
  '61': ['kalbar'],
  '62': ['kalteng'],
  '63': ['kalsel'],
  '64': ['kaltim'],
  '65': ['kaltara'],
  '71': ['sulut'],
  '72': ['sulteng'],
  '73': ['sulsel'],
  '74': ['sultra'],
  '76': ['sulbar'],
  '82': ['malut'],
  '92': ['papua barat', 'pabar'],
};
const REGENCY_ALIASES: Record<string, string[]> = {
  '31.71': ['jakpus', 'jakarta pusat'],
  '31.72': ['jakut', 'jakarta utara'],
  '31.73': ['jakbar', 'jakarta barat'],
  '31.74': ['jaksel', 'jakarta selatan'],
  '31.75': ['jaktim', 'jakarta timur'],
  '36.74': ['tangsel'],
};

const NUMERALS = [
  ['satu', 'i', '1'],
  ['dua', 'ii', '2'],
  ['tiga', 'iii', '3'],
  ['empat', 'iv', '4'],
  ['lima', 'v', '5'],
  ['enam', 'vi', '6'],
  ['tujuh', 'vii', '7'],
  ['delapan', 'viii', '8'],
  ['sembilan', 'ix', '9'],
  ['sepuluh', 'x', '10'],
];

let index: Map<string, string[]> | undefined;
let longest = 1;

/** Normalized name → region codes, for every level. Kabupaten and kota are indexed without that word. */
function nameIndex(): Map<string, string[]> {
  if (index) return index;
  index = new Map();
  const add = (key: string, code: string) => {
    if (!key) return;
    let codes = index!.get(key);
    if (!codes) index!.set(key, (codes = []));
    if (!codes.includes(code)) codes.push(code);
    longest = Math.max(longest, key.split(' ').length);
  };
  for (const [code, name] of regionNames()) {
    const level = code.split('.').length;
    const n = norm(name);
    if (level === 2) add(n.replace(/^(?:kabupaten|kota)(?: administrasi)? /, ''), code);
    else add(n, code);
    // "Kotabaru", "Pangkalpinang": also findable as written apart, and the other way round. Not with numbers: "Sei
    // Dadap I II" run together is "Sei Dadap III".
    if (level >= 3 && n.includes(' ') && !/\b(?:[ivx]+|\d+)\b/.test(n)) add(n.replace(/ /g, ''), code);
    // "Ilir Barat Dua" is also written "Ilir Barat II" or "Ilir Barat 2", and the other way round.
    if (level >= 3) {
      const words = n.split(' ');
      for (const forms of NUMERALS) {
        const at = words.findIndex((w, i) => i > 0 && forms.includes(w));
        if (at < 0) continue;
        for (const form of forms) add([...words.slice(0, at), form, ...words.slice(at + 1)].join(' '), code);
      }
    }
  }
  for (const [code, aliases] of [...Object.entries(PROVINCE_ALIASES), ...Object.entries(REGENCY_ALIASES)]) {
    for (const alias of aliases) add(alias, code);
  }
  return index;
}

// --- reading the text ----------------------------------------------------------------------------------------

interface Hint {
  level: WilayahLevel;
  kind?: 'kota' | 'kabupaten';
  /** Kelurahan have codes 1xxx, desa (gampong, nagari, kampung) 2xxx. People mix the words up, so it is a preference. */
  village?: 'kelurahan' | 'desa';
}
const HINTS: Record<string, Hint> = {
  kel: { level: 4, village: 'kelurahan' },
  kelurahan: { level: 4, village: 'kelurahan' },
  desa: { level: 4, village: 'desa' },
  ds: { level: 4, village: 'desa' },
  gampong: { level: 4, village: 'desa' },
  nagari: { level: 4, village: 'desa' },
  kec: { level: 3 },
  kecamatan: { level: 3 },
  distrik: { level: 3 },
  kab: { level: 2, kind: 'kabupaten' },
  kabupaten: { level: 2, kind: 'kabupaten' },
  kota: { level: 2, kind: 'kota' },
  kotamadya: { level: 2, kind: 'kota' },
  kodya: { level: 2, kind: 'kota' },
  prov: { level: 1 },
  provinsi: { level: 1 },
  propinsi: { level: 1 },
  prop: { level: 1 },
};
/** Words between a level word and the name: "Kota Adm. Jakarta Selatan", "Kab. Administrasi Kepulauan Seribu". */
const FILLER = new Set(['adm', 'administrasi', 'daerah', 'tingkat', 'ii']);
/**
 * Shortened words in names, as Google Maps writes them ("Kec. Kby. Baru", "Kota Jakarta Sel.", "Tj. Priok"). The
 * ones in DOTTED only count with a dot after them, since they are also words or names of their own.
 */
const SHORT: Record<string, string> = {
  kby: 'kebayoran',
  kb: 'kebon',
  pd: 'pondok',
  tj: 'tanjung',
  tg: 'tanjung',
  tlk: 'teluk',
  kp: 'kampung',
  ps: 'pasar',
  klp: 'kelapa',
  prpt: 'prapatan',
  cemp: 'cempaka',
  gn: 'gunung',
  bkt: 'bukit',
  jkt: 'jakarta',
  utr: 'utara',
  tgh: 'tengah',
  bar: 'barat',
  tim: 'timur',
  sel: 'selatan',
  ut: 'utara',
  teng: 'tengah',
};
const DOTTED = new Set(['bar', 'tim', 'sel', 'ut', 'teng', 'tg', 'gn']);
/** A Google Plus Code in front of the address: "92JW+6X7". */
const PLUS_CODE = /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/gi;

const STREET_START =
  /\b(?:jl|jln|jalan|gg|gang|lr|lorong|komp|komplek|kompleks|perum|perumahan|perumnas|cluster|klaster|blok|dusun|dsn|lingkungan|lingk|lk|jorong|apartemen|apartment|apt|ruko|graha|wisma|tower|menara)\b\.?/gi;
const STREET_STOP = /[,;\n]|\b(?:rt|rw|kel|kelurahan|desa|ds|kec|kecamatan|distrik|kab|kabupaten|kota|prov|provinsi|propinsi)\b\.?|\b[1-9]\d{4}\b/i;
const HOUSE_NUMBER = /\b(?:no|nomor|nmr)\b\.?\s*[\w/-]+/i;
const RT_RW = /\brt[.:]?\s*0*(\d{1,3})\b(?:\s*(?:[/\\-]|\s)\s*(?:rw[.:]?\s*)?0*(\d{1,3})\b)?|\brw[.:]?\s*0*(\d{1,3})\b/gi;
/** "Kode Pos:" in front of the kode pos. */
const POSTAL_LABEL = /\b(?:kode\s*pos|kodepos|kd\.?\s*pos)\b\s*[.:]?/gi;
const POSTAL = /(?<![\d.-])[1-9]\d{4}(?![\d.-])/g;

type Range = [number, number];

function streetRanges(text: string): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(STREET_START)) {
    const start = m.index;
    if (out.length && start < out[out.length - 1]![1]) continue;
    const rest = text.slice(start + m[0].length);
    // The first word is the street's name even when it is a level word: "Jalan Kota Baru", "Jl. Kecamatan".
    const first = /^\s*[^\s,;]+/.exec(rest)?.[0].length ?? 0;
    const after = STREET_STOP.exec(rest.slice(first));
    const stop = after && { index: first + after.index, text: after[0] };
    const before = rest.slice(0, stop ? stop.index : rest.length);
    // Up to a comma, "RT", or "Kel."; within that, up to the house number ("No. 5", or a bare "22" after the street
    // name), or before a kota, kabupaten, or provinsi name. With nothing marking the end ("jl melati wuwur gabus pati
    // 59173": a kode pos ends the address, not the street), only the first word is surely the street. The rest is
    // left to the region names, and the street is then read as everything before them.
    const delimited = !!stop && !/^\d/.test(stop.text);
    let length = 0;
    let n = 0;
    for (const w of before.matchAll(/\S+/g)) {
      const word = norm(w[0]);
      if (n >= 1 && (nameIndex().get(word) ?? []).some((code) => levelOf(code) <= 2)) break;
      length = w.index + w[0].length;
      n++;
      if ((n >= 2 && /^\d+[a-z]?$/.test(word)) || (!delimited && n >= 1)) break;
    }
    const house = HOUSE_NUMBER.exec(before);
    if (house && house.index < length) length = Math.min(length, house.index + house[0].length);
    out.push([start, start + m[0].length + length]);
  }
  return out;
}

interface Token {
  /** Lowercase, with shortened words written out ("kby." → "kebayoran"). */
  word: string;
  /** Lowercase, as written. */
  raw: string;
  start: number;
  end: number;
  /** A comma, a line break, or a part already read (street, RT/RW, kode pos) comes before this word. */
  breakBefore: boolean;
}

function tokens(text: string, skip: Range[]): Token[] {
  const out: Token[] = [];
  let pendingBreak = true;
  for (const m of text.matchAll(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?|[,;\n|()/]/g)) {
    const start = m.index;
    const end = start + m[0].length;
    // A slash inside a name joins its parts: "Mantehage/Buhias", "Sei Dadap III/IV".
    if (m[0] === '/' && /[A-Za-z]/.test(text[start - 1] ?? '') && /[A-Za-z]/.test(text[end] ?? '')) continue;
    if (!/[A-Za-z0-9]/.test(m[0]) || skip.some(([a, b]) => start < b && end > a)) {
      pendingBreak = true;
      continue;
    }
    const raw = m[0].toLowerCase().replace(/['’]/g, '');
    const short = SHORT[raw];
    const word = short && (!DOTTED.has(raw) || text[end] === '.') ? short : raw;
    out.push({ word, raw, start, end, breakBefore: pendingBreak });
    pendingBreak = false;
  }
  return out;
}

// --- matching regions ------------------------------------------------------------------------------------------

interface Hit {
  code: string;
  level: WilayahLevel;
  /** Word positions in the token list, `to` exclusive. */
  from: number;
  to: number;
  /** The words matched, as normalized. */
  text: string;
  hinted: boolean;
  /** No other region anywhere (at the level the address marks, if it does) has this name. */
  unique: boolean;
  /** Unique, and more than one word ("Denpasar Selatan"). */
  distinctive: boolean;
  /** Matched with a typo ("Cibinog" for Cibinong). */
  fuzzy?: boolean;
}

/** A name the address marks with a level word ("Desa Sukamaju"), to report when no such region is found. */
interface Marked {
  level: WilayahLevel;
  text: string;
}

const levelOf = (code: string) => code.split('.').length as WilayahLevel;
const isKota = (code: string) => levelOf(code) === 2 && Number(code.slice(3, 5)) >= 71;
const villageKind = (code: string) => (code.slice(-4, -3) === '1' ? 'kelurahan' : 'desa');
const fits = (code: string, hint: Hint | undefined) =>
  !hint || (hint.level === levelOf(code) && (!hint.kind || (hint.kind === 'kota') === isKota(code)));

/** The level word right before word `i`, skipping "adm." and the like. */
function hintAt(words: Token[], i: number): Hint | undefined {
  for (let j = i - 1; j >= 0 && !words[j + 1]!.breakBefore; j--) {
    const w = words[j]!.word;
    if (HINTS[w]) return HINTS[w];
    if (!FILLER.has(w)) return undefined;
  }
  return undefined;
}

/** Hits for the regions a span of words names, already narrowed to the level its level word gives. */
function toHits(codes: string[], hint: Hint | undefined, from: number, to: number, text: string, fuzzy = false): Hit[] {
  // "Kel. Kamal" prefers the kelurahan in Jakarta Barat to the desa of that name.
  const preferred = hint?.village && codes.some((code) => villageKind(code) === hint.village);
  const unique = !fuzzy && codes.length === 1;
  return codes.map((code) => ({
    code,
    level: levelOf(code),
    from,
    to,
    text,
    hinted: !!hint && (!preferred || villageKind(code) === hint.village),
    unique,
    distinctive: to - from > 1 && unique,
    ...(fuzzy && { fuzzy }),
  }));
}

function findHits(words: Token[]): { hits: Hit[]; marked: Marked[] } {
  const names = nameIndex();
  const hits: Hit[] = [];
  const marked: Marked[] = [];
  for (let i = 0; i < words.length; i++) {
    const hint = hintAt(words, i);
    // The name after a level word may itself start with one: "Kec. Kota Baru".
    if (hint && !FILLER.has(words[i]!.word)) {
      const name: string[] = [];
      for (let k = i; k < words.length && name.length < 4; k++) {
        if (k > i && (words[k]!.breakBefore || HINTS[words[k]!.word])) break;
        name.push(words[k]!.word);
      }
      marked.push({ level: hint.level, text: name.join(' ') });
    }
    // A level word before a name is a label, not a name by itself: there is a desa called Kelurahan in Kabupaten
    // Semarang. It can start one ("Kota Maju").
    const label = !hint && !!HINTS[words[i]!.word] && i + 1 < words.length && !words[i + 1]!.breakBefore;
    let key = '';
    let raw = '';
    for (let len = 1; len <= longest && i + len <= words.length; len++) {
      const w = words[i + len - 1]!;
      if (len > 1 && w.breakBefore) break;
      key = len === 1 ? w.word : `${key} ${w.word}`;
      raw = len === 1 ? w.raw : `${raw} ${w.raw}`;
      if (label && len === 1) continue;
      // "Suka Maju" for "Sukamaju": the words run together find a name written as one.
      const lookup = (k: string) => [...(names.get(k) ?? []), ...(len > 1 ? (names.get(k.replace(/ /g, '')) ?? []) : [])];
      const codes = [...new Set([...lookup(key), ...(raw !== key ? lookup(raw) : [])])].filter((code) => fits(code, hint));
      hits.push(...toHits(codes, hint, i, i + len, key));
    }
  }
  // A name inside a longer kota, kabupaten, or provinsi, or a longer name the address marks, is not a name of its own:
  // "Lampung" in "Lampung Timur", "Depok" in "Kel. Depok Jaya". Other longer names may run into the next one ("wates
  // wates kulon progo" holds a desa Wates Kulon elsewhere).
  const inside = (h: Hit) =>
    hits.some((g) => (g.level <= 2 || g.hinted) && g.from <= h.from && g.to >= h.to && g.to - g.from > h.to - h.from);
  return { hits: hits.filter((h) => !inside(h)), marked };
}

// --- names with a typo -----------------------------------------------------------------------------------------

let regionPool: Array<[string, string[], string]> | undefined;
let childPool: Map<string, Array<[string, string, string]>> | undefined;

/** Names without spaces: kabupaten, kota, and provinsi; and the kecamatan and kelurahan of each kabupaten or kota. */
function pools(): { regions: Array<[string, string[], string]>; children: Map<string, Array<[string, string, string]>> } {
  if (!regionPool || !childPool) {
    const regions: Array<[string, string[], string]> = [];
    const children = new Map<string, Array<[string, string, string]>>();
    for (const [key, codes] of nameIndex()) {
      const flat = key.replace(/ /g, '');
      const top = codes.filter((code) => levelOf(code) <= 2);
      if (top.length) regions.push([flat, top, key]);
      for (const code of codes) {
        if (levelOf(code) < 3) continue;
        let list = children.get(code.slice(0, 5));
        if (!list) children.set(code.slice(0, 5), (list = []));
        list.push([flat, code, key]);
      }
    }
    regionPool = regions;
    childPool = children;
  }
  return { regions: regionPool, children: childPool };
}

/** Edits between two words (a swap of two letters is one), or `max + 1` once it is more than `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2]! + 1);
      row.push(d);
      low = Math.min(low, d);
    }
    if (low > max) return max + 1;
    before = prev;
    prev = row;
  }
  return prev[b.length]!;
}

const endNumber = (name: string) => /(?:^| )([ivx]+|\d+)$/.exec(name)?.[1];

/** Typos allowed in a name of this many letters: none in short names, where one letter makes another name. */
const allowed = (letters: number) => (letters >= 10 ? 2 : letters >= 5 ? 1 : 0);

/**
 * Names written with a typo, for the words no region was found for: "Kab. Tasikmalayah", "Cibinog, Bogor". Kabupaten,
 * kota, and provinsi are looked for everywhere; kecamatan and kelurahan only inside the kabupaten or kota the address
 * names or its kode pos points to, since thousands of villages are one letter apart. The first letter has to match.
 */
function typoHits(words: Token[], hits: Hit[], postalVillages: string[] | undefined): Hit[] {
  // A kabupaten, kota, or provinsi written right, or a name of more than one word no other region has ("Pasar
  // Minggu"), is not a typo of another name.
  const covered = new Set<number>();
  for (const h of hits) if (h.level <= 2 || h.distinctive) for (let k = h.from; k < h.to; k++) covered.add(k);
  const spans: Array<{ from: number; to: number; flat: string; text: string; hint: Hint | undefined }> = [];
  for (let i = 0; i < words.length; i++) {
    let flat = '';
    for (let len = 1; len <= 3 && i + len <= words.length; len++) {
      const w = words[i + len - 1]!;
      if ((len > 1 && w.breakBefore) || covered.has(i + len - 1) || HINTS[w.word] || FILLER.has(w.word) || !/^[a-z]+$/.test(w.word)) break;
      flat += w.word;
      if (allowed(flat.length)) {
        const text = words.slice(i, i + len).map((t) => t.word).join(' ');
        spans.push({ from: i, to: i + len, flat, text, hint: hintAt(words, i) });
      }
    }
  }
  if (!spans.length) return [];
  const { regions, children } = pools();
  const out: Hit[] = [];
  // The closest names, if there are only a few of them.
  const add = (span: (typeof spans)[number], candidates: Iterable<[string, string[] | string, string]>) => {
    const max = allowed(span.flat.length);
    // "Jaga Baya I" is not Jagabaya II, and "Rengas" not Rengas IX: a number at the end has to be the same.
    const number = endNumber(span.text);
    let bestDistance = max + 1;
    let codes: string[] = [];
    for (const [name, found, key] of candidates) {
      if (name[0] !== span.flat[0] || endNumber(key) !== number) continue;
      const d = distance(span.flat, name, Math.min(max, bestDistance));
      if (d > max || d > bestDistance || d === 0) continue;
      const fitting = (typeof found === 'string' ? [found] : found).filter((code) => fits(code, span.hint));
      if (!fitting.length) continue;
      if (d < bestDistance) codes = [];
      bestDistance = d;
      codes.push(...fitting);
    }
    codes = [...new Set(codes)];
    if (codes.length && codes.length <= 3) out.push(...toHits(codes, span.hint, span.from, span.to, span.text, true));
  };
  for (const span of spans) add(span, regions);
  // Where to look: the kabupaten and kota named, the kode pos, or a kecamatan the address marks or no other region shares.
  const scope = new Set<string>();
  for (const h of [...hits, ...out]) if (h.level === 2) scope.add(h.code);
  for (const v of postalVillages ?? []) scope.add(v.slice(0, 5));
  if (!scope.size) for (const h of hits) if (h.level === 3 && (h.hinted || h.unique)) scope.add(h.code.slice(0, 5));
  if (scope.size > 6) return out;
  for (const span of spans) for (const kab of scope) add(span, children.get(kab) ?? []);
  return out;
}

interface Chain {
  node: Hit;
  /** The hits used, by level (1–4); a level the text does not name is missing. */
  used: Map<WilayahLevel, Hit>;
  score: number;
  postalAgrees: boolean;
  /** A name the address marks with a level word is left out ("Dusun Donomulyo, Desa Adipuro" read as Donomulyo). */
  ignoresMarked: boolean;
}

const WEIGHT: Record<WilayahLevel, number> = { 1: 2, 2: 3, 3: 3, 4: 3 };

function chains(hits: Hit[], postalVillages: string[] | undefined): Chain[] {
  const out: Chain[] = [];
  for (const node of hits) {
    const used = new Map<WilayahLevel, Hit>([[node.level, node]]);
    const parts = node.code.split('.');
    for (let level = node.level - 1; level >= 1; level--) {
      const prefix = parts.slice(0, level).join('.');
      const overlaps = (h: Hit) => [...used.values()].some((u) => h.from < u.to && h.to > u.from);
      // Parents come after: in "Gedung Setiabudi, Karet, Setiabudi" the second Setiabudi is Karet's kecamatan.
      const after = (h: Hit) => Number(h.from >= node.to);
      const best = hits
        .filter((h) => h.code === prefix && !overlaps(h))
        .sort((a, b) => after(b) - after(a) || b.to - b.from - (a.to - a.from) || Number(b.hinted) - Number(a.hinted))[0];
      if (best) used.set(level as WilayahLevel, best);
    }
    const postalAgrees =
      !!postalVillages && postalVillages.some((v) => v === node.code || v.startsWith(`${node.code}.`));
    let score = 0;
    for (const [level, h] of used) score += WEIGHT[level] - (h.fuzzy ? 1 : 0) + (h.hinted ? 2 : 0) + 0.5 * (h.to - h.from - 1);
    // Addresses run from small to large; a kota named before its own kelurahan is likely part of a street name
    // ("Jl. Raya Bogor KM 30, Cimanggis").
    for (const [level, h] of used) for (const [other, g] of used) if (other < level && g.from < h.from) score -= 1.5;
    if (postalAgrees) score += node.level === 4 ? 3 : 2;
    else if (postalVillages && node.level >= 3) score -= 1;
    // Another kecamatan or kelurahan of the same kota named but left out: "Lengkong Gudang, Serpong, Tangsel 15311" is
    // the kelurahan Lengkong Gudang in Serpong with a wrong kode pos, not the kelurahan Serpong that has that kode pos.
    const all = [...used.values()];
    // Not read yet: a name repeated ("Sinduadi, Sleman, Kabupaten Sleman") is read already.
    const free = (h: Hit) => !all.some((u) => (h.from < u.to && h.to > u.from) || h.text === u.text);
    const left = hits.some(
      (h) =>
        !h.fuzzy &&
        h.level >= 3 &&
        h.code.startsWith(`${node.code.slice(0, 5)}.`) &&
        !node.code.startsWith(h.code) &&
        free(h),
    );
    if (left) score -= 3;
    const ignoresMarked = hits.some((h) => !h.fuzzy && h.hinted && !node.code.startsWith(h.code) && free(h));
    if (ignoresMarked) score -= 2;
    // A lone name only counts when it is a kabupaten, kota, or provinsi, or the address marks or confirms it, or no
    // other region has that name. A name with a typo needs a level word or another name with it.
    // With a typo, a parent has to come after it, or the kode pos agree: "Jl. Raya Metro Wates, Desa Purwodadi" is not
    // a typo of Purwosari in Kota Metro.
    const parentAfter = [...used].some(([level, h]) => level < node.level && h.from >= node.to);
    const supported = node.fuzzy
      ? parentAfter || postalAgrees || (node.level <= 2 && node.hinted)
      : used.size > 1 || node.hinted || postalAgrees || node.level <= 2 || node.unique;
    if (supported) out.push({ node, used, score, postalAgrees, ignoresMarked });
  }
  // A tie goes to the larger region: "Pondok Aren, Tangsel" is the kecamatan, not the kelurahan of the same name.
  return out.sort(
    (a, b) => b.score - a.score || a.node.level - b.node.level || (a.node.code < b.node.code ? -1 : 1),
  );
}

// --- putting it together -------------------------------------------------------------------------------------

/** The deepest region that contains every code: "32.76.06" for two kelurahan in Beji. */
function commonPrefix(codes: string[]): string {
  return codes.reduce((p, v) => {
    const a = p.split('.');
    const b = v.split('.');
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return a.slice(0, i).join('.');
  });
}
const related = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
const pad3 = (n: string) => n.padStart(3, '0');
const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const LEVEL_WORD: Record<WilayahLevel, string> = { 1: 'Provinsi', 2: 'Kabupaten/kota', 3: 'Kecamatan', 4: 'Kelurahan/desa' };
/** A region as a sentence names it: "Kecamatan Beji", "Kota Depok", "Jawa Barat". */
function label(w: Wilayah): string {
  if (w.level === 3) return `${w.type === 'distrik' ? 'Distrik' : 'Kecamatan'} ${w.name}`;
  if (w.level === 4) return `${w.type === 'kelurahan' ? 'Kelurahan' : 'Desa'} ${w.name}`;
  return w.name;
}
/** A label in front of the address: "Alamat:", "Domisili -". */
const LABEL = /^\s*(?:alamat(?:\s+(?:lengkap|rumah|domisili|pengiriman|kantor))?|domisili|address|tempat\s+tinggal)\s*[:=-]\s*/i;
const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;.-]+|[\s,;-]+$/g, '')
    .trim();

/** The street part of the text: without the label, RT/RW, and kode pos read from it. */
function streetText(part: string, read: Range[]): string {
  let s = part;
  for (const [a, b] of [...read].sort((x, y) => y[0] - x[0])) if (a < s.length) s = s.slice(0, a) + s.slice(b);
  return clean(s.replace(LABEL, '').replace(/\s*([,;])(?:\s*[,;/])+/g, '$1 ').replace(/\s*\/\s*$/, ''));
}

/**
 * Reads a free-text Indonesian address into its parts and Kemendagri regions. Works with commas or without, with
 * abbreviations ("Kel.", "Kec.", "Kab.", "Jaksel", "Jabar"), and with levels left out: the missing ones come from the
 * region's code and are listed in `inferred`. Check `confidence` and `issues` before trusting the result.
 */
export function parseAlamat(address: string): ParsedAlamat {
  const text = String(address).slice(0, 2000);
  const result: ParsedAlamat = { inferred: [], confidence: 'none', issues: [], alternatives: [] };
  const skip: Range[] = [];
  /** RT/RW and the kode pos: left out of the street. */
  const read: Range[] = [];

  const streets = streetRanges(text);
  if (streets.length) {
    result.street = streets.map(([a, b]) => clean(text.slice(a, b))).filter(Boolean).join(', ') || undefined;
    skip.push(...streets);
  }
  for (const m of [...text.matchAll(PLUS_CODE), ...text.matchAll(POSTAL_LABEL)]) {
    skip.push([m.index, m.index + m[0].length]);
    read.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(RT_RW)) {
    if (m[1] && result.rt === undefined) result.rt = pad3(m[1]);
    const rw = m[2] ?? m[3];
    if (rw && result.rw === undefined) result.rw = pad3(rw);
    skip.push([m.index, m.index + m[0].length]);
    read.push([m.index, m.index + m[0].length]);
  }
  const postals = [...text.matchAll(POSTAL)].filter((m) => !skip.some(([a, b]) => m.index >= a && m.index < b));
  const postal = postals[postals.length - 1];
  if (postal) {
    result.postalCode = postal[0];
    skip.push([postal.index, postal.index + 5]);
    read.push([postal.index, postal.index + 5]);
  }
  // House numbers outside a street ("No. 12, Beji") are not region names either.
  for (const m of text.matchAll(new RegExp(HOUSE_NUMBER.source, 'gi'))) skip.push([m.index, m.index + m[0].length]);

  const postalVillages = result.postalCode ? villagesWithPostalCode(result.postalCode) : undefined;
  if (result.postalCode && !postalVillages?.length) result.issues.push(`Kode pos ${result.postalCode} tidak terdaftar.`);

  const words = tokens(text, skip);
  const { hits, marked } = findHits(words);
  const postalList = postalVillages?.length ? postalVillages : undefined;
  const found = chains([...hits, ...typoHits(words, hits, postalList)], postalList);
  let best = found[0];
  let fromPostal = false;
  if (!best && postalVillages?.length) {
    // No region named: what the kode pos alone tells, down to the level all its villages share.
    const shared = commonPrefix(postalVillages);
    if (shared) {
      const level = levelOf(shared);
      best = { node: { code: shared, level, from: 0, to: 0, text: '', hinted: false, unique: false, distinctive: false }, used: new Map(), score: 0, postalAgrees: true, ignoresMarked: false };
      fromPostal = true;
    }
  }
  if (!best) {
    for (const m of marked) result.issues.push(`${LEVEL_WORD[m.level]} ${title(m.text)} tidak ditemukan di data Kemendagri.`);
    // No region to end the street at: all of it is the street ("Jalan Kota Baru").
    if (result.street && !marked.length) result.street = streetText(text, read) || result.street;
    result.formatted = format(result);
    return result;
  }

  // Everything before the first region named is the street part: "Kp. Rawa Badak", "Rumah kuning dekat masjid".
  if (best.used.size) {
    let first = Math.min(...[...best.used.values()].map((h) => h.from));
    while (first > 0 && !words[first]!.breakBefore && (HINTS[words[first - 1]!.word] || FILLER.has(words[first - 1]!.word))) first--;
    const street = streetText(text.slice(0, words[first]!.start), read);
    if (street) result.street = street;
  }

  let code = best.node.code;
  // A kecamatan or kota named in the text, and a kode pos used inside it by one kelurahan only (or by several in one
  // kecamatan): that kelurahan (or kecamatan).
  if (best.node.level <= 3 && best.postalAgrees && postalVillages) {
    const inside = postalVillages.filter((v) => v.startsWith(`${code}.`));
    if (inside.length) code = commonPrefix(inside);
  }
  const parts = code.split('.');
  for (let level = 1; level <= parts.length; level++) {
    const key = LEVEL_KEYS[level - 1]!;
    result[key] = getWilayah(parts.slice(0, level).join('.'));
    if (!best.used.has(level as WilayahLevel)) result.inferred.push(key);
  }
  result.code = code;

  // Other readings: different regions that scored nearly as well. A reading with a typo only competes with another one.
  const withTypo = (c: Chain) => [...c.used.values()].some((h) => h.fuzzy);
  const rivals = withTypo(best) ? found : found.filter((c) => !withTypo(c));
  const seen = new Set([code]);
  for (const c of rivals) {
    if (c === best) continue;
    if (c.score < best.score - 2 || result.alternatives.length >= 3) break;
    if (seen.has(c.node.code) || related(code, c.node.code)) continue;
    seen.add(c.node.code);
    result.alternatives.push(getWilayah(c.node.code)!);
  }
  const next = rivals.find((c) => c !== best);
  const ambiguous = !!next && next.score === best.score && !related(code, next.node.code);

  const village = result.kelurahanDesa;
  if (result.postalCode && postalVillages?.length && !best.postalAgrees) {
    const expected = village?.postalCode ?? undefined;
    const where = village ?? result.kecamatan ?? result.kabupatenKota ?? result.provinsi;
    result.issues.push(
      expected
        ? `Kode pos ${result.postalCode} bukan milik ${label(village!)} (kode posnya ${expected}).`
        : `Kode pos ${result.postalCode} tidak berada di ${label(where!)}.`,
    );
  }
  if (ambiguous) result.issues.push('Alamat ini cocok dengan lebih dari satu wilayah; lihat alternatives.');
  const deepest = result.kelurahanDesa ?? result.kecamatan ?? result.kabupatenKota ?? result.provinsi;
  for (const m of marked) {
    if (best.used.has(m.level) || m.level <= best.node.level) continue;
    result.issues.push(`${LEVEL_WORD[m.level]} ${title(m.text)} tidak ditemukan di ${label(deepest!)} menurut data Kemendagri.`);
  }

  // Names read with a typo: say what they were taken for.
  const typos = [...best.used.values()].filter((h) => h.fuzzy);
  for (const h of typos) {
    const written = text.slice(words[h.from]!.start, words[h.to - 1]!.end);
    result.issues.push(`"${written}" dibaca sebagai ${label(getWilayah(h.code)!)}.`);
  }

  const named = (level: WilayahLevel) => best.used.has(level);
  // Another region nearly as likely ("Kemiri, Purworejo": the kecamatan, or the desa of that name elsewhere in it), or
  // a kelurahan nearly as likely if a name has a typo ("Kedunsari, Klirong": Kedungsari, not the desa Klirong).
  const contested = found.some(
    (c) =>
      c !== best &&
      !related(code, c.node.code) &&
      (withTypo(c) ? c.node.level === 4 && c.score >= best.score - 1 : c.score >= best.score - 3),
  );
  if (fromPostal || ambiguous) result.confidence = 'low';
  else if (village && named(4) && (named(3) || named(2)) && (best.postalAgrees || !result.postalCode) && !contested && !best.ignoresMarked && !typos.length) {
    result.confidence = 'high';
  }
  else if (best.used.size > 1 || best.postalAgrees || (best.node.hinted && best.node.unique) || best.node.level <= 2 || best.node.distinctive) result.confidence = 'medium';
  else result.confidence = 'low';

  result.formatted = format(result);
  return result;
}

function format(r: ParsedAlamat): string | undefined {
  const parts: string[] = [];
  if (r.street) parts.push(r.street);
  if (r.rt || r.rw) parts.push([r.rt && `RT ${r.rt}`, r.rw && `RW ${r.rw}`].filter(Boolean).join('/'));
  if (r.kelurahanDesa) parts.push(label(r.kelurahanDesa));
  if (r.kecamatan) parts.push(label(r.kecamatan));
  if (r.kabupatenKota) parts.push(r.kabupatenKota.name);
  if (r.provinsi) parts.push(r.provinsi.name);
  const postal = r.postalCode ?? r.kelurahanDesa?.postalCode;
  if (!parts.length && !postal) return undefined;
  return postal ? `${parts.join(', ')} ${postal}`.trim() : parts.join(', ');
}
