export interface FormatRupiahOptions {
  /** Show sen as ",00". Rupiah is almost always shown without sen. */
  decimals?: boolean;
  /** Prefix with "Rp". Default true. */
  symbol?: boolean;
}

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 1500000 → "Rp1.500.000" (PUEBI style: no space, dot thousands, comma decimals). */
export function formatRupiah(amount: number, options: FormatRupiahOptions = {}): string {
  if (!Number.isFinite(amount)) throw new RangeError('amount must be a finite number');
  const { decimals = false, symbol = true } = options;
  const abs = Math.abs(amount);
  const fixed = decimals ? abs.toFixed(2) : Math.round(abs).toString();
  const [int = '0', frac] = fixed.split('.');
  const body = groupThousands(int) + (frac ? `,${frac}` : '');
  const sign = amount < 0 && Number(fixed) !== 0 ? '-' : '';
  return `${sign}${symbol ? 'Rp' : ''}${body}`;
}

const SHORT_UNITS: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'M'],
  [1e6, 'jt'],
  [1e3, 'rb'],
];

/** 1500000 → "Rp1,5 jt", 2300000000 → "Rp2,3 M". */
export function formatRupiahShort(amount: number): string {
  if (!Number.isFinite(amount)) throw new RangeError('amount must be a finite number');
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  for (const [size, unit] of SHORT_UNITS) {
    if (abs >= size) {
      const value = Math.round((abs / size) * 10) / 10;
      return `${sign}Rp${value.toString().replace('.', ',')} ${unit}`;
    }
  }
  return `${sign}Rp${Math.round(abs)}`;
}

export interface ParsedRupiah {
  amount: number;
  /** True for "2jtan", "50rb-an", "sekitar 1 juta", "2 juta lebih". */
  approximate: boolean;
}

const DIGIT_WORDS: Record<string, number> = {
  nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9,
};
const SCALES: Record<string, number> = {
  ribu: 1e3, rb: 1e3, rbu: 1e3, rebu: 1e3, k: 1e3, ceng: 1e3,
  juta: 1e6, jt: 1e6, jeti: 1e6,
  miliar: 1e9, milyar: 1e9, m: 1e9,
  triliun: 1e12, t: 1e12,
};
const SE_SCALES: Record<string, number> = { seribu: 1e3, sejuta: 1e6, semiliar: 1e9, semilyar: 1e9, setriliun: 1e12 };
/** Jakarta slang (from Hokkien) for amounts that behave like plain numbers. */
const SLANG_NUMBERS: Record<string, number> = { jigo: 25, gocap: 50, cepek: 100, gopek: 500 };
/** Slang for complete amounts; a number before them multiplies ("2 ceban" = 20.000). */
const SLANG_AMOUNTS: Record<string, number> = {
  seceng: 1e3, noceng: 2e3, goceng: 5e3, ceban: 1e4, noban: 2e4, goban: 5e4,
  cetiao: 1e6, cetiau: 1e6, cetiaw: 1e6,
};
const FILLERS = new Set([
  'rp', 'idr', 'rupiah', 'aja', 'saja', 'doang', 'sih', 'deh', 'kak', 'cuma', 'hanya', 'harga', 'harganya',
  'total', 'totalnya', 'senilai', 'sebesar', 'dong', 'ya', 'yah',
]);
const APPROX_WORDS = new Set(['sekitar', 'kira', 'kurang', 'lebih', 'kisaran', 'kurleb', 'an', 'ish', 'an-an']);

function isNumberToken(tok: string): boolean {
  return /^\d+(?:[.,]\d+)*$/.test(tok);
}

