import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQris, qrisCrc, setQrisAmount } from '../src/index.ts';

// A made-up merchant. Real QRIS payloads name real businesses; tests should not.
const f = (tag: string, value: string) => tag + String(value.length).padStart(2, '0') + value;
const body = (fields: string) => `${fields}6304`;
const withCrc = (fields: string) => body(fields) + qrisCrc(body(fields));
const ACCOUNT = f('26', f('00', 'COM.CONTOH.WWW') + f('01', '936000000000000001') + f('02', '000000000000001') + f('03', 'UMI'));
const NATIONAL = f('51', f('00', 'ID.CO.QRIS.WWW') + f('02', 'ID1026000000001') + f('03', 'UMI'));
const MERCHANT = f('52', '5812') + f('53', '360') + f('58', 'ID') + f('59', 'KOPI CONTOH') + f('60', 'BOGOR') + f('61', '16914');
const STATIC = withCrc(f('00', '01') + f('01', '11') + ACCOUNT + NATIONAL + MERCHANT + f('62', f('01', 'INV-77') + f('07', 'A01')));

test('CRC-16/CCITT-FALSE', () => {
  assert.equal(qrisCrc('123456789'), '29B1'); // the standard check value
  assert.equal(qrisCrc(''), 'FFFF');
});

test('QRIS statis dibaca lengkap', () => {
  const info = parseQris(`  ${STATIC}\n`);
  assert.equal(info.valid, true, JSON.stringify(info.errors));
  assert.deepEqual(info.warnings, []);
  assert.equal(info.type, 'static');
  assert.equal(info.merchantName, 'KOPI CONTOH');
  assert.equal(info.merchantCity, 'BOGOR');
  assert.equal(info.postalCode, '16914');
  assert.equal(info.nmid, 'ID1026000000001');
  assert.equal(info.criteria, 'UMI');
  assert.equal(info.criteriaLabel, 'Usaha Mikro');
  assert.equal(info.mcc, '5812');
  assert.equal(info.amount, undefined);
  assert.deepEqual(info.accounts, [
    { tag: '26', gui: 'COM.CONTOH.WWW', pan: '936000000000000001', merchantId: '000000000000001', criteria: 'UMI' },
    { tag: '51', gui: 'ID.CO.QRIS.WWW', merchantId: 'ID1026000000001', criteria: 'UMI' },
  ]);
  assert.deepEqual(info.additional, { billNumber: 'INV-77', terminalLabel: 'A01' });
});

test('QRIS statis menjadi dinamis dengan nominal, field lain tetap', () => {
  const dynamic = setQrisAmount(STATIC, 25000);
  const info = parseQris(dynamic);
  assert.equal(info.valid, true, JSON.stringify(info.errors));
  assert.equal(info.type, 'dynamic');
  assert.equal(info.amount, '25000');
  assert.equal(info.nmid, 'ID1026000000001');
  assert.ok(dynamic.includes('5303360540525000' + '5802ID'), 'the amount sits between currency and country');
  // Same merchant: everything but tags 01, 54, and 63 is unchanged.
  const strip = (s: string) => parseQris(s).fields.filter((x) => !['01', '54', '63'].includes(x.tag));
  assert.deepEqual(strip(dynamic), strip(STATIC));
  // Setting another amount on a dynamic code replaces it.
  assert.equal(parseQris(setQrisAmount(dynamic, '1500.50')).amount, '1500.50');

  const fixed = parseQris(setQrisAmount(STATIC, 100000, { tip: { fixed: 2500 } }));
  assert.deepEqual([fixed.amount, fixed.tip], ['100000', { kind: 'fixed', value: '2500' }]);
  const percent = parseQris(setQrisAmount(STATIC, 100000, { tip: { percent: 0.7 } }));
  assert.deepEqual(percent.tip, { kind: 'percent', value: '0.70' });

  for (const bad of [0, -5, 1.234, '12,000', '1e5', '12345678901234']) {
    assert.throws(() => setQrisAmount(STATIC, bad as number), RangeError, String(bad));
  }
  assert.throws(() => setQrisAmount(STATIC, 1000, { tip: { percent: 150 } }), RangeError);
  assert.throws(() => setQrisAmount(STATIC.slice(0, -1) + '0', 1000), /CRC tidak cocok/);
});

test('QRIS rusak dan yang bukan QRIS dikenali', () => {
  const crc = parseQris(STATIC.slice(0, -4) + '0000');
  assert.equal(crc.valid, false);
  assert.match(crc.errors[0]!.message, /CRC tidak cocok: tertulis 0000, seharusnya [0-9A-F]{4}/);

  assert.match(parseQris(STATIC.slice(0, 60)).errors[0]!.message, /tidak terbaca di posisi/);
  assert.equal(parseQris('').errors[0]!.code, 'payload_format');
  assert.equal(parseQris('https://example.com').errors[0]!.code, 'format');

  const usd = parseQris(withCrc(f('00', '01') + f('01', '11') + NATIONAL + MERCHANT.replace('5303360', '5303840')));
  assert.deepEqual(usd.errors.map((e) => e.code), ['currency']);

  const longName = parseQris(withCrc(f('00', '01') + NATIONAL + MERCHANT.replace(f('59', 'KOPI CONTOH'), f('59', 'WARUNG KOPI CONTOH SEJAHTERA'))));
  assert.deepEqual(longName.errors.map((e) => e.code), ['merchant_name']);

  // An EMVCo merchant code from another network: readable, but flagged.
  const other = parseQris(withCrc(f('00', '01') + f('01', '12') + ACCOUNT + MERCHANT));
  assert.equal(other.valid, true);
  assert.deepEqual(other.warnings.map((w) => w.code), ['not_qris', 'dynamic_without_amount']);

  const tip = parseQris(withCrc(f('00', '01') + NATIONAL + MERCHANT + f('55', '02')));
  assert.deepEqual(tip.errors.map((e) => e.code), ['tip']);
  const dup = parseQris(withCrc(f('00', '01') + NATIONAL + MERCHANT + f('53', '360')));
  assert.ok(dup.errors.some((e) => e.code === 'duplicate'));
});
