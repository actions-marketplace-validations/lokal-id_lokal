import datetime as dt

import pytest

from lokal import add_working_days, count_working_days, get_holidays, holidays_on, is_working_day

DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']

# Day names exactly as printed on setneg.go.id: catches any transcription error in the dates.
OFFICIAL_DAYS = {
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
}


def test_every_date_falls_on_the_official_weekday() -> None:
    holidays = get_holidays(2026).holidays + get_holidays(2027).holidays
    assert len(holidays) == len(OFFICIAL_DAYS)
    for h in holidays:
        assert DAYS[dt.date.fromisoformat(h.date).weekday()] == OFFICIAL_DAYS[h.date], f'{h.date} {h.name}'


def test_counts_match_the_skb() -> None:
    def count(year: int, kind: str) -> int:
        return sum(1 for h in get_holidays(year).holidays if h.type == kind)

    assert count(2026, 'libur_nasional') == 17
    assert count(2026, 'cuti_bersama') == 8
    assert count(2027, 'libur_nasional') == 18
    assert count(2027, 'cuti_bersama') == 8


def test_working_days_with_and_without_cuti_bersama() -> None:
    assert not is_working_day('2026-08-17')
    assert is_working_day('2026-08-18')
    assert not is_working_day('2026-10-17')  # Sabtu
    assert not is_working_day('2026-12-24')
    assert is_working_day('2026-12-24', cuti_bersama=False)
    assert holidays_on('2026-03-21')[0].name == 'Idulfitri 1447 H'


def test_sla_skips_lebaran() -> None:
    # Kamis 19 Mar 2026 Nyepi, then cuti and libur Idulfitri until Selasa 24 Mar.
    assert add_working_days('2026-03-17', 1) == '2026-03-25'
    assert add_working_days('2026-03-25', -1) == '2026-03-17'
    assert count_working_days('2026-03-16', '2026-03-27') == 5


def test_date_objects_in_date_objects_out() -> None:
    assert add_working_days(dt.date(2026, 3, 17), 1) == dt.date(2026, 3, 25)
    # A datetime counts as the date it shows in its own timezone (06:00 WIB on Nyepi is still Nyepi).
    wib = dt.timezone(dt.timedelta(hours=7))
    assert not is_working_day(dt.datetime(2026, 3, 19, 6, 0, tzinfo=wib))
    assert is_working_day('2026-08-15', weekend=[0])  # a Saturday at a six-day office
    assert count_working_days(dt.date(2026, 3, 16), '2026-03-27') == 5


def test_years_without_official_data_fail_loudly() -> None:
    with pytest.raises(ValueError, match='belum tersedia'):
        is_working_day('2028-01-03')
    with pytest.raises(ValueError, match='belum tersedia'):
        get_holidays(2025)


def test_dates_that_do_not_exist_are_rejected() -> None:
    with pytest.raises(ValueError, match='tidak valid'):
        is_working_day('2026-02-30')
    with pytest.raises(ValueError, match='tidak valid'):
        add_working_days('2026-13-01', 1)
    with pytest.raises(ValueError, match='YYYY-MM-DD'):
        is_working_day('17-08-2026')