/** Reads "1.500.000", "1,5", "1.5", "1,500,000" with Indonesian conventions first. */
function parseNumberToken(tok: string, hasUnit: boolean): number {
  const dots = (tok.match(/\./g) ?? []).length;
  const commas = (tok.match(/,/g) ?? []).length;
  let normalized: string;
  if (dots && commas) {
    const decimalSep = tok.lastIndexOf(',') > tok.lastIndexOf('.') ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    normalized = tok.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (dots + commas > 1) {
    normalized = tok.replace(/[.,]/g, '');
  } else if (dots + commas === 1) {
    const [, after = ''] = tok.split(/[.,]/);
    const sep = dots ? '.' : ',';
    // "1.500" is fifteen hundred; "1.5jt", "1,5jt" and "1,5" are decimals.
    const isThousands = after.length === 3 && (!hasUnit || sep === '.');
    normalized = isThousands ? tok.replace(sep, '') : tok.replace(sep, '.');
  } else {
    normalized = tok;
  }
  return Number(normalized);
}

function stripApproxSuffix(tok: string): { tok: string; approx: boolean } {
  const m = /^(.+?)-?an$/.exec(tok);
  if (m) {
    const stem = m[1]!;
    if (
      stem in SCALES || stem in SE_SCALES || stem in SLANG_AMOUNTS || stem in SLANG_NUMBERS || isNumberToken(stem)
    ) {
      return { tok: stem, approx: true };
    }
  }
  return { tok, approx: false };
}

/**
 * Parses how Indonesians actually write money:
 * "Rp 25.000", "1,5jt", "2jtan", "50rb-an", "goceng", "2 ceban", "sejuta setengah",
 * "dua ratus lima puluh ribu", "1jt 500rb". Returns null when the text is not an amount.
 *
 * "m" is read as miliar (Indonesian usage), not million.
 */
export function parseRupiah(text: string): ParsedRupiah | null {
  let t = String(text).toLowerCase().trim();
  if (!t) return null;
  t = t
    .replace(/[~±]/g, ' sekitar ')
    .replace(/\brp\.?/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2');

  const rawTokens = t.split(/[\s\-/]+/).filter(Boolean);
  let approximate = false;
  const tokens: string[] = [];
  for (const raw of rawTokens) {
    const cleaned = raw.replace(/^[^\w]+|[^\w]+$/g, '');
    if (!cleaned) continue;
    const { tok, approx } = stripApproxSuffix(cleaned);
    if (approx) approximate = true;
    tokens.push(tok);
  }

  let total = 0;
  let current = 0;
  let lastDigit = 0;
  let lastScale = 0;
  let sawValue = false;

  const isScaleToken = (tok: string | undefined) =>
    tok !== undefined && (tok in SCALES || tok in SE_SCALES);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const next = tokens[i + 1];

    if (isNumberToken(tok)) {
      const n = parseNumberToken(tok, isScaleToken(next) || (next !== undefined && next in SLANG_AMOUNTS));
      if (!Number.isFinite(n)) return null;
      current += n;
      lastDigit = n;
      sawValue = true;
    } else if (tok in DIGIT_WORDS) {
      const n = DIGIT_WORDS[tok]!;
      current += n;
      lastDigit = n;
      sawValue = true;
    } else if (tok === 'sepuluh' || tok === 'sebelas' || tok === 'seratus') {
      current += tok === 'sepuluh' ? 10 : tok === 'sebelas' ? 11 : 100;
      lastDigit = 0;
      sawValue = true;
    } else if (tok === 'belas') {
      current += 10;
      lastDigit = 0;
    } else if (tok === 'puluh' || tok === 'ratus') {
      const mult = tok === 'puluh' ? 10 : 100;
      current = current - lastDigit + (lastDigit || 1) * mult;
      lastDigit = 0;
      sawValue = true;
    } else if (tok in SE_SCALES) {
      const scale = SE_SCALES[tok]!;
      total += (current + 1) * scale;
      current = 0;
      lastDigit = 0;
      lastScale = scale;
      sawValue = true;
    } else if (tok in SCALES) {
      if (!sawValue) return null;
      const scale = SCALES[tok]!;
      total += (current || 1) * scale;
      current = 0;
      lastDigit = 0;
      lastScale = scale;
    } else if (tok in SLANG_NUMBERS) {
      current += SLANG_NUMBERS[tok]!;
      lastDigit = 0;
      sawValue = true;
    } else if (tok in SLANG_AMOUNTS) {
      total += (current || 1) * SLANG_AMOUNTS[tok]!;
      current = 0;
      lastDigit = 0;
      lastScale = 0;
      sawValue = true;
    } else if (tok === 'setengah') {
      if (isScaleToken(next)) {
        // "setengah juta", "dua setengah juta"
        current += 0.5;
      } else if (lastScale) {
        // "sejuta setengah"
        total += lastScale * 0.5;
      } else {
        current += 0.5;
      }
      sawValue = true;
    } else if (APPROX_WORDS.has(tok)) {
      approximate = true;
    } else if (FILLERS.has(tok)) {
      continue;
    } else {
      return null;
    }
  }

  if (!sawValue) return null;
  return { amount: Math.round((total + current) * 100) / 100, approximate };
}
