// Kemendagri administrative regions (provinsi → kabupaten/kota → kecamatan → kelurahan/desa).
// Node-only: the data is read from `data/` on first use.
import { readFileSync } from 'node:fs';

export type WilayahLevel = 1 | 2 | 3 | 4;
export type WilayahType =
  | 'provinsi'
  | 'kabupaten'
  | 'kota'
  | 'kecamatan'
  | 'distrik'
  | 'kelurahan'
  | 'desa'
  | 'desa_adat';

export interface Wilayah {
  /** Dotted Kemendagri code: "32", "32.76", "32.76.01", "32.76.01.1001" */
  code: string;
  name: string;
  level: WilayahLevel;
  type: WilayahType;
  /** "Kota Depok, Jawa Barat" — the region with its parents, nearest first. */
  path: string;
  /** Kode pos, for kelurahan/desa. */
  postalCode?: string;
}

let base: Record<string, string> | undefined;
let desa: Record<string, string> | undefined;
let kodepos: Record<string, string> | undefined;
let childIndex: Map<string, string[]> | undefined;
let byPostalCode: Map<string, string[]> | undefined;

function load(file: string): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
}
const getBase = () => (base ??= load('wilayah.json'));
const getDesa = () => (desa ??= load('desa.json'));
const getKodepos = () => (kodepos ??= load('kodepos.json'));

/** Accepts "3276", "32.76", "3276011001" and returns the dotted form. */
export function normalizeWilayahCode(code: string): string {
  const c = String(code).trim();
  if (c.includes('.')) return c;
  const d = c.replace(/\D/g, '');
  const parts = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 6), d.slice(6, 10)].filter(Boolean);
  return parts.join('.');
}

function levelOf(code: string): WilayahLevel {
  return code.split('.').length as WilayahLevel;
}

function typeOf(code: string, name: string): WilayahType {
  const level = levelOf(code);
  if (level === 1) return 'provinsi';
  if (level === 2) return /^kota\b/i.test(name) ? 'kota' : 'kabupaten';
  if (level === 3) return Number(code.slice(0, 2)) >= 91 ? 'distrik' : 'kecamatan';
  // Fourth segment: 1xxx kelurahan, 2xxx desa, 3xxx desa adat (Kabupaten Jayapura).
  const first = code.split('.')[3]![0];
  return first === '1' ? 'kelurahan' : first === '3' ? 'desa_adat' : 'desa';
}

/** Name of a region by code, or undefined. Pass this as `lookupWilayah` to `parseNik`. */
export function wilayahName(code: string): string | undefined {
  const c = normalizeWilayahCode(code);
  return levelOf(c) === 4 ? getDesa()[c] : getBase()[c];
}

function toWilayah(code: string, name: string): Wilayah {
  const parts = code.split('.');
  const names = [name];
  for (let i = parts.length - 1; i >= 1; i--) {
    const parentName = getBase()[parts.slice(0, i).join('.')];
    if (parentName) names.push(parentName);
  }
  const wilayah: Wilayah = { code, name, level: levelOf(code), type: typeOf(code, name), path: names.join(', ') };
  if (wilayah.level === 4) wilayah.postalCode = getKodepos()[code];
  return wilayah;
}

export function getWilayah(code: string): Wilayah | undefined {
  const c = normalizeWilayahCode(code);
  const name = wilayahName(c);
  return name ? toWilayah(c, name) : undefined;
}

function getChildIndex(): Map<string, string[]> {
  if (childIndex) return childIndex;
  childIndex = new Map();
  for (const source of [getBase(), getDesa()]) {
    for (const code of Object.keys(source)) {
      const parent = code.includes('.') ? code.slice(0, code.lastIndexOf('.')) : '';
      let list = childIndex.get(parent);
      if (!list) childIndex.set(parent, (list = []));
      list.push(code);
    }
  }
  return childIndex;
}

/**
 * Direct children of a region, for cascading address dropdowns.
 * No code → the 38 provinces.
 */
