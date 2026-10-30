import { parsePhone } from '../phone.ts';
import { checkCustomRules, type CustomRule } from './custom.ts';
import { detectPii, type DetectOptions } from './detectors.ts';
import { PII_TYPES, SCAN_STATUSES, UU_PDP_CATEGORY, type Confidence, type PiiMatch, type PiiType, type ScanStatus } from './types.ts';

export { detectPii, PII_TYPES, SCAN_STATUSES, UU_PDP_CATEGORY, type Confidence, type DetectOptions, type PiiMatch, type PiiType, type ScanStatus };
export { fieldType } from './fields.ts';
export { checkCustomRules, type CustomRule };

export interface MaskedMatch extends PiiMatch {
  /** What replaced the value: "[NIK_1]" in placeholder mode, "3201********0001" in partial mode. */
  replacement: string;
}

export interface MaskResult {
  text: string;
  matches: MaskedMatch[];
}

export interface SamaranOptions extends DetectOptions {
  /**
   * - `placeholder` (default): reversible tokens like [NIK_1], for text sent to an LLM.
   * - `partial`: human-readable masks like 0812****7890, for logs and admin screens. Not reversible.
   */
  mode?: 'placeholder' | 'partial';
  /** Values that are never masked, e.g. your own support hotline. */
  allow?: Array<string | RegExp>;
}

/** Same person, same placeholder: "0812-3456-7890" and "+62 812 3456 7890" both map to [PHONE_1]. */
export function canonical(type: PiiType, value: string): string {
  switch (type) {
    case 'PHONE':
      return parsePhone(value).e164 ?? value.replace(/\D/g, '');
    case 'EMAIL':
      return value.toLowerCase();
    case 'PLATE':
    case 'PASSPORT':
    case 'AKTA':
      return value.toUpperCase().replace(/\s+/g, '');
    case 'NIK':
    case 'KK':
    case 'NPWP':
    case 'SIM':
    case 'NIP':
    case 'BPJS':
    case 'NISN':
    case 'BANK_ACCOUNT':
    case 'CARD':
      return value.replace(/\D/g, '');
    default:
      return value.toLowerCase().replace(/\s+/g, ' ').trim();
  }
}

/** Keeps just enough to recognise the value: 3201********0001, 0812****7890, b***@gmail.com. */
export function partialMask(type: PiiType, value: string): string {
  const stars = (n: number) => '*'.repeat(Math.max(n, 3));
  const digits = value.replace(/\D/g, '');
  switch (type) {
    case 'NIK':
    case 'KK':
      return `${digits.slice(0, 4)}${stars(8)}${digits.slice(-4)}`;
    case 'NIP':
    case 'SIM':
    case 'NISN':
    case 'AKTA':
      return `${stars(digits.length - 3)}${digits.slice(-3)}`;
    case 'PASSPORT':
      return `${[...value][0] ?? ''}${stars(5)}${value.slice(-2)}`;
    case 'IP': {
      const [a, b] = value.split('.');
      return `${a}.${b}.*.*`;
    }
    case 'GEO':
      return value.replace(/(\.\d)\d+/g, '$1***');
    case 'BIRTH_DATE':
    case 'GENDER':
    case 'RELIGION':
    case 'MARITAL_STATUS':
    case 'NATIONALITY':
    case 'HEALTH':
    case 'FINANCIAL':
    case 'CRIMINAL_RECORD':
    case 'BIOMETRIC':
      return stars(3);
    case 'PHONE': {
      const national = parsePhone(value).e164?.replace('+62', '0') ?? digits;
      return `${national.slice(0, 4)}${stars(national.length - 8)}${national.slice(-4)}`;
    }
    case 'EMAIL': {
      const [user = '', domain = ''] = value.split('@');
      return `${[...user][0] ?? ''}${stars(3)}@${domain}`;
    }
    case 'CARD':
    case 'BANK_ACCOUNT':
    case 'BPJS':
    case 'NPWP':
      return `${stars(digits.length - 4)}${digits.slice(-4)}`;
    case 'PLATE': {
      const [region = ''] = value.split(/[\s\d]/);
      return `${region} ${stars(4)}`;
    }
    case 'NAME':
      return value
        .split(/\s+/)
        .map((w) => `${[...w][0] ?? ''}${stars(3)}`)
        .join(' ');
    case 'ADDRESS':
      return `${value.split(/\s+/)[0]} ${stars(3)}`;
    case 'CUSTOM':
      return `${stars(value.length - 2)}${value.length > 6 ? value.slice(-2) : ''}`;
  }
}

const PLACEHOLDER = /\[([A-Z_]+_\d+)\]/g;

/**
 * Masks Indonesian personal data before text leaves your server, and restores it afterwards.
 *
 *   const samaran = new Samaran();
 *   const { text } = samaran.mask('NIK saya 3201011508950001, HP 0812-3456-7890');
 *   // → 'NIK saya [NIK_1], HP [PHONE_1]'
 *   const reply = await llm(text);
 *   samaran.unmask(reply);
 *
 * One instance keeps one vault: use one per conversation or request, not one global.
 */
