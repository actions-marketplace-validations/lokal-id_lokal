#!/usr/bin/env node
// Scores Samaran's names on the chat corpus (evals/chat/corpus.mjs): names written the way people chat.
//
//   npm run bench:chat                          test split
//   npm run bench:chat -- --split dev --misses  the dev split, listing every miss and false positive
//   npm run bench:chat -- --export DIR          also write the corpus as JSON Lines, to score other tools on it
//   npm run bench:chat -- --extra FILE          add another detector's matches (JSON Lines of { id, matches }), such
//                                               as the optional NER model's, to Samaran's
//
// Names are counted as protected when every letter of the name is masked, by a detection of any type. A detection
// outside every name is a false positive: the trap templates have no names at all.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { detectPii } from '../../packages/core/dist/index.js';
import { CORPUS_VERSION, generate } from './corpus.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const split = option('split') ?? 'test';

const docs = generate({ split });
if (option('export')) {
  const dir = path.resolve(option('export'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `chat-${split}.jsonl`), docs.map((d) => JSON.stringify(d)).join('\n') + '\n');
}
const extra = new Map();
if (option('extra')) {
  for (const line of readFileSync(path.resolve(option('extra')), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const { id, matches } = JSON.parse(line);
    extra.set(id, matches);
  }
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const groups = new Map();
const group = (key) => groups.get(key) ?? groups.set(key, { names: 0, found: 0, protected: 0 }).get(key);
let falsePositives = 0;
let trapDocs = 0;
let trapDocsClean = 0;
const misses = [];
const wrong = [];
for (const doc of docs) {
  const found = [...detectPii(doc.text), ...(extra.get(doc.id) ?? [])];
  const covered = new Uint8Array(doc.text.length);
  for (const m of found) covered.fill(1, m.start, m.end);
  for (const g of doc.spans) {
    const hit = found.some((m) => m.type === 'NAME' && overlaps(m, g));
    let safe = true;
    for (let i = g.start; i < g.end; i++) if (!covered[i] && /[\p{L}\p{N}]/u.test(doc.text[i])) safe = false;
    for (const key of ['all', `format: ${doc.format}`, `style: ${doc.style}`, `name: ${g.kind}`]) {
      const s = group(key);
      s.names++;
      if (hit) s.found++;
      if (safe) s.protected++;
    }
    if (!safe) misses.push(`${doc.id} [${doc.format}, ${doc.style}] ${JSON.stringify(doc.text.slice(g.start, g.end))} in ${JSON.stringify(doc.text)}`);
  }
  const fps = found.filter((m) => !doc.spans.some((g) => overlaps(m, g)));
  falsePositives += fps.length;
  for (const m of fps) wrong.push(`${doc.id} [${doc.format}] ${m.type ?? 'NAME'} ${JSON.stringify(doc.text.slice(m.start, m.end))} in ${JSON.stringify(doc.text)}`);
  if (doc.format === 'trap') {
    trapDocs++;
    if (!fps.length) trapDocsClean++;
  }
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
function wilson(k, n) {
  if (!n) return '-';
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return `${(100 * (c - h)).toFixed(1)}–${(100 * (c + h)).toFixed(1)}`;
}

console.log(`chat corpus ${CORPUS_VERSION}, ${split} split: ${docs.length} documents, ${group('all').names} names${extra.size ? ', with --extra' : ''}\n`);
console.log('group                          names   found  protected  95% CI');
const order = [...groups.keys()].sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b)));
for (const key of order) {
  const s = groups.get(key);
  console.log(`${key.padEnd(30)} ${String(s.names).padStart(5)}  ${pct(s.found, s.names).padStart(6)}  ${pct(s.protected, s.names).padStart(9)}  ${wilson(s.protected, s.names)}`);
}
console.log(`\nfalse positives: ${falsePositives} detections outside names; trap documents with none: ${trapDocsClean} of ${trapDocs}`);
if (flag('misses')) {
  console.log(`\nnames not fully masked (${misses.length}):`);
  for (const m of misses) console.log(`  ${m}`);
  console.log(`\nfalse positives (${wrong.length}):`);
  for (const w of wrong) console.log(`  ${w}`);
}