export function listWilayah(parentCode?: string): Wilayah[] {
  const parent = parentCode ? normalizeWilayahCode(parentCode) : '';
  const codes = getChildIndex().get(parent) ?? [];
  return codes.map((c) => toWilayah(c, wilayahName(c)!));
}

/** All kode pos inside a region, e.g. every kode pos in Kota Depok ("32.76"). */
export function postalCodesIn(code: string): string[] {
  const c = normalizeWilayahCode(code);
  const set = new Set<string>();
  for (const [desaCode, pos] of Object.entries(getKodepos())) {
    if (desaCode === c || desaCode.startsWith(`${c}.`)) set.add(pos);
  }
  return [...set].sort();
}

/** Kelurahan/desa that use a kode pos. One kode pos often covers several villages. */
export function findByPostalCode(postalCode: string): Wilayah[] {
  const pos = String(postalCode).trim();
  if (!/^\d{5}$/.test(pos)) return [];
  return Object.entries(getKodepos())
    .filter(([, p]) => p === pos)
    .map(([code]) => toWilayah(code, getDesa()[code]!));
}

/** Codes of the kelurahan/desa that use a kode pos; findByPostalCode without building each region. */
export function villagesWithPostalCode(postalCode: string): string[] {
  if (!byPostalCode) {
    byPostalCode = new Map();
    for (const [code, pos] of Object.entries(getKodepos())) {
      const list = byPostalCode.get(pos);
      if (list) list.push(code);
      else byPostalCode.set(pos, [code]);
    }
  }
  return [...(byPostalCode.get(String(postalCode).trim()) ?? [])];
}

/** Names of provinces, regencies, cities, and districts, without villages. For NER's place filter. */
export function districtNames(): string[] {
  return Object.values(getBase());
}

/** Every region as [code, name], provinces to villages. For parseAlamat. */
export function* regionNames(): Generator<[string, string]> {
  yield* Object.entries(getBase());
  yield* Object.entries(getDesa());
}

export { parseAlamat, type ParsedAlamat, type AlamatLevel } from './alamat.ts';

const PREFIX = /^(provinsi|prov|kabupaten|kab|kota administrasi|kota adm|kota|kecamatan|kec|distrik|kelurahan|kel|desa)\.?\s+/;

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(PREFIX, '');
}

export interface SearchWilayahOptions {
  /** Only return regions at this level (1 provinsi … 4 kelurahan/desa). */
  level?: WilayahLevel;
  /** Only return regions inside this code, e.g. "32" for Jawa Barat. */
  within?: string;
  limit?: number;
}

/**
 * Finds regions by name. "depok" → Kota Depok; "kec. cibinong" → Cibinong.
 * Villages are only searched when `level` is 4 or `within` points at a kecamatan or lower,
 * since many villages share names.
 */
export function searchWilayah(query: string, options: SearchWilayahOptions = {}): Wilayah[] {
  const q = normalizeName(query);
  if (!q) return [];
  const limit = options.limit ?? 10;
  const within = options.within ? normalizeWilayahCode(options.within) : undefined;
  const includeDesa = options.level === 4 || (within !== undefined && levelOf(within) >= 3);

  const scored: Array<[number, string, string]> = [];
  const consider = (source: Record<string, string>) => {
    for (const [code, name] of Object.entries(source)) {
      if (options.level && levelOf(code) !== options.level) continue;
      if (within && !(code === within || code.startsWith(`${within}.`))) continue;
      const n = normalizeName(name);
      let score = 0;
      if (n === q) score = 100;
      else if (n.startsWith(q)) score = 80;
      else if (` ${n}`.includes(` ${q}`)) score = 60;
      else if (n.includes(q)) score = 40;
      if (!score) continue;
      // Prefer larger regions when names tie: "Bogor" the kabupaten before the kecamatan.
      scored.push([score - levelOf(code), code, name]);
    }
  };
  consider(getBase());
  if (includeDesa) consider(getDesa());

  scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
  return scored.slice(0, limit).map(([, code, name]) => toWilayah(code, name));
}
