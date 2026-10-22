import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Samaran } from '../../core/src/samaran/index.ts';
import { describe, findPlaceholders, pickLang, restore, restoreHtml } from '../src/shared.ts';
import { MATCHES, SITES } from '../src/sites.ts';

// A vault the way the service worker builds it.
const samaran = new Samaran();
const { text: masked, matches } = samaran.mask('Nama: Budi Santoso, NIK 3201011508950001, HP 0812-3456-7890');
const vault = new Map(samaran.exportVault());

test('restore puts back known placeholders and leaves the rest', () => {
  assert.equal(masked, 'Nama: [NAME_1], NIK [NIK_1], HP [PHONE_1]');
  assert.equal(restore(`${masked} [NIK_9] [nik_1]`, vault), 'Nama: Budi Santoso, NIK 3201011508950001, HP 0812-3456-7890 [NIK_9] [nik_1]');
});

test('restoreHtml escapes values, so a value cannot become markup', () => {
  const html = new Map([['[NAME_1]', '<img src=x onerror=alert(1)> & "Budi"']]);
  assert.equal(restoreHtml('<p>[NAME_1]</p>', html), '<p>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Budi&quot;</p>');
});

test('findPlaceholders reports positions of known placeholders only', () => {
  assert.deepEqual(findPlaceholders('NIK [NIK_1] dan [NIK_2]', vault), [[4, 11, '[NIK_1]']]);
});

test('describe counts types without values, in the UI language', () => {
  assert.equal(describe(matches.map((m) => m.type), 'id'), '1 nama, 1 NIK, 1 nomor HP');
  assert.equal(describe(['PHONE', 'NIK', 'PHONE'], 'en'), '2 phone number, 1 NIK');
  assert.equal(pickLang('id-ID'), 'id');
  assert.equal(pickLang('en-US'), 'en');
});

test('every site is matched over HTTPS only, and the popup copy names them all', () => {
  assert.ok(MATCHES.every((m) => /^https:\/\/[a-z.]+\/\*$/.test(m)));
  const popup = readFileSync(new URL('../src/popup.ts', import.meta.url), 'utf8');
  for (const site of SITES) assert.ok(popup.includes(site.name.replace('Microsoft ', '')), site.name);
});
