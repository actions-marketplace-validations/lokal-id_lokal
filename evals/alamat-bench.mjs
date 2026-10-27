// Benchmark for parseAlamat: addresses built from randomly chosen kelurahan/desa in the Kemendagri data, written the
// ways people write them (commas or none, capitals or lowercase, "Kel."/"Kec."/"Kab." or nothing, the kecamatan or
// the provinsi left out, a kode pos or none), and checked against the region they were built from. Street names are
// made up. A fixed seed keeps the run the same each time; pass --seed N for another sample.
//
//   npm run build -w @lokal-id/core && node evals/alamat-bench.mjs [--n 2000] [--seed 7] [--verbose]
import { parseAlamat, getWilayah } from '../packages/core/dist/wilayah.js';
import { readFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const N = Number(arg('--n', 2000));
let seed = Number(arg('--seed', 7));
const verbose = process.argv.includes('--verbose');
// mulberry32
const random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32;
};
const pick = (list) => list[Math.floor(random() * list.length)];

const desa = Object.keys(JSON.parse(readFileSync(new URL('../packages/core/data/desa.json', import.meta.url), 'utf8')));
const STREETS = ['Jl. Melati', 'Jl. Kenanga No. 12', 'Gg. Mawar 3', 'Jl. Merdeka No. 45', 'Jalan Flamboyan 7', 'Perum Griya Asri Blok C2 No. 7', 'Jl. Anggrek Raya No. 101'];
const strip = (name) => name.replace(/^(?:Kabupaten|Kota)(?: Administrasi)? /, '');

function build(code) {
  const kab = getWilayah(code.slice(0, 5));
  const names = { desa: getWilayah(code).name, kec: getWilayah(code.slice(0, 8)).name, kab: strip(kab.name) };
  return { ...write(code), names };
}

function write(code) {
  const v = getWilayah(code);
  const kec = getWilayah(code.split('.').slice(0, 3).join('.'));
  const kab = getWilayah(code.split('.').slice(0, 2).join('.'));
  const prov = getWilayah(code.split('.')[0]);
  const style = Math.floor(random() * 8);
  const kota = kab.type === 'kota';
  const lv = v.type === 'kelurahan' ? 'Kel.' : 'Ds.';
  const kabWord = kota ? 'Kota' : pick(['Kab.', 'Kabupaten']);
  const street = pick(STREETS);
  const rt = `RT ${String(1 + Math.floor(random() * 9)).padStart(3, '0')}/RW ${String(1 + Math.floor(random() * 9)).padStart(3, '0')}`;
  const postal = random() < 0.5 && v.postalCode ? ` ${v.postalCode}` : '';
  // What each style names: the expected answer is the kelurahan when it is named with its kecamatan or kota.
  switch (style) {
    case 0: // full, with level words
      return { code, text: `${street}, ${rt}, ${lv} ${v.name}, Kec. ${kec.name}, ${kabWord} ${strip(kab.name)}, ${prov.name}${postal}` };
    case 1: // commas, no level words
      return { code, text: `${street}, ${v.name}, ${kec.name}, ${strip(kab.name)}, ${prov.name}${postal}` };
    case 2: // lowercase, no commas
      return { code, text: `${street} ${v.name} ${kec.name} ${strip(kab.name)}${postal}`.toLowerCase() };
    case 3: // capitals, as on a KTP
      return { code, text: `${street} ${rt} ${lv} ${v.name} KEC. ${kec.name} ${kabWord} ${strip(kab.name)}`.toUpperCase() };
    case 4: // kecamatan left out
      return { code, text: `${street}, ${v.name}, ${kabWord} ${strip(kab.name)}${postal}` };
    case 5: // provinsi only after the kota, no street
      return { code, text: `${lv} ${v.name}, ${kec.name}, ${strip(kab.name)}, ${prov.name}` };
    case 6: // kecamatan and kota only: the answer is the kecamatan
      return { code: kec.code, text: `${street}, Kec. ${kec.name}, ${kabWord} ${strip(kab.name)}` };
    default: // with a kode pos and the kecamatan, kelurahan left out: the kelurahan if the kode pos is its own
      return { code: kec.code, text: `${street}, ${kec.name}, ${strip(kab.name)}${postal}`, orChild: true };
  }
}

let right = 0;
let wrong = 0;
let missing = 0;
let confidentWrong = 0;
const byConfidence = { high: [0, 0], medium: [0, 0], low: [0, 0], none: [0, 0] };
const failures = [];
const started = performance.now();
// --typos: one letter dropped, doubled, swapped, or mistyped in one region name ("Cibinog", "Tasikmalayah"). The first
// letter stays, as it mostly does when people mistype.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
function typo(c) {
  const names = [c.names.desa, c.names.kec, c.names.kab].filter((n) => n.length >= 5 && /^[A-Za-z ]+$/.test(n));
  const name = names.length ? pick(names) : undefined;
  const at = name ? c.text.toLowerCase().indexOf(name.toLowerCase()) : -1;
  if (at < 0) return c;
  const word = c.text.slice(at, at + name.length);
  const i = 1 + Math.floor(random() * (word.length - 2));
  const kind = Math.floor(random() * 4);
  const letter = LETTERS[Math.floor(random() * 26)];
  const typed =
    kind === 0 ? word.slice(0, i) + word.slice(i + 1)
    : kind === 1 ? word.slice(0, i) + word[i] + word.slice(i)
    : kind === 2 ? word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)
    : word.slice(0, i) + (word[i] === word[i].toUpperCase() ? letter.toUpperCase() : letter) + word.slice(i + 1);
  if (/ /.test(typed.slice(i - 1, i + 2)) || typed.toLowerCase() === word.toLowerCase()) return c;
  return { ...c, text: c.text.slice(0, at) + typed + c.text.slice(at + name.length) };
}
const typos = process.argv.includes('--typos');

for (let i = 0; i < N; i++) {
  const built = build(pick(desa));
  const c = typos ? typo(built) : built;
  const r = parseAlamat(c.text);
  const ok = r.code === c.code || (c.orChild && r.code?.startsWith(`${c.code}.`));
  byConfidence[r.confidence][0]++;
  if (ok) {
    right++;
    byConfidence[r.confidence][1]++;
  } else if (!r.code) missing++;
  else {
    wrong++;
    if (r.confidence === 'high') confidentWrong++;
  }
  if (!ok) failures.push(`${c.text}\n    expected ${c.code} ${getWilayah(c.code)?.path}\n    got      ${r.code ?? '-'} ${r.code ? getWilayah(r.code)?.path : ''} (${r.confidence})`);
}
const ms = (performance.now() - started) / N;
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
console.log(`parseAlamat on ${N} addresses (seed ${arg('--seed', 7)}): ${pct(right, N)} right, ${pct(wrong, N)} wrong, ${pct(missing, N)} no region; ${ms.toFixed(2)} ms each`);
for (const [level, [n, ok]] of Object.entries(byConfidence)) if (n) console.log(`  ${level.padEnd(6)} ${String(n).padStart(5)} results, ${pct(ok, n)} right`);
console.log(`  wrong with confidence "high": ${confidentWrong}`);
if (verbose) for (const f of failures.slice(0, 60)) console.log(`  ${f}`);
