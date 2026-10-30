import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveInRoot } from '../src/files.ts';

let base: string;
let root: string;

before(() => {
  base = mkdtempSync(path.join(tmpdir(), 'lokal-paths-'));
  root = path.join(base, 'project');
  mkdirSync(path.join(root, 'data'), { recursive: true });
  mkdirSync(path.join(base, 'outside'));
  writeFileSync(path.join(base, 'outside', 'secret.txt'), 'OUTSIDE_CANARY');
  writeFileSync(path.join(root, '..notes.txt'), 'inside');
  // A junction needs no special rights on Windows; elsewhere it is a plain directory symlink.
  symlinkSync(path.join(base, 'outside'), path.join(root, 'link'), 'junction');
});

after(() => rmSync(base, { recursive: true, force: true }));

test('paths inside the root resolve, including ones still to be written', () => {
  assert.equal(resolveInRoot(root, 'data'), path.join(root, 'data'));
  assert.equal(resolveInRoot(root, 'baru/sub/hasil.csv'), path.join(root, 'baru', 'sub', 'hasil.csv'));
  assert.equal(resolveInRoot(root, '..notes.txt'), path.join(root, '..notes.txt'), 'a name starting with two dots');
});

test('paths that leave the root are refused', () => {
  for (const p of ['..', '../outside/secret.txt', path.join(base, 'outside', 'secret.txt')]) {
    assert.throws(() => resolveInRoot(root, p), /outside the allowed root/, p);
  }
});

test('a link inside the root that points outside it is refused, for reading and for writing', () => {
  assert.throws(() => resolveInRoot(root, 'link/secret.txt'), /outside the allowed root/);
  assert.throws(() => resolveInRoot(root, 'link'), /outside the allowed root/);
  assert.throws(() => resolveInRoot(root, 'link/new/output.csv'), /outside the allowed root/);
});

test('a file symlink that points outside the root is refused', (t) => {
  const link = path.join(root, 'linked.txt');
  try {
    symlinkSync(path.join(base, 'outside', 'secret.txt'), link, 'file');
  } catch {
    t.skip('file symlinks need Developer Mode or admin rights on this Windows machine');
    return;
  }
  assert.throws(() => resolveInRoot(root, 'linked.txt'), /outside the allowed root/);
});

test('a root reached through a link still works', () => {
  const alias = path.join(base, 'alias');
  symlinkSync(root, alias, 'junction');
  assert.equal(resolveInRoot(alias, 'data'), path.join(alias, 'data'));
  assert.throws(() => resolveInRoot(alias, 'link/secret.txt'), /outside the allowed root/);
});
