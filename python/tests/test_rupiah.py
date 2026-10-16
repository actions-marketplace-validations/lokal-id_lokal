from decimal import Decimal

import pytest

from lokal import ParsedRupiah, format_rupiah, format_rupiah_short, parse_rupiah, terbilang


def test_format_rupiah_puebi() -> None:
    assert format_rupiah(1500000) == 'Rp1.500.000'
    assert format_rupiah(0) == 'Rp0'
    assert format_rupiah(-25000) == '-Rp25.000'
    assert format_rupiah(1500000.5, decimals=True) == 'Rp1.500.000,50'
    assert format_rupiah(999, symbol=False) == '999'


def test_format_rupiah_short() -> None:
    assert format_rupiah_short(1500000) == 'Rp1,5 jt'
    assert format_rupiah_short(2300000000) == 'Rp2,3 M'
    assert format_rupiah_short(15000) == 'Rp15 rb'
    assert format_rupiah_short(750) == 'Rp750'


def test_rounding_across_units_and_huge_numbers() -> None:
    assert format_rupiah_short(999999) == 'Rp1 jt'
    assert format_rupiah_short(999.96) == 'Rp1 rb'
    assert format_rupiah_short(950000) == 'Rp950 rb'
    assert format_rupiah(1e21) == 'Rp1.000.000.000.000.000.000.000'
    assert format_rupiah(0.125, decimals=True) == 'Rp0,13'
    assert format_rupiah(2.5) == 'Rp3'  # half up like Math.round, not Python's half to even


def test_decimal_from_the_database_is_exact() -> None:
    assert format_rupiah(Decimal('1500000.505'), decimals=True) == 'Rp1.500.000,51'
    assert format_rupiah(Decimal('12345678901234567890.99')) == 'Rp12.345.678.901.234.567.891'
    assert format_rupiah_short(Decimal('2300000000')) == 'Rp2,3 M'
    with pytest.raises(TypeError):
        format_rupiah(True)
    with pytest.raises(ValueError):
        format_rupiah(float('nan'))


CASES = [
    ('Rp 25.000', 25000, False),
    ('Rp1.500.000,00', 1500000, False),
    ('1,500,000', 1500000, False),
    ('1,5jt', 1500000, False),
    ('1.5 juta', 1500000, False),
    ('50k', 50000, False),
    ('50rb', 50000, False),
    ('15ribu', 15000, False),
    ('1jt 500rb', 1500000, False),
    ('2jtan', 2000000, True),
    ('50rb-an', 50000, True),
    ('sekitar 1 juta', 1000000, True),
    ('2 juta lebih', 2000000, True),
    ('goceng', 5000, False),
    ('goceng aja kak', 5000, False),
    ('2 ceban', 20000, False),
    ('cepek ceng', 100000, False),
    ('gopek', 500, False),
    ('sejuta setengah', 1500000, False),
    ('setengah juta', 500000, False),
    ('dua setengah juta', 2500000, False),
    ('satu setengah juta', 1500000, False),
    ('dua ratus lima puluh ribu', 250000, False),
    ('seratus dua belas', 112, False),
    ('seribu lima ratus', 1500, False),
    ('dua puluh lima juta tiga ratus ribu', 25300000, False),
    ('1,2 M', 1200000000, False),
]


@pytest.mark.parametrize(('text', 'amount', 'approximate'), CASES)
def test_parse_rupiah(text: str, amount: int, approximate: bool) -> None:
    assert parse_rupiah(text) == ParsedRupiah(amount, approximate)
    result = parse_rupiah(text)
    assert result is not None and isinstance(result.amount, int)  # whole rupiah come back as int


def test_parse_rupiah_rejects_non_amounts() -> None:
    assert parse_rupiah('pisang goreng') is None
    assert parse_rupiah('') is None
    assert parse_rupiah('jutaan') is None
    assert parse_rupiah('constructor') is None


def test_terbilang() -> None:
    assert terbilang(0) == 'nol'
    assert terbilang(11) == 'sebelas'
    assert terbilang(15) == 'lima belas'
    assert terbilang(21) == 'dua puluh satu'
    assert terbilang(100) == 'seratus'
    assert terbilang(110) == 'seratus sepuluh'
    assert terbilang(1000) == 'seribu'
    assert terbilang(1001) == 'seribu satu'
    assert terbilang(11000) == 'sebelas ribu'
    assert terbilang(100000) == 'seratus ribu'
    assert terbilang(1000000) == 'satu juta'
    assert terbilang(1500000) == 'satu juta lima ratus ribu'
    assert terbilang(2000000000) == 'dua miliar'
    assert terbilang(-5) == 'minus lima'
    assert terbilang(2.5) == 'dua koma lima'
    assert terbilang(10**18) == 'satu kuintiliun'
    assert terbilang(1e-7) == 'nol koma nol nol nol nol nol nol satu'
    assert terbilang(Decimal('2.50')) == 'dua koma lima'
    with pytest.raises(ValueError, match='int'):
        terbilang(1e21)
    with pytest.raises(ValueError, match='terlalu besar'):
        terbilang(10**21)


def test_terbilang_for_kuitansi() -> None:
    assert terbilang(1500000, currency=True) == 'satu juta lima ratus ribu rupiah'
    assert terbilang(1500000, currency=True, case='title') == 'Satu Juta Lima Ratus Ribu Rupiah'
    assert terbilang(25000, case='sentence') == 'Dua puluh lima ribu'
