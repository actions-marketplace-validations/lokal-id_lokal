/**
 * What an NER model's person spans must pass to count as names: the filters of `lokal.samaran.ner` in Python, for
 * `@lokal-id/ner`, which runs the model. Kept here, without the model, so both languages share one set of rules and
 * one set of test vectors.
 *
 *   import { nerChunks, namesFromSpans } from '@lokal-id/core/ner';
 *   // the model reads each chunk; its person spans, with offsets into `text`, become NAME matches
 *   const names = namesFromSpans(text, spans);
 */

import { districtNames } from './wilayah.ts';
import { NOT_NAME, TITLE_WORDS } from './samaran/detectors.ts';
import { fieldType } from './samaran/fields.ts';
import type { PiiMatch } from './samaran/types.ts';

// Chat words, slang, and forms of address the model takes for names, most of all in lower-case chat.
const CHAT = new Set([
  'kak', 'bu', 'pak', 'gan', 'sis', 'bro', 'min', 'mas', 'mbak', 'bang', 'dek', 'om', 'tante', 'hi', 'halo', 'hai',
  'sih', 'maka', 'ret',
  // greetings, calls, and fillers
  'woy', 'woi', 'oi', 'oy', 'hei', 'hey', 'hallo', 'helo', 'cuy', 'coy', 'bestie', 'beb', 'say', 'sayang', 'bos',
  'boss', 'bund', 'bunda', 'ayah', 'mama', 'papa', 'mamah', 'papah', 'nak', 'dik', 'kang', 'teh', 'neng', 'akang',
  'uda', 'uni', 'abang', 'kakak', 'adek', 'mba', 'mbok', 'pakde', 'bude', 'paklik', 'bulik', 'cak', 'ko',
  'cik', 'ci', 'koh', 'ncek', 'engkoh', 'gais', 'guys', 'gaes', 'gengs', 'bray', 'brader', 'bruh', 'sob',
  'wkwk', 'wkwkwk', 'haha', 'hahaha', 'hehe', 'hihi', 'xixi', 'awokwok', 'anjir', 'anjay', 'anjim', 'buset',
  'astaga', 'astagfirullah', 'alhamdulillah', 'insyaallah', 'masyaallah', 'aamiin', 'amin', 'yaudah', 'yaudahlah',
  'mantap', 'mantul', 'sip', 'siap', 'oke', 'okey', 'okay', 'ok', 'gas', 'gaskeun', 'santuy', 'santai', 'mager',
  // abbreviations
  'otw', 'btw', 'gpp', 'gapapa', 'gak', 'ga', 'nggak', 'enggak', 'kagak', 'gk', 'tdk', 'blm', 'udh', 'udah', 'sdh',
  'yg', 'dgn', 'utk', 'krn', 'tp', 'tpi', 'sm', 'td', 'tadi', 'skrg', 'gmn', 'gimana', 'knp', 'kenapa', 'emg',
  'emang', 'bgt', 'banget', 'aja', 'doang', 'kuy', 'yuk', 'cmiiw', 'imho', 'fyi', 'asap', 'thx', 'tq', 'makasih',
  'trims', 'mksh', 'pls', 'plis', 'tolong', 'maaf', 'sorry', 'sori', 'dong', 'deh', 'kok', 'kan', 'lho', 'loh',
  'nih', 'tuh', 'gitu', 'gini', 'gue', 'gua', 'gw', 'lu', 'lo', 'elu', 'elo', 'aku', 'kamu', 'kau', 'dia', 'ane',
  'ente', 'saya', 'kita', 'kami', 'mereka', 'anda', 'admin', 'kurir', 'driver', 'cs', 'ka', 'kk',
]);
// Everyday verbs of chat, informal and plain, that the model takes for names in lower case ("nelpon", "nungguin").
const INFORMAL = new Set([
  'nelpon', 'nelfon', 'telpon', 'telepon', 'telponan', 'nanya', 'nanyain', 'nyari', 'nyariin', 'nyampe', 'nyusul',
  'nyuruh', 'nyetir', 'nunggu', 'nungguin', 'nemenin', 'nganter', 'nganterin', 'ngabarin', 'ngajak', 'ngasih',
  'ngirim', 'ngomong', 'ngobrol', 'ngopi', 'ngantor', 'ngecek', 'nitip', 'titip', 'balikin', 'kabarin', 'beliin',
  'bilangin', 'jemput', 'jemputin', 'nebeng', 'mampir', 'nongkrong', 'bales', 'balas', 'bilang', 'dateng', 'datang',
  'pulang', 'pergi', 'makan', 'minum', 'tidur', 'mandi', 'kerja', 'belajar', 'main', 'liat', 'lihat', 'denger',
  'ketemu', 'ketemuan', 'chat', 'chatting', 'japri', 'dm', 'wa', 'transfer', 'tf', 'bayar', 'kirim', 'kasih',
  'tanya', 'hubungi', 'telat', 'izin', 'cuti', 'sakit', 'resign', 'lembur', 'piket', 'rapat', 'meeting',
]);
// Common English words, which mixed Indonesian and English text puts next to names ("Rina Pratama, born 9 Agustus").
// A name written in lower case must not be one; a capitalized one ("Grace", "Joy") may.
const ENGLISH = new Set(
  `a about above after again against age all also am an and any are as at be because been before being below between
both but by can could did do does doing down during each few for from further had has have having he her here hers
herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once
only or other our ours out over own same she should so some such than that the their theirs them then there these
they this those through to too under until up very was we were what when where which while who whom why will with
would you your yours yourself born died dead age aged birth birthday married single divorced widow widowed male female
gender sex religion occupation job status account user customer client patient guest member employee staff manager
admin owner holder name names full first last middle nickname address phone email mobile number id card passport
date day today tomorrow yesterday later soon now morning night please thanks thank sorry hello hi hey dear regards
sir madam mr mrs ms miss check call send sent reply replied ask asked told tell said say says meeting report invoice
order payment refund ticket issue problem help support team project task update done pending approved rejected
new old good great nice okay fine yes yeah nope maybe sure ready free busy online offline home office work
suffer suffers suffering suffered diagnosed treated admitted discharged visited lives lived living works worked
working stays stayed moved arrived left needs needed wants wanted`.split(/\s+/),
);
// Informal verbs by their form: "nge-" ("ngeliat", "ngerjain") and the passive "di-…-in" ("dibeliin"). Not "ng-" or
// "ny-" alone, nor "-in" alone: Ngurah, Nyoman, Ngadiman, Arifin, and Syamsudin are names.
const INFORMAL_VERB = /^nge[a-z]{3,}$|^di[a-z]{3,}in$/;
// A letter repeated at the end of a chat word ("kakk", "makasihh").
const STRETCHED = /([a-z])\1+$/;
/** The score a name written without capitals needs: the model reads lower case, but a capital letter is evidence too. */
export const LOWER_MIN_SCORE = 0.7;
// Police and military ranks, which news puts before a name ("Kombes Pol. …", "AKBP …").
const RANKS = new Set([
  'kombes', 'pol', 'akbp', 'akp', 'kompol', 'iptu', 'ipda', 'aipda', 'aiptu', 'bripka', 'brigadir', 'briptu',
  'bripda',
  'brigjen', 'irjen', 'komjen', 'jenderal', 'mayjen', 'letjen', 'marsekal', 'laksamana', 'kolonel', 'letkol', 'mayor',
  'kapten', 'lettu', 'letda', 'serma', 'serka', 'kopda', 'prada', 'tni', 'polri',
]);
// Log levels: "[10:02] WARN login check …" opens a log line, not a name.
const LOG_LEVELS = new Set(['warn', 'warning', 'error', 'err', 'info', 'debug', 'trace', 'fatal', 'notice', 'critical']);
// Words in front of a name that are left out of it: ranks, titles, and forms of address ("mama rina", "ci lina").
const LEADING = new Set([...RANKS, ...TITLE_WORDS, ...CHAT]);
const REGION_PREFIX = /^(?:kabupaten|kota|kab\.?|provinsi)\s+/;
const CHUNK = 600;
// Whitespace as Python's str.split() and re's \s see it, so both languages cut text the same way: JavaScript's \s
// also takes a byte order mark (U+FEFF), and leaves out U+001C to U+001F and U+0085.
const WS = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const SPACES = new RegExp(`${WS}+`);
const EDGE_SPACES = new RegExp(`^${WS}+|${WS}+$`, 'g');
const HEAD = new RegExp(`^[A-Za-z]+\\.?${WS}+`);
const SENTENCE_START = new RegExp(`(?<=[.!?])${WS}+(?=["“A-Z])`, 'g');
const pyStrip = (s: string) => s.replace(EDGE_SPACES, '');
let places: Set<string> | undefined;

