#!/usr/bin/env node
// Scores Samaran's detectors on the benchmark corpus (evals/bench/corpus.mjs), per type of personal data.
//
//   npm run bench                          test split, compared with evals/bench/baseline.json
//   npm run bench -- --split dev --misses  the dev split, listing every miss and false positive
//   npm run bench -- --update-baseline     accept the current numbers as the new baseline
//   npm run bench -- --export DIR          also write the corpus as JSON Lines, to score other tools on it
//   npm run bench -- --save                write evals/bench/results/v<version>.json and RESULTS.md
//
// Three numbers per type:
//   precision  detections of this type that are on a labelled value of this type
//   recall     labelled values found with the right type
//   protected  labelled values whose every letter and digit is masked, by a detection of any type: what matters for
//              privacy, since a NIK masked as KK still never reaches the model
// Detections outside every labelled value are false positives; the trap templates have no personal data at all.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { detectPii } from '../../packages/core/dist/index.js';
import { CORPUS_VERSION, generate } from './corpus.mjs';

const HERE = import.meta.dirname;
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const split = option('split') ?? 'test';
const version = JSON.parse(readFileSync(path.join(HERE, '../../packages/core/package.json'), 'utf8')).version;

const docs = generate({ split });
if (option('export')) {
  const dir = path.resolve(option('export'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${split}.jsonl`), docs.map((d) => JSON.stringify(d)).join('\n') + '\n');
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const stats = new Map();
const of = (type) => {
  if (!stats.has(type)) stats.set(type, { gold: 0, found: 0, protected: 0, detected: 0, correct: 0 });
  return stats.get(type);
};
const formats = new Map();
const misses = [];
const falsePositives = [];
const started = performance.now();

for (const doc of docs) {
  const found = detectPii(doc.text);
  const fmt = formats.get(doc.format) ?? { gold: 0, protected: 0, docs: 0, falsePositives: 0 };
  formats.set(doc.format, fmt);
  fmt.docs++;
  const covered = new Uint8Array(doc.text.length);
  for (const m of found) covered.fill(1, m.start, m.end);
  for (const g of doc.spans) {
    const s = of(g.type);
    s.gold++;
    fmt.gold++;
    if (found.some((m) => m.type === g.type && overlaps(m, g))) s.found++;
    let safe = true;
    for (let i = g.start; i < g.end; i++) if (!covered[i] && /[\p{L}\p{N}]/u.test(doc.text[i])) safe = false;
    if (safe) {
      s.protected++;
      fmt.protected++;
    } else {
      const got = found.filter((m) => overlaps(m, g)).map((m) => `${m.type} ${JSON.stringify(m.value)}`);
      misses.push(`${doc.id} [${doc.format}] ${g.type} ${JSON.stringify(doc.text.slice(g.start, g.end))}${got.length ? ` (partly: ${got.join(', ')})` : ''}`);
    }
  }
  for (const m of found) {
    const s = of(m.type);
    s.detected++;
    if (doc.spans.some((g) => g.type === m.type && overlaps(m, g))) s.correct++;
    if (!doc.spans.some((g) => overlaps(m, g)) && !doc.neutral.some((n) => overlaps(m, n))) {
      fmt.falsePositives++;
      falsePositives.push(`${doc.id} [${doc.format}] ${m.type} ${JSON.stringify(m.value)}`);
    }
  }
}
const ms = performance.now() - started;

const ratio = (a, b) => (b ? a / b : null);
/** 95% Wilson score interval for k of n: how far the number could move on another corpus of the same size. */
const wilson = (k, n) => {
  if (!n) return null;
  const z = 1.96;
  const p = k / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
};
const f1 = (p, r) => (p === null || r === null || p + r === 0 ? null : (2 * p * r) / (p + r));
const types = [...stats.entries()]
  .map(([type, s]) => {
    const precision = ratio(s.correct, s.detected);
    const recall = ratio(s.found, s.gold);
    return {
      type, gold: s.gold, detected: s.detected, precision, recall, f1: f1(precision, recall),
      protected: ratio(s.protected, s.gold), protectedCI: wilson(s.protected, s.gold),
    };
  })
  .sort((a, b) => b.gold - a.gold || a.type.localeCompare(b.type));
const total = [...stats.values()].reduce(
  (t, s) => ({ gold: t.gold + s.gold, found: t.found + s.found, protected: t.protected + s.protected, detected: t.detected + s.detected, correct: t.correct + s.correct }),
  { gold: 0, found: 0, protected: 0, detected: 0, correct: 0 },
);
const overall = {
  precision: ratio(total.correct, total.detected),
  recall: ratio(total.found, total.gold),
  protected: ratio(total.protected, total.gold),
  protectedCI: wilson(total.protected, total.gold),
  falsePositives: falsePositives.length,
};
overall.f1 = f1(overall.precision, overall.recall);
const result = {
  version,
  corpus: CORPUS_VERSION,
  split,
  documents: docs.length,
  labelled: total.gold,
  overall,
  types,
  formats: Object.fromEntries([...formats].map(([f, s]) => [f, { documents: s.docs, labelled: s.gold, protected: ratio(s.protected, s.gold), falsePositives: s.falsePositives }])),
};

// --- report --------------------------------------------------------------------------------------------------------

const pct = (x) => (x === null ? '    -' : `${(100 * x).toFixed(1).padStart(5)}`);
const ci = (r) => (r ? `${pct(r[0]).trim()}–${pct(r[1]).trim()}` : '-');
console.log(`Samaran benchmark ${version}, corpus ${CORPUS_VERSION}, ${split} split: ${docs.length} documents, ${total.gold} labelled values, ${(ms / docs.length).toFixed(2)} ms per document\n`);
console.log('type             labelled  precision  recall     F1  protected  95% CI');
for (const t of types) {
  console.log(`${t.type.padEnd(16)} ${String(t.gold).padStart(8)}  ${pct(t.precision).padStart(9)}  ${pct(t.recall).padStart(6)}  ${pct(t.f1)}  ${pct(t.protected).padStart(9)}  ${ci(t.protectedCI)}`);
}
console.log(`${'all'.padEnd(16)} ${String(total.gold).padStart(8)}  ${pct(overall.precision).padStart(9)}  ${pct(overall.recall).padStart(6)}  ${pct(overall.f1)}  ${pct(overall.protected).padStart(9)}  ${ci(overall.protectedCI)}`);
console.log('\nformat       documents  protected  false positives');
for (const [f, s] of Object.entries(result.formats)) {
  console.log(`${f.padEnd(12)} ${String(s.documents).padStart(9)}  ${pct(s.protected).padStart(9)}  ${String(s.falsePositives).padStart(15)}`);
}
console.log(`\n${misses.length} values not fully masked, ${falsePositives.length} false positives`);
if (flag('misses')) {
  if (split === 'test') console.log('(test split: read these to understand the numbers, not to tune a detector; add a dev template instead)');
  console.log(`\nnot fully masked:\n  ${misses.join('\n  ')}\n\nfalse positives:\n  ${falsePositives.join('\n  ')}`);
}

// --- baseline ------------------------------------------------------------------------------------------------------
// Fails when a number drops by more than the tolerance: privacy (protected) is held tightest.

const BASELINE = path.join(HERE, 'baseline.json');
const TOLERANCE = { protected: 0.005, recall: 0.01, precision: 0.02 };
const MIN_LABELLED = 20;
if (flag('update-baseline')) {
  writeFileSync(BASELINE, JSON.stringify({ ...result, formats: undefined }, null, 2) + '\n');
  console.log(`\nbaseline written: ${path.relative(process.cwd(), BASELINE)}`);
} else if (split === 'test') {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch {
    console.log('\nno baseline yet: run with --update-baseline');
  }
  if (baseline && (baseline.corpus ?? 1) !== CORPUS_VERSION) {
    console.log(`\nthe baseline is from corpus ${baseline.corpus ?? 1}, this is corpus ${CORPUS_VERSION}: run with --update-baseline`);
    process.exitCode = 1;
  } else if (baseline) {
    const drops = [];
    const compare = (what, now, before) => {
      for (const key of Object.keys(TOLERANCE)) {
        if (now?.[key] == null || before?.[key] == null) continue;
        if (before[key] - now[key] > TOLERANCE[key]) drops.push(`${what} ${key}: ${pct(before[key]).trim()}% → ${pct(now[key]).trim()}%`);
      }
    };
    compare('all', overall, baseline.overall);
    for (const t of types) {
      const before = baseline.types.find((b) => b.type === t.type);
      if (t.gold >= MIN_LABELLED) compare(t.type, t, before);
    }
    if (drops.length) {
      console.log(`\nworse than the baseline (${baseline.version}):\n  ${drops.join('\n  ')}`);
      process.exitCode = 1;
    } else {
      console.log(`\nno drop against the baseline (${baseline.version})`);
    }
  }
}

if (flag('save')) {
  const dir = path.join(HERE, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `v${version}-${split}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(`saved ${path.relative(process.cwd(), path.join(dir, `v${version}-${split}.json`))}`);
}
