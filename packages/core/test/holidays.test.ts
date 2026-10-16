import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWorkingDays, countWorkingDays, getHolidays, holidaysOn, isWorkingDay } from '../src/index.ts';

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const dayOf = (iso: string) => DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

// Day names exactly as printed on setneg.go.id: catches any transcription error in the dates.
const OFFICIAL_DAYS: Record<string, string> = {
  '2026-01-01': 'Kamis', '2026-01-16': 'Jumat', '2026-02-16': 'Senin', '2026-02-17': 'Selasa',
  '2026-03-18': 'Rabu', '2026-03-19': 'Kamis', '2026-03-20': 'Jumat', '2026-03-21': 'Sabtu',
  '2026-03-22': 'Minggu', '2026-03-23': 'Senin', '2026-03-24': 'Selasa', '2026-04-03': 'Jumat',
  '2026-04-05': 'Minggu', '2026-05-01': 'Jumat', '2026-05-14': 'Kamis', '2026-05-15': 'Jumat',
  '2026-05-27': 'Rabu', '2026-05-28': 'Kamis', '2026-05-31': 'Minggu', '2026-06-01': 'Senin',
  '2026-06-16': 'Selasa', '2026-08-17': 'Senin', '2026-08-25': 'Selasa', '2026-12-24': 'Kamis',
  '2026-12-25': 'Jumat',
  '2027-01-01': 'Jumat', '2027-01-05': 'Selasa', '2027-02-05': 'Jumat', '2027-02-06': 'Sabtu',
  '2027-03-08': 'Senin', '2027-03-09': 'Selasa', '2027-03-10': 'Rabu', '2027-03-11': 'Kamis',
  '2027-03-12': 'Jumat', '2027-03-15': 'Senin', '2027-03-25': 'Kamis', '2027-03-26': 'Jumat',
  '2027-03-28': 'Minggu', '2027-05-01': 'Sabtu', '2027-05-06': 'Kamis', '2027-05-17': 'Senin',
  '2027-05-18': 'Selasa', '2027-05-19': 'Rabu', '2027-05-20': 'Kamis', '2027-06-01': 'Selasa',
  '2027-06-06': 'Minggu', '2027-08-15': 'Minggu', '2027-08-17': 'Selasa', '2027-12-24': 'Jumat',
  '2027-12-25': 'Sabtu', '2027-12-26': 'Minggu',
};

test('setiap tanggal jatuh pada hari yang tertulis di pengumuman resmi', () => {
  const all = [...getHolidays(2026).holidays, ...getHolidays(2027).holidays];
  assert.equal(all.length, Object.keys(OFFICIAL_DAYS).length);
  for (const h of all) assert.equal(dayOf(h.date), OFFICIAL_DAYS[h.date], `${h.date} ${h.name}`);
});

test('jumlah sesuai SKB: 2026 = 17 libur + 8 cuti, 2027 = 18 libur + 8 cuti', () => {
  const count = (year: number, type: string) => getHolidays(year).holidays.filter((h) => h.type === type).length;
  assert.equal(count(2026, 'libur_nasional'), 17);
  assert.equal(count(2026, 'cuti_bersama'), 8);
  assert.equal(count(2027, 'libur_nasional'), 18);
  assert.equal(count(2027, 'cuti_bersama'), 8);
});

test('hari kerja, dengan dan tanpa cuti bersama', () => {
  assert.equal(isWorkingDay('2026-08-17'), false);
  assert.equal(isWorkingDay('2026-08-18'), true);
  assert.equal(isWorkingDay('2026-10-17'), false); // Sabtu
  assert.equal(isWorkingDay('2026-12-24'), false);
  assert.equal(isWorkingDay('2026-12-24', { cutiBersama: false }), true);
  assert.equal(holidaysOn('2026-03-21')[0]?.name, 'Idulfitri 1447 H');
});

test('SLA hari kerja melewati libur Lebaran', () => {
  // Kamis 19 Mar 2026 Nyepi, lalu cuti dan libur Idulfitri sampai Selasa 24 Mar.
  assert.equal(addWorkingDays('2026-03-17', 1), '2026-03-25');
  assert.equal(addWorkingDays('2026-03-25', -1), '2026-03-17');
  assert.equal(countWorkingDays('2026-03-16', '2026-03-27'), 5);
});

test('tahun tanpa data resmi gagal dengan jelas, bukan diam-diam', () => {
  assert.throws(() => isWorkingDay('2028-01-03'), /belum tersedia/);
  assert.throws(() => getHolidays(2025), /belum tersedia/);
});
