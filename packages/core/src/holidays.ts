// Libur nasional and cuti bersama, from the yearly SKB 3 Menteri (Menteri Agama, Menteri
// Ketenagakerjaan, Menteri PANRB) as published by Kementerian Sekretariat Negara.
// Islamic holiday dates can still be adjusted by the Menteri Agama's sidang isbat.

export type HolidayType = 'libur_nasional' | 'cuti_bersama';

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  type: HolidayType;
}

interface YearData {
  decree: string;
  source: string;
  holidays: Holiday[];
}

const L = 'libur_nasional' as const;
const C = 'cuti_bersama' as const;

const DATA: Record<number, YearData> = {
  2026: {
    decree: 'SKB Nomor 1497 Tahun 2025, Nomor 2 Tahun 2025, Nomor 5 Tahun 2025',
    source: 'https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026',
    holidays: [
      { date: '2026-01-01', name: 'Tahun Baru 2026 Masehi', type: L },
      { date: '2026-01-16', name: 'Isra Mikraj Nabi Muhammad saw.', type: L },
      { date: '2026-02-16', name: 'Tahun Baru Imlek 2577 Kongzili', type: C },
      { date: '2026-02-17', name: 'Tahun Baru Imlek 2577 Kongzili', type: L },
      { date: '2026-03-18', name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)', type: C },
      { date: '2026-03-19', name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)', type: L },
      { date: '2026-03-20', name: 'Idulfitri 1447 H', type: C },
      { date: '2026-03-21', name: 'Idulfitri 1447 H', type: L },
      { date: '2026-03-22', name: 'Idulfitri 1447 H', type: L },
      { date: '2026-03-23', name: 'Idulfitri 1447 H', type: C },
      { date: '2026-03-24', name: 'Idulfitri 1447 H', type: C },
      { date: '2026-04-03', name: 'Wafat Yesus Kristus', type: L },
      { date: '2026-04-05', name: 'Kebangkitan Yesus Kristus (Paskah)', type: L },
      { date: '2026-05-01', name: 'Hari Buruh Internasional', type: L },
      { date: '2026-05-14', name: 'Kenaikan Yesus Kristus', type: L },
      { date: '2026-05-15', name: 'Kenaikan Yesus Kristus', type: C },
      { date: '2026-05-27', name: 'Iduladha 1447 H', type: L },
      { date: '2026-05-28', name: 'Iduladha 1447 H', type: C },
      { date: '2026-05-31', name: 'Hari Raya Waisak 2570 BE', type: L },
      { date: '2026-06-01', name: 'Hari Lahir Pancasila', type: L },
      { date: '2026-06-16', name: '1 Muharam Tahun Baru Islam 1448 H', type: L },
      { date: '2026-08-17', name: 'Proklamasi Kemerdekaan', type: L },
      { date: '2026-08-25', name: 'Maulid Nabi Muhammad saw.', type: L },
      { date: '2026-12-24', name: 'Kelahiran Yesus Kristus', type: C },
      { date: '2026-12-25', name: 'Kelahiran Yesus Kristus', type: L },
    ],
  },
  2027: {
    decree: 'SKB Nomor 1205 Tahun 2026, Nomor 3 Tahun 2026, Nomor 2 Tahun 2026',
    source: 'https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2027',
    holidays: [
      { date: '2027-01-01', name: 'Tahun Baru 2027 Masehi', type: L },
      { date: '2027-01-05', name: 'Isra Mikraj Nabi Muhammad saw.', type: L },
      { date: '2027-02-05', name: 'Tahun Baru Imlek 2578 Kongzili', type: C },
      { date: '2027-02-06', name: 'Tahun Baru Imlek 2578 Kongzili', type: L },
      { date: '2027-03-08', name: 'Hari Suci Nyepi (Tahun Baru Saka 1949)', type: L },
      { date: '2027-03-09', name: 'Idulfitri 1448 H', type: C },
      { date: '2027-03-10', name: 'Idulfitri 1448 H', type: L },
      { date: '2027-03-11', name: 'Idulfitri 1448 H', type: L },
      { date: '2027-03-12', name: 'Idulfitri 1448 H', type: C },
      { date: '2027-03-15', name: 'Idulfitri 1448 H', type: C },
      { date: '2027-03-25', name: 'Wafat Yesus Kristus', type: C },
      { date: '2027-03-26', name: 'Wafat Yesus Kristus', type: L },
      { date: '2027-03-28', name: 'Kebangkitan Yesus Kristus (Paskah)', type: L },
      { date: '2027-05-01', name: 'Hari Buruh Internasional', type: L },
      { date: '2027-05-06', name: 'Kenaikan Yesus Kristus', type: L },
      { date: '2027-05-17', name: 'Iduladha 1448 H', type: L },
      { date: '2027-05-18', name: 'Iduladha 1448 H', type: C },
      { date: '2027-05-19', name: 'Hari Raya Waisak 2571 BE', type: C },
      { date: '2027-05-20', name: 'Hari Raya Waisak 2571 BE', type: L },
      { date: '2027-06-01', name: 'Hari Lahir Pancasila', type: L },
      { date: '2027-06-06', name: '1 Muharam Tahun Baru Islam 1449 H', type: L },
      { date: '2027-08-15', name: 'Maulid Nabi Muhammad saw.', type: L },
      { date: '2027-08-17', name: 'Proklamasi Kemerdekaan', type: L },
      { date: '2027-12-24', name: 'Kelahiran Yesus Kristus', type: C },
      { date: '2027-12-25', name: 'Kelahiran Yesus Kristus', type: L },
      { date: '2027-12-26', name: 'Isra Mikraj Nabi Muhammad saw.', type: L },
    ],
  },
};

