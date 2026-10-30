import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPii, partialMask, Samaran, type CustomRule } from '../src/index.ts';
import { Kembaran } from '../src/kembaran.ts';

const RULES: CustomRule[] = [
  { label: 'EMPLOYEE_ID', pattern: String.raw`\bEMP-\d{6}\b` },
  { label: 'MEMBER', fields: ['no_member', 'Kode Member'] },
];

test('custom patterns mask under their own label and restore', () => {
  const s = new Samaran({ custom: RULES });
  const text = 'Tiket dari EMP-004211 soal EMP-000317, lalu EMP-004211 lagi. emp-004211 huruf kecil tidak cocok.';
  const { text: masked, matches } = s.mask(text);
  assert.equal(masked, 'Tiket dari [EMPLOYEE_ID_1] soal [EMPLOYEE_ID_2], lalu [EMPLOYEE_ID_1] lagi. emp-004211 huruf kecil tidak cocok.');
  assert.deepEqual(matches.map((m) => [m.type, m.label, m.confidence]), [
    ['CUSTOM', 'EMPLOYEE_ID', 'high'], ['CUSTOM', 'EMPLOYEE_ID', 'high'], ['CUSTOM', 'EMPLOYEE_ID', 'high'],
  ]);
  assert.equal(s.unmask(masked), text);
});

test('custom fields: labels, JSON keys, and CSV columns', () => {
  const s = new Samaran({ custom: RULES });
  const text = [
    'member no_member=M-0042 minta reset.',
    '{"no_member": "M-0099", "nik": "3201011508950001"}',
    'kode member: M-1234',
    '',
    'nama,Kode Member,kota',
    'Siti Aminah,"M, 77",Bogor',
    'Budi Santoso,M-0042,Depok',
    '',
    'kota,catatan',
    'Depok,M-5555 bukan kolom member',
  ].join('\n');
  const { text: masked } = s.mask(text);
  assert.equal(
    masked,
    [
      'member no_member=[MEMBER_1] minta reset.',
      '{"no_member": "[MEMBER_2]", "nik": "[NIK_1]"}',
      'kode member: [MEMBER_3]',
      '',
      'nama,Kode Member,kota',
      '[NAME_1],"[MEMBER_4]",Bogor',
      '[NAME_2],[MEMBER_1],Depok',
      '',
      'kota,catatan',
      'Depok,M-5555 bukan kolom member',
    ].join('\n'),
  );
  assert.equal(s.unmask(masked), text);
});

test('a custom rule does not cut a built-in match short', () => {
  // A pattern for six digits would split a phone number; the longer built-in match wins.
  const found = detectPii('HP 0812-3456-7890', { custom: [{ label: 'SHORT_CODE', pattern: String.raw`\d{4}-\d{4}` }] });
  assert.deepEqual(found.map((m) => m.type), ['PHONE']);
  // The same span: the team's rule wins.
  const own = detectPii('no_member: 3201011508950001', { custom: [{ label: 'MEMBER', fields: ['no_member'] }] });
  assert.deepEqual(own.map((m) => [m.type, m.label]), [['CUSTOM', 'MEMBER']]);
});

test('custom placeholders survive export and import of the vault', () => {
  const a = new Samaran({ custom: RULES });
  a.mask('EMP-004211 dan EMP-000317');
  const b = new Samaran({ custom: RULES });
  b.importVault(a.exportVault());
  assert.equal(b.mask('EMP-000317, EMP-123456').text, '[EMPLOYEE_ID_2], [EMPLOYEE_ID_3]');
  assert.equal(b.unmask('[EMPLOYEE_ID_1]'), 'EMP-004211');
  assert.equal(b.placeholder('CUSTOM', 'EMP-004211', 'EMPLOYEE_ID'), '[EMPLOYEE_ID_1]');
});

test('partial masks and stand-ins for custom values', () => {
  assert.equal(partialMask('CUSTOM', 'EMP-004211'), '********11');
  assert.equal(partialMask('CUSTOM', 'M-42'), '***');
  assert.equal(new Samaran({ custom: RULES, mode: 'partial' }).mask('id EMP-004211').text, 'id ********11');
  const k = new Kembaran({ secret: 'uji', custom: RULES });
  const { text, replaced } = k.text('id EMP-004211, no_member: M-0042');
  assert.match(text, /^id [A-Z]{3}-\d{6}, no_member: [A-Z]-\d{4}$/);
  assert.ok(!text.includes('EMP-004211') && !text.includes('M-0042'));
  assert.equal(replaced.CUSTOM, 2);
});

test('rules that cannot work are refused', () => {
  const bad: Array<[CustomRule, RegExp]> = [
    [{ label: 'employee', pattern: 'x' }, /capital letters/],
    [{ label: 'NIK', pattern: 'x' }, /built-in type/],
    [{ label: 'EMP_', pattern: 'x' }, /capital letters/],
    [{ label: 'EMP', pattern: '(' }, /does not compile/],
    [{ label: 'EMP' }, /needs a pattern or fields/],
  ];
  for (const [rule, why] of bad) assert.throws(() => new Samaran({ custom: [rule] }), why);
  assert.throws(() => new Samaran().placeholder('CUSTOM', 'x'), /capital letters/);
  assert.throws(() => new Samaran().placeholder('NIK', '3201011508950001', 'EMP'), /only used with the CUSTOM type/);
});
