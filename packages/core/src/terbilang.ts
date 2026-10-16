const ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
const SCALES = ['', 'ribu', 'juta', 'miliar', 'triliun', 'kuadriliun', 'kuintiliun'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 1) parts.push('seratus');
  else if (hundreds > 1) parts.push(`${ONES[hundreds]} ratus`);

  if (rest === 10) parts.push('sepuluh');
  else if (rest === 11) parts.push('sebelas');
  else if (rest > 11 && rest < 20) parts.push(`${ONES[rest - 10]} belas`);
  else if (rest >= 20) {
    parts.push(`${ONES[Math.floor(rest / 10)]} puluh`);
    if (rest % 10) parts.push(ONES[rest % 10]!);
  } else if (rest > 0) parts.push(ONES[rest]!);

  return parts.join(' ');
}

function integerWords(value: bigint): string {
  if (value === 0n) return 'nol';
  const groups: number[] = [];
  let v = value;
  while (v > 0n) {
    groups.push(Number(v % 1000n));
    v /= 1000n;
  }
  if (groups.length > SCALES.length) throw new RangeError('Angka terlalu besar untuk terbilang.');

  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g === 0) continue;
    if (i === 1 && g === 1) words.push('seribu');
    else words.push([belowThousand(g), SCALES[i]].filter(Boolean).join(' '));
  }
  return words.join(' ');
}

export interface TerbilangOptions {
  /** Append "rupiah". */
  currency?: boolean;
  /** "lower" (default), "sentence", or "title" — kuitansi usually use title case. */
  case?: 'lower' | 'sentence' | 'title';
}

/**
 * Spells a number in Indonesian, for kuitansi, invoices, and cek.
 * terbilang(1500000, { currency: true }) → "satu juta lima ratus ribu rupiah"
 */
export function terbilang(value: number | bigint, options: TerbilangOptions = {}): string {
  let text: string;
  if (typeof value === 'bigint') {
    text = (value < 0n ? 'minus ' : '') + integerWords(value < 0n ? -value : value);
  } else {
    if (!Number.isFinite(value)) throw new RangeError('value must be a finite number');
    const abs = Math.abs(value);
    if (!Number.isSafeInteger(Math.trunc(abs))) throw new RangeError('Gunakan bigint untuk angka sebesar ini.');
    const [intPart = '0', fracPart] = abs.toString().split('.');
    text = (value < 0 ? 'minus ' : '') + integerWords(BigInt(intPart));
    if (fracPart) {
      text += ` koma ${[...fracPart].map((d) => (d === '0' ? 'nol' : ONES[Number(d)])).join(' ')}`;
    }
  }

  if (options.currency) text += ' rupiah';
  if (options.case === 'sentence') text = text.charAt(0).toUpperCase() + text.slice(1);
  if (options.case === 'title') text = text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}