/** Years with official data. Anything else throws instead of silently assuming no holidays. */
export const HOLIDAY_YEARS: readonly number[] = Object.keys(DATA).map(Number);

function toIsoDate(date: string | Date): string {
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`Tanggal harus berformat YYYY-MM-DD: ${date}`);
  return date;
}

function yearData(year: number): YearData {
  const data = DATA[year];
  if (!data) {
    throw new RangeError(
      `Data libur tahun ${year} belum tersedia (tersedia: ${HOLIDAY_YEARS.join(', ')}). SKB 3 Menteri biasanya terbit sekitar September tahun sebelumnya.`,
    );
  }
  return data;
}

export interface HolidayYear {
  year: number;
  decree: string;
  source: string;
  holidays: Holiday[];
}

/** All libur nasional and cuti bersama in a year. Throws for years without official data. */
export function getHolidays(year: number): HolidayYear {
  const { decree, source, holidays } = yearData(year);
  return { year, decree, source, holidays: holidays.map((h) => ({ ...h })) };
}

/** Holidays on a date (a date can be both, rarely). */
export function holidaysOn(date: string | Date): Holiday[] {
  const iso = toIsoDate(date);
  return yearData(Number(iso.slice(0, 4))).holidays.filter((h) => h.date === iso);
}

export interface WorkingDayOptions {
  /**
   * Treat cuti bersama as days off. Default true (government and most offices).
   * For private companies cuti bersama is optional and taken from annual leave.
   */
  cutiBersama?: boolean;
  /** Days of the week that are off: 0 = Minggu … 6 = Sabtu. Default [0, 6]. */
  weekend?: number[];
}

export function isWorkingDay(date: string | Date, options: WorkingDayOptions = {}): boolean {
  const iso = toIsoDate(date);
  const { cutiBersama = true, weekend = [0, 6] } = options;
  if (weekend.includes(new Date(`${iso}T00:00:00Z`).getUTCDay())) return false;
  return !holidaysOn(iso).some((h) => h.type === 'libur_nasional' || cutiBersama);
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The date `n` working days after (or before, if negative) `date`. SLA and delivery estimates. */
export function addWorkingDays(date: string | Date, n: number, options: WorkingDayOptions = {}): string {
  let iso = toIsoDate(date);
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0; ) {
    iso = shift(iso, step);
    if (isWorkingDay(iso, options)) left--;
  }
  return iso;
}

/** Working days from `from` to `to`, both inclusive. */
export function countWorkingDays(from: string | Date, to: string | Date, options: WorkingDayOptions = {}): number {
  let iso = toIsoDate(from);
  const end = toIsoDate(to);
  let count = 0;
  for (; iso <= end; iso = shift(iso, 1)) if (isWorkingDay(iso, options)) count++;
  return count;
}
