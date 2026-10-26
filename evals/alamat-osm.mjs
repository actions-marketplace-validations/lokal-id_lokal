// parseAlamat on real addresses: places in OpenStreetMap whose addr:full names a kelurahan, kecamatan, kabupaten, or
// kota (offices, schools, mosques, shops, housing), checked against the administrative boundaries their coordinates
// fall in. The data is fetched from the Overpass API when the script runs and cached in evals/results/osm/; none of it
// is kept in the repository. Data © OpenStreetMap contributors, ODbL.
//
// The answer key is where the point is, not what the text says, so it is stricter than it should be: a shop mapped
// next to a kelurahan boundary, or an address that names the neighbouring kelurahan, counts as wrong even when the
// parser read the text right. OSM's boundary names also differ from Kemendagri's now and then. --verbose prints the
// disagreements so they can be checked by hand.
//
//   npm run build -w @lokal-id/core && node evals/alamat-osm.mjs [--n 500] [--seed 1] [--verbose]
import { parseAlamat } from '../packages/core/dist/wilayah.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const N = Number(arg('--n', 500));
let seed = Number(arg('--seed', 1));
const verbose = process.argv.includes('--verbose');
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const HEADERS = { 'User-Agent': 'lokal-alamat-eval (github.com/lokal-id/lokal)', 'Content-Type': 'application/x-www-form-urlencoded' };
const cache = new URL('./results/osm/', import.meta.url);
mkdirSync(cache, { recursive: true });

async function overpass(query) {
  for (let attempt = 0, wait = 15; ; attempt++, wait *= 2) {
    const r = await fetch(OVERPASS, { method: 'POST', headers: HEADERS, body: `data=${encodeURIComponent(query)}` });
    if (r.ok) return r.json();
    if (attempt >= 6) throw new Error(`Overpass: HTTP ${r.status}`);
    console.error(`Overpass busy (HTTP ${r.status}), retrying in ${wait}s`);
    await new Promise((done) => setTimeout(done, wait * 1000));
  }
}

// 1. Places with a written address that names a region.
const placesFile = new URL('places.json', cache);
if (!existsSync(placesFile)) {
  console.error('Fetching addresses from OpenStreetMap…');
  const query = `[out:json][timeout:360];area["ISO3166-1"="ID"][admin_level=2]->.id;
nwr["addr:full"~"(kec\\\\.|kecamatan|kabupaten|kab\\\\.|kota |kel\\\\.|kelurahan|desa |, )",i](area.id);out tags center;`;
  const { elements } = await overpass(query);
  const places = elements
    .map((e) => ({ id: `${e.type}${e.id}`, full: e.tags['addr:full'], lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon }))
    // More than a street: two commas, a level word, or a kode pos.
    .filter(
      (p) =>
        p.lat !== undefined &&
        ((p.full.match(/,/g) ?? []).length >= 2 ||
          /\b(?:kel|kelurahan|kec|kecamatan|kab|kabupaten|kota|desa|ds|prov|provinsi)\b/i.test(p.full) ||
          /\b\d{5}\b/.test(p.full)),
    );
  writeFileSync(placesFile, JSON.stringify(places));
}
const places = JSON.parse(readFileSync(placesFile, 'utf8'));

// 2. A sample without near-copies ("Blok J2 No. 1", "No. 2", …), the same for the same seed.
const random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32;
};
const seen = new Set();
const unique = places.filter((p) => {
  const key = p.full.toLowerCase().replace(/\d+/g, '#');
  return !seen.has(key) && seen.add(key);
});
for (let i = unique.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [unique[i], unique[j]] = [unique[j], unique[i]];
}
const sample = unique.slice(0, N);

// 3. The boundaries each point is in (admin_level 4 provinsi, 5 kabupaten/kota, 6 kecamatan, 7 or 8 kelurahan/desa).
const areasFile = new URL('areas.json', cache);
const areas = existsSync(areasFile) ? JSON.parse(readFileSync(areasFile, 'utf8')) : {};
const todo = sample.filter((p) => !areas[p.id]);
for (let i = 0; i < todo.length; i += 150) {
  console.error(`Looking up boundaries ${i + 1}–${Math.min(i + 150, todo.length)} of ${todo.length}…`);
  let query = '[out:json][timeout:300];';
  for (const p of todo.slice(i, i + 150)) {
    query += `make m pid="${p.id}";out;is_in(${p.lat},${p.lon})->.a;area.a[boundary=administrative][admin_level~"^[4-8]$"];out tags;`;
  }
  let current;
  for (const e of (await overpass(query)).elements) {
    if (e.type === 'm') areas[(current = e.tags.pid)] = [];
    else areas[current].push({ level: e.tags.admin_level, name: e.tags.name });
  }
  writeFileSync(areasFile, JSON.stringify(areas));
}

// 4. Score each level the boundaries give.
const norm = (s = '') =>
  s
    .toLowerCase()
    .replace(/^(?:daerah khusus ibukota|daerah istimewa|daerah khusus|provinsi)\s+/, '')
    .replace(/^(?:kabupaten|kota administrasi|kota|kab\.?|desa|kelurahan|kel\.?)\s+/, '')
    .replace(/\b(?:ii|2)\b/g, 'dua')
    .replace(/\b(?:iii|3)\b/g, 'tiga')
    .replace(/\b(?:i|1)\b/g, 'satu')
    .replace(/[^a-z0-9]+/g, '');
const LEVELS = { provinsi: ['4'], kabupatenKota: ['5'], kecamatan: ['6'], kelurahanDesa: ['7', '8'] };
const stats = Object.fromEntries(Object.keys(LEVELS).map((k) => [k, { known: 0, answered: 0, right: 0 }]));
const byConfidence = {};
const wrong = [];
let none = 0;
for (const p of sample) {
  const truth = areas[p.id];
  if (!truth) continue;
  const r = parseAlamat(p.full);
  if (r.confidence === 'none') none++;
  for (const [key, levels] of Object.entries(LEVELS)) {
    const names = truth.filter((a) => levels.includes(a.level)).map((a) => norm(a.name));
    if (!names.length) continue;
    const s = stats[key];
    s.known++;
    if (!r[key]) continue;
    s.answered++;
    const ok = names.includes(norm(r[key].name));
    if (ok) s.right++;
    const c = (byConfidence[r.confidence] ??= { right: 0, wrong: 0 });
    c[ok ? 'right' : 'wrong']++;
    if (!ok) wrong.push(`${r.confidence.padEnd(6)} ${key.padEnd(13)} ${JSON.stringify(p.full)}\n       OSM: ${names.join(' | ')}  parser: ${r[key].name}`);
  }
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
console.log(`parseAlamat on ${sample.length} OpenStreetMap addresses (seed ${arg('--seed', 1)}); ${none} with no region found`);
for (const [key, s] of Object.entries(stats)) {
  console.log(`  ${key.padEnd(14)} ${String(s.known).padStart(5)} known  answered ${pct(s.answered, s.known).padStart(6)}  right ${pct(s.right, s.answered).padStart(6)}`);
}
for (const [c, { right, wrong: w }] of Object.entries(byConfidence)) {
  console.log(`  confidence ${c.padEnd(7)} ${pct(right, right + w).padStart(6)} of ${right + w} level answers right`);
}
if (verbose) console.log(`\n${wrong.join('\n')}`);
console.log('Data © OpenStreetMap contributors, ODbL.');
