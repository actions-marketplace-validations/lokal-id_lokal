import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadInRoot, resolveInRoot, writeInRoot } from '../src/files.ts';

const CANARY = 'OUTSIDE_CANARY_NOT_PII_7F31';

/** A project with data/ok.txt inside the root, and the same name outside it holding the canary. */
function setup() {
  const base = mkdtempSync(path.join(tmpdir(), 'lokal-race-'));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  mkdirSync(path.join(root, 'data'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, 'data', 'ok.txt'), 'catatan biasa\n');
  writeFileSync(path.join(outside, 'ok.txt'), `${CANARY}\n`);
  return { base, root, outside };
}

/** Another process that keeps swapping root/data for a junction (a symlink elsewhere) to the outside folder. */
function swapper(root: string, outside: string) {
  // Swaps forever: the real folder away and a link to the outside in its place, then back. rmSync without recursive
  // removes the link only, never what it points to.
  const script = `
    const fs = require('fs'), p = require('path');
    const data = p.join(${JSON.stringify(root)}, 'data'), real = data + '_real';
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    const spin = () => { const t = process.hrtime.bigint(); while (process.hrtime.bigint() - t < 200000n); };
    for (;;) {
      try { fs.renameSync(data, real); } catch {}
      try { fs.symlinkSync(${JSON.stringify(outside)}, data, type); } catch {}
      spin();
      try { fs.rmSync(data); } catch {}
      try { fs.renameSync(real, data); } catch {}
      spin();
    }`;
  return spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
}

async function race(root: string, read: () => string, ms: number): Promise<{ reads: number; leaks: number }> {
  let reads = 0;
  let leaks = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (read().includes(CANARY)) leaks++;
      reads++;
    } catch {
      // refused or not there at that moment: both fine
    }
    if (reads % 50 === 0) await new Promise((r) => setImmediate(r));
  }
  return { reads, leaks };
}

test('baca: path yang ditukar ke luar root di tengah jalan tidak pernah terbaca (TOCTOU)', async () => {
  const { base, root, outside } = setup();
  const child = swapper(root, outside);
  try {
    // The check-then-read-by-path of 0.15.0, for comparison: shows the swap does open a window.
    const old = await race(root, () => readFileSync(resolveInRoot(root, 'data/ok.txt'), 'utf8'), 1500);
    const checked = await race(root, () => {
      const { doc } = loadInRoot(root, 'data/ok.txt');
      return doc.kind === 'text' ? doc.text : '';
    }, 3000);
    assert.equal(checked.leaks, 0, `loadInRoot read the outside file ${checked.leaks} times in ${checked.reads} reads`);
    assert.ok(checked.reads > 0, 'the race read something');
    if (old.leaks === 0) console.log(`note: the old way leaked 0 times in ${old.reads} reads on this machine`);
    else console.log(`the old way leaked ${old.leaks} times in ${old.reads} reads; loadInRoot 0 in ${checked.reads}`);
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
    rmSync(base, { recursive: true, force: true });
  }
});

test('tulis: data asli tidak pernah tertulis ke luar root saat path ditukar (TOCTOU)', async () => {
  const { base, root, outside } = setup();
  const child = swapper(root, outside);
  try {
    // The check-then-write-by-path of 0.15.0, for comparison, into its own file name.
    const oldEnd = Date.now() + 1500;
    let oldWrites = 0;
    while (Date.now() < oldEnd) {
      try {
        const abs = resolveInRoot(root, 'data/lama.txt');
        writeFileSync(abs, 'Nama: Budi Santoso\n');
        oldWrites++;
      } catch {
        // refused or not there at that moment
      }
      if (oldWrites % 50 === 0) await new Promise((r) => setImmediate(r));
    }
    const oldOutside = (() => { try { return readFileSync(path.join(outside, 'lama.txt'), 'utf8'); } catch { return ''; } })();
    console.log(`the old way ${oldOutside ? 'wrote real data outside the root' : 'wrote nothing outside the root'} in ${oldWrites} writes`);
    rmSync(path.join(outside, 'lama.txt'), { force: true });
    let writes = 0;
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      try {
        writeInRoot(root, 'data/hasil.txt', 'Nama: Budi Santoso\n');
        writes++;
      } catch {
        // refused or not there at that moment
      }
      if (writes % 50 === 0) await new Promise((r) => setImmediate(r));
    }
    child.kill();
    await new Promise((r) => child.once('exit', r));
    const written = (() => { try { return readFileSync(path.join(outside, 'hasil.txt'), 'utf8'); } catch { return ''; } })();
    assert.equal(written, '', 'nothing was written outside the root');
    assert.ok(writes > 0, 'the race wrote something');
    // A temporary file is created by its path and then checked; when a second swap comes before it can be removed, it
    // stays where the swap led it, empty. Nothing with data may be there.
    const { readdirSync, statSync } = await import('node:fs');
    const leftovers = readdirSync(outside).filter((f) => f !== 'ok.txt');
    assert.deepEqual(leftovers.filter((f) => statSync(path.join(outside, f)).size > 0), [], 'no file with data outside the root');
    if (leftovers.length) console.log(`${leftovers.length} empty temporary file(s) left outside the root by a double swap`);
  } finally {
    child.kill();
    rmSync(base, { recursive: true, force: true });
  }
});

test('hard link ke file di luar root ditolak', () => {
  const { base, root, outside } = setup();
  try {
    linkSync(path.join(outside, 'ok.txt'), path.join(root, 'linked.txt'));
    assert.throws(() => loadInRoot(root, 'linked.txt'), /more than one hard link/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