/** Names of provinces, regencies, cities, and districts: "Pati" in a sentence is a place, not a person. */
function placeNames(): Set<string> {
  return (places ??= new Set(districtNames().map((n) => n.toLowerCase().replace(REGION_PREFIX, '').trim())));
}

const isLetter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);
const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isUpperLetter = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();
// Python's str.isupper(): some cased letter, and none in lower case.
const isAllUpper = (s: string) => s !== s.toLowerCase() && s === s.toUpperCase();
const stripChars = (s: string, chars: string) => {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a]!)) a++;
  while (b > a && chars.includes(s[b - 1]!)) b--;
  return s.slice(a, b);
};

/** Whether the value is written as a name: every word capitalized (in capitals too, as on an ID card). */
function cased(value: string): boolean {
  const words = value.split(SPACES).filter((w) => isLetter(w[0]));
  return words.length > 0 && words.every((w) => isUpperLetter(w[0]!));
}

/**
 * Whether a person span from the model is kept: what the filters, tuned on the dev split, let through.
 *
 * The model reads lower case (its tokenizer lowercases everything), so a name in chat ("sama rianto surya") gets the
 * same score as a capitalized one. A name not written with capitals must score `minLowerScore`, as it has no capital
 * letter to back it, and must not be a chat word or an informal verb.
 */
