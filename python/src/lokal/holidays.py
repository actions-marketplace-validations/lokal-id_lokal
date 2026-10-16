"""Libur nasional and cuti bersama, from the yearly SKB 3 Menteri (Menteri Agama, Menteri Ketenagakerjaan, Menteri
PANRB) as published by Kementerian Sekretariat Negara. Islamic holiday dates can still be adjusted by the Menteri
Agama's sidang isbat.
"""

from __future__ import annotations

import datetime as _dt
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal, Union, overload

from ._result import Result

HolidayType = Literal['libur_nasional', 'cuti_bersama']
DateLike = Union[str, _dt.date]


@dataclass(slots=True, frozen=True)
class Holiday(Result):
    #: YYYY-MM-DD
    date: str
    name: str
    type: HolidayType


@dataclass(slots=True)
class HolidayYear(Result):
    year: int
    decree: str
    source: str
    holidays: list[Holiday] = field(default_factory=list)


_L: HolidayType = 'libur_nasional'
_C: HolidayType = 'cuti_bersama'

_DATA: dict[int, tuple[str, str, list[tuple[str, str, HolidayType]]]] = {
    2026: (
        'SKB Nomor 1497 Tahun 2025, Nomor 2 Tahun 2025, Nomor 5 Tahun 2025',
        'https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026',
        [
            ('2026-01-01', 'Tahun Baru 2026 Masehi', _L),
            ('2026-01-16', 'Isra Mikraj Nabi Muhammad saw.', _L),
            ('2026-02-16', 'Tahun Baru Imlek 2577 Kongzili', _C),
            ('2026-02-17', 'Tahun Baru Imlek 2577 Kongzili', _L),
            ('2026-03-18', 'Hari Suci Nyepi (Tahun Baru Saka 1948)', _C),
            ('2026-03-19', 'Hari Suci Nyepi (Tahun Baru Saka 1948)', _L),
            ('2026-03-20', 'Idulfitri 1447 H', _C),
            ('2026-03-21', 'Idulfitri 1447 H', _L),
            ('2026-03-22', 'Idulfitri 1447 H', _L),
            ('2026-03-23', 'Idulfitri 1447 H', _C),
            ('2026-03-24', 'Idulfitri 1447 H', _C),
            ('2026-04-03', 'Wafat Yesus Kristus', _L),
            ('2026-04-05', 'Kebangkitan Yesus Kristus (Paskah)', _L),
            ('2026-05-01', 'Hari Buruh Internasional', _L),
            ('2026-05-14', 'Kenaikan Yesus Kristus', _L),
            ('2026-05-15', 'Kenaikan Yesus Kristus', _C),
            ('2026-05-27', 'Iduladha 1447 H', _L),
            ('2026-05-28', 'Iduladha 1447 H', _C),
            ('2026-05-31', 'Hari Raya Waisak 2570 BE', _L),
            ('2026-06-01', 'Hari Lahir Pancasila', _L),
            ('2026-06-16', '1 Muharam Tahun Baru Islam 1448 H', _L),
            ('2026-08-17', 'Proklamasi Kemerdekaan', _L),
            ('2026-08-25', 'Maulid Nabi Muhammad saw.', _L),
            ('2026-12-24', 'Kelahiran Yesus Kristus', _C),
            ('2026-12-25', 'Kelahiran Yesus Kristus', _L),
        ],
    ),
    2027: (
        'SKB Nomor 1205 Tahun 2026, Nomor 3 Tahun 2026, Nomor 2 Tahun 2026',
        'https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2027',
        [
            ('2027-01-01', 'Tahun Baru 2027 Masehi', _L),
            ('2027-01-05', 'Isra Mikraj Nabi Muhammad saw.', _L),
            ('2027-02-05', 'Tahun Baru Imlek 2578 Kongzili', _C),
            ('2027-02-06', 'Tahun Baru Imlek 2578 Kongzili', _L),
            ('2027-03-08', 'Hari Suci Nyepi (Tahun Baru Saka 1949)', _L),
            ('2027-03-09', 'Idulfitri 1448 H', _C),
            ('2027-03-10', 'Idulfitri 1448 H', _L),
            ('2027-03-11', 'Idulfitri 1448 H', _L),
            ('2027-03-12', 'Idulfitri 1448 H', _C),
            ('2027-03-15', 'Idulfitri 1448 H', _C),
            ('2027-03-25', 'Wafat Yesus Kristus', _C),
            ('2027-03-26', 'Wafat Yesus Kristus', _L),
            ('2027-03-28', 'Kebangkitan Yesus Kristus (Paskah)', _L),
            ('2027-05-01', 'Hari Buruh Internasional', _L),
            ('2027-05-06', 'Kenaikan Yesus Kristus', _L),
            ('2027-05-17', 'Iduladha 1448 H', _L),
            ('2027-05-18', 'Iduladha 1448 H', _C),
            ('2027-05-19', 'Hari Raya Waisak 2571 BE', _C),
            ('2027-05-20', 'Hari Raya Waisak 2571 BE', _L),
            ('2027-06-01', 'Hari Lahir Pancasila', _L),
            ('2027-06-06', '1 Muharam Tahun Baru Islam 1449 H', _L),
            ('2027-08-15', 'Maulid Nabi Muhammad saw.', _L),
            ('2027-08-17', 'Proklamasi Kemerdekaan', _L),
            ('2027-12-24', 'Kelahiran Yesus Kristus', _C),
            ('2027-12-25', 'Kelahiran Yesus Kristus', _L),
            ('2027-12-26', 'Isra Mikraj Nabi Muhammad saw.', _L),
        ],
    ),
}

