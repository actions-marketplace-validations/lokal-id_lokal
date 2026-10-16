import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNik, parseNpwp, parsePhone, normalizePhone } from '../src/index.ts';
import { wilayahName } from '../src/wilayah.ts';

const ref = new Date('2026-10-15');

test('NIK: laki-laki, wilayah dari data Kemendagri', () => {
  const info = parseNik('3201011508950001', { lookupWilayah: wilayahName, referenceDate: ref });
  assert.equal(info.valid, true);
  assert.equal(info.gender, 'L');
  assert.equal(info.birthDate, '1995-08-15');
  assert.equal(info.province, 'Jawa Barat');
  assert.equal(info.regency, 'Kabupaten Bogor');
  assert.equal(info.district, 'Cibinong');
  assert.equal(info.serial, '0001');
});

test('NIK: perempuan (tanggal + 40), tahun 2000-an, spasi diabaikan', () => {
  const info = parseNik('3276 01 550803 0002', { referenceDate: ref });
  assert.equal(info.valid, true);
  assert.equal(info.gender, 'P');
  assert.equal(info.birthDate, '2003-08-15');
});

test('NIK: struktur salah ditolak dengan alasan yang jelas', () => {
  assert.deepEqual(parseNik('12345').errors.map((e) => e.code), ['format']);
  assert.ok(parseNik('9901011508950001').errors.some((e) => e.code === 'province'));
  assert.ok(parseNik('3201013108950001').valid === true);
  assert.ok(parseNik('3201013102950001').errors.some((e) => e.code === 'birth_date')); // 31 Februari
  assert.ok(parseNik('3201017508950001').errors.some((e) => e.code === 'birth_date')); // hari 75 - 40 = 35
  assert.ok(parseNik('3201011508950000').errors.some((e) => e.code === 'serial'));
});

test('NIK: kode wilayah lama memberi peringatan, bukan error', () => {
  const info = parseNik('3201991508950001', { lookupWilayah: wilayahName, referenceDate: ref });
  assert.equal(info.valid, true);
  assert.deepEqual(info.warnings.map((w) => w.code), ['wilayah_unknown']);
});

test('NPWP: format 15 digit lama', () => {
  const info = parseNpwp('01.234.567.8-901.000');
  assert.equal(info.valid, true);
  assert.equal(info.kind, 'npwp15');
  assert.equal(info.npwp16, '0012345678901000');
  assert.equal(info.formatted15, '01.234.567.8-901.000');
});

test('NPWP: 16 digit diawali 0 dan NIK sebagai NPWP', () => {
  assert.equal(parseNpwp('0012345678901000').kind, 'npwp16');
  const nik = parseNpwp('3201011508950001');
  assert.equal(nik.kind, 'nik');
  assert.equal(nik.valid, true);
  assert.equal(parseNpwp('3201011508950000').valid, false);
  assert.equal(parseNpwp('123').valid, false);
});

test('HP: berbagai cara menulis, operator, dan format', () => {
  const a = parsePhone('0812-3456-7890');
  assert.equal(a.valid, true);
  assert.equal(a.e164, '+6281234567890');
  assert.equal(a.national, '0812-3456-7890');
  assert.equal(a.whatsapp, '6281234567890');
  assert.equal(a.operator, 'Telkomsel');

  assert.equal(parsePhone('+62 857 1234 5678').operator, 'Indosat');
  assert.equal(parsePhone('6289612345678').operator, 'Tri');
  assert.equal(parsePhone('6289612345678').group, 'Indosat Ooredoo Hutchison');
  assert.equal(parsePhone('0881-2345-6789').group, 'XLSmart');
  assert.equal(normalizePhone('+62 (0) 812 3456 7890'), '+6281234567890');
});

test('Telepon rumah dan nomor tidak valid', () => {
  const home = parsePhone('(021) 555-1234');
  assert.equal(home.valid, true);
  assert.equal(home.type, 'landline');
  assert.equal(home.area, 'Jakarta');
  assert.equal(home.e164, '+62215551234');
  assert.equal(parsePhone('12345').valid, false);
  assert.equal(parsePhone('0812').valid, false);
});