export class Samaran {
  readonly options: SamaranOptions;
  private byCanonical = new Map<string, string>();
  private byPlaceholder = new Map<string, string>();
  /** Last number used per placeholder name: a type, or a custom rule's label. */
  private counters = new Map<string, number>();

  constructor(options: SamaranOptions = {}) {
    if (options.custom?.length) checkCustomRules(options.custom);
    this.options = options;
  }

  scan(text: string): PiiMatch[] {
    const allow = this.options.allow ?? [];
    return detectPii(text, this.options).filter(
      // search(), not test(): a RegExp with the g or y flag keeps its lastIndex between calls, and would skip a value.
      (m) => !allow.some((a) => (typeof a === 'string' ? a === m.value : m.value.search(a) !== -1)),
    );
  }

  /**
   * Keeps placeholder-like text that is already in `text` and did not come from this vault apart from real values:
   * with "Halo [NAME_1]" in an e-mail template, the real name becomes [NAME_2], so restoring never fills the template
   * with it. `mask` does this for its own input. When the parts of one request are masked one by one, call it on the
   * whole request first, so a template in a later part does not take a number an earlier part already gave out.
   */
  reserve(text: string): void {
    for (const m of text.matchAll(PLACEHOLDER)) {
      if (this.byPlaceholder.has(m[0])) continue; // ours: the user or the model referring to a masked value
      const at = m[1]!.lastIndexOf('_');
      const name = m[1]!.slice(0, at);
      const n = Number(m[1]!.slice(at + 1));
      if (n > (this.counters.get(name) ?? 0) && n < 1e9) this.counters.set(name, n);
    }
  }

  mask(text: string): MaskResult {
    if (this.options.mode !== 'partial') this.reserve(text);
    const matches = this.scan(text);
    const masked: MaskedMatch[] = [];
    let out = '';
    let cursor = 0;
    for (const m of matches) {
      const replacement = this.options.mode === 'partial' ? partialMask(m.type, m.value) : this.placeholderFor(m);
      out += text.slice(cursor, m.start) + replacement;
      cursor = m.end;
      masked.push({ ...m, replacement });
    }
    out += text.slice(cursor);
    return { text: out, matches: masked };
  }

  /** Puts the original values back. Unknown placeholders are left as they are. */
  unmask(text: string): string {
    return text.replace(PLACEHOLDER, (whole, key: string) => this.byPlaceholder.get(`[${key}]`) ?? whole);
  }

  /** Number of distinct values in the vault. */
  get size(): number {
    return this.byPlaceholder.size;
  }

  /** Serializable vault, to restore placeholders in another process. Treat it as the raw data it contains. */
  exportVault(): Array<[placeholder: string, value: string]> {
    return [...this.byPlaceholder.entries()];
  }

  importVault(entries: Array<[string, string]>): void {
    for (const [placeholder, value] of entries) {
      const match = /^\[([A-Z_]+)_(\d+)\]$/.exec(placeholder);
      if (!match) continue;
      const name = match[1]!;
      // A name that is not a built-in type is a custom rule's label.
      const type: PiiType = PII_TYPES.includes(name as PiiType) ? (name as PiiType) : 'CUSTOM';
      this.byPlaceholder.set(placeholder, value);
      this.byCanonical.set(`${name}:${canonical(type, value)}`, placeholder);
      this.counters.set(name, Math.max(this.counters.get(name) ?? 0, Number(match[2])));
    }
  }

  /**
   * The placeholder for a value you already know is personal data, such as the street a parser split out of a
   * masked address. A value gets the same placeholder here as from `mask`, and `unmask` restores it. CUSTOM takes
   * the rule's label: `placeholder('CUSTOM', 'EMP-004211', 'EMPLOYEE_ID')` gives [EMPLOYEE_ID_1].
   */
  placeholder(type: PiiType, value: string, label?: string): string {
    if (!PII_TYPES.includes(type)) throw new RangeError(`Unknown PII type "${type}". Valid types: ${PII_TYPES.join(', ')}`);
    if (type === 'CUSTOM') checkCustomRules([{ label: label ?? '', fields: ['-'] }]);
    else if (label !== undefined) throw new RangeError('A label is only used with the CUSTOM type.');
    const name = type === 'CUSTOM' ? label! : type;
    const key = `${name}:${canonical(type, value)}`;
    const existing = this.byCanonical.get(key);
    if (existing) return existing;
    const n = (this.counters.get(name) ?? 0) + 1;
    this.counters.set(name, n);
    const placeholder = `[${name}_${n}]`;
    this.byCanonical.set(key, placeholder);
    this.byPlaceholder.set(placeholder, value);
    return placeholder;
  }

  private placeholderFor(m: PiiMatch): string {
    return this.placeholder(m.type, m.value, m.type === 'CUSTOM' ? m.label : undefined);
  }
}

/** One-shot masking. Use a `Samaran` instance when you need to unmask later. */
export function maskPii(text: string, options: SamaranOptions = {}): MaskResult {
  return new Samaran(options).mask(text);
}