#: Years with official data. Anything else raises instead of silently assuming no holidays.
HOLIDAY_YEARS: tuple[int, ...] = tuple(_DATA)

_ISO = re.compile(r'([0-9]{4})-([0-9]{2})-([0-9]{2})')


def _to_date(date: DateLike) -> _dt.date:
    # A datetime counts as the calendar date it shows, in its own timezone.
    if isinstance(date, _dt.datetime):
        return date.date()
    if isinstance(date, _dt.date):
        return date
    if not isinstance(date, str) or not _ISO.fullmatch(date):
        raise ValueError(f'Tanggal harus berformat YYYY-MM-DD: {date}')
    try:
        return _dt.date.fromisoformat(date)
    except ValueError:
        # `new Date('2026-02-30')` quietly becomes 2 March; a date that does not exist is an error instead.
        raise ValueError(f'Tanggal tidak valid: {date}') from None


def _year_data(year: int) -> tuple[str, str, list[tuple[str, str, HolidayType]]]:
    data = _DATA.get(year)
    if data is None:
        available = ', '.join(str(y) for y in HOLIDAY_YEARS)
        raise ValueError(
            f'Data libur tahun {year} belum tersedia (tersedia: {available}). '
            'SKB 3 Menteri biasanya terbit sekitar September tahun sebelumnya.'
        )
    return data


def get_holidays(year: int) -> HolidayYear:
    """All libur nasional and cuti bersama in a year. Raises ValueError for years without official data."""
    decree, source, holidays = _year_data(year)
    return HolidayYear(year, decree, source, [Holiday(d, n, t) for d, n, t in holidays])


def holidays_on(date: DateLike) -> list[Holiday]:
    """Holidays on a date (a date can be both, rarely)."""
    iso = _to_date(date).isoformat()
    return [Holiday(d, n, t) for d, n, t in _year_data(int(iso[:4]))[2] if d == iso]


def _js_weekday(d: _dt.date) -> int:
    """0 = Minggu … 6 = Sabtu, like JavaScript's getUTCDay."""
    return (d.weekday() + 1) % 7


def is_working_day(date: DateLike, *, cuti_bersama: bool = True, weekend: Iterable[int] = (0, 6)) -> bool:
    """Whether a date is a working day.

    ``cuti_bersama=True`` (default) treats cuti bersama as days off, as government and most offices do. For private
    companies cuti bersama is optional and taken from annual leave. ``weekend`` lists the days that are off,
    0 = Minggu … 6 = Sabtu.
    """
    d = _to_date(date)
    if _js_weekday(d) in tuple(weekend):
        return False
    return not any(h.type == 'libur_nasional' or cuti_bersama for h in holidays_on(d))


@overload
def add_working_days(date: str, n: int, *, cuti_bersama: bool = ..., weekend: Iterable[int] = ...) -> str: ...
@overload
def add_working_days(
    date: _dt.date, n: int, *, cuti_bersama: bool = ..., weekend: Iterable[int] = ...
) -> _dt.date: ...
def add_working_days(
    date: DateLike, n: int, *, cuti_bersama: bool = True, weekend: Iterable[int] = (0, 6)
) -> DateLike:
    """The date ``n`` working days after (or before, if negative) ``date``. SLA and delivery estimates.

    Returns an ISO string for a string input and a ``date`` for a ``date``/``datetime`` input.
    """
    d = _to_date(date)
    off = tuple(weekend)
    step = _dt.timedelta(days=-1 if n < 0 else 1)
    left = abs(n)
    while left > 0:
        d += step
        if is_working_day(d, cuti_bersama=cuti_bersama, weekend=off):
            left -= 1
    return d.isoformat() if isinstance(date, str) else d


def count_working_days(
    start: DateLike, end: DateLike, *, cuti_bersama: bool = True, weekend: Iterable[int] = (0, 6)
) -> int:
    """Working days from ``start`` to ``end``, both inclusive."""
    d = _to_date(start)
    last = _to_date(end)
    off = tuple(weekend)
    count = 0
    while d <= last:
        if is_working_day(d, cuti_bersama=cuti_bersama, weekend=off):
            count += 1
        d += _dt.timedelta(days=1)
    return count