export function keepName(value: string, score: number, minScore = 0.7, minLowerScore = LOWER_MIN_SCORE): boolean {
  value = stripChars(value, ' .,:;\'"()');
  const words = value.split(SPACES).filter(Boolean);
  if (score < minScore || !words.length || value.replace(/[^A-Za-z]/g, '').length < 3) return false;
  if (!cased(value) && score < minLowerScore) return false;
  // "NIK", "SD"; but a name the model is sure of may be initials, as news writes public figures ("SBY").
  if (words.length === 1 && isAllUpper(value) && value.length <= 4 && score < 0.9) return false;
  const low = words.map((w) => stripChars(w.toLowerCase(), '.,'));
  // A chat word or verb is not a name in any case: at the start of a sentence ("Nitip ya") or in capitals too.
  const plain = low.map((w) => w.replace(STRETCHED, '$1'));
  const all = [...low, ...plain];
  if (all.some((w) => INFORMAL.has(w))) return false;
  // By form only in lower case: "Ngesti" is a name.
  if (!cased(value) && low.some((w) => INFORMAL_VERB.test(w) || ENGLISH.has(w))) return false;
  if (all.some((w) => NOT_NAME.has(w) || TITLE_WORDS.has(w) || CHAT.has(w) || RANKS.has(w) || LOG_LEVELS.has(w))) {
    return false;
  }
  if (fieldType(low.join('_')) !== undefined) return false; // a column name
  return !placeNames().has(low.join(' '));
}

/**
 * Whether a lower-case word sits in a sentence, not in a CSV header, a `key=value`, or a JSON key, where a lower-case
 * word is a field name ("nopol,pemilik", "retry=1").
 */
function inProse(text: string, start: number, end: number): boolean {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const line = text.slice(lineStart, lineEnd >= 0 ? lineEnd : text.length);
  const after = text.slice(end, end + 2).replace(/^ +/, '');
  const before = text.slice(Math.max(0, start - 2), start).replace(/ +$/, '');
  if ('="_@'.includes(after[0] ?? '-') || '="_./@'.includes(before[before.length - 1] ?? '-')) return false;
  if (after[0] === '.' && isAlnum(after[1])) return false; // "budi.susanto@…"
  return (line.match(/\p{L}{2,}/gu) ?? []).length >= 3 && pyStrip(line).includes(' ');
}

/**
 * Where the model reads: each line, and a long line in pieces of about 600 characters cut at sentence ends, as
 * [start, end) offsets into `text`. The model finds names best in a short passage: in a long one it starts to miss
 * names it finds when they stand alone.
 */
export function nerChunks(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const line of text.matchAll(/[^\n]+/g)) {
    if (!pyStrip(line[0])) continue;
    let start = line.index;
    const end = start + line[0].length;
    let prev = start;
    for (const m of line[0].matchAll(SENTENCE_START)) {
      const at = line.index + m.index;
      if (at - start > CHUNK && prev > start) {
        out.push([start, prev]);
        start = prev;
      }
      prev = at + m[0].length;
    }
    if (end - start > CHUNK && prev > start) {
      out.push([start, prev]);
      start = prev;
    }
    out.push([start, end]);
  }
  return out;
}

/** A person span from the model: offsets into the whole text, and its score (the mean of its tokens' scores). */
export interface NerSpan {
  start: number;
  end: number;
  score: number;
}

/** The model's person spans, as NAME matches: widened to whole words, without a leading title, and filtered. */
export function namesFromSpans(text: string, spans: readonly NerSpan[], minScore = 0.7): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const span of spans) {
    let { start, end } = span;
    // The model's span can carry spaces or punctuation at its edges.
    while (start < end && !isAlnum(text[start])) start++;
    while (end > start && !isAlnum(text[end - 1]) && text[end - 1] !== '.') end--;
    // It works on word pieces and can stop inside a word ("Gib" of a name): the whole word is the name.
    while (start > 0 && isLetter(text[start - 1])) start--;
    while (end < text.length && (isLetter(text[end]) || ("'’".includes(text[end]!) && isLetter(text[end + 1])))) end++;
    // A rank, title, or form of address in front stays: "Kombes Pol. Ronni" masks the name, not the rank.
    for (;;) {
      const head = HEAD.exec(text.slice(start, end));
      if (!head || !LEADING.has(pyStrip(head[0]).replace(/\.$/, '').toLowerCase())) break;
      start += head[0].length;
    }
    const value = text.slice(start, end);
    // A lower-case name counts in a sentence only: in a CSV header or a key=value it is a field name.
    const inPlace = cased(value) || inProse(text, start, end);
    if (inPlace && keepName(value, span.score, minScore)) {
      out.push({ type: 'NAME', start, end, value, confidence: 'medium' });
    }
  }
  return out;
}
