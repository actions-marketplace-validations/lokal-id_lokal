import datetime as dt

from lokal import normalize_phone, parse_nik, parse_npwp, parse_phone
from lokal.wilayah import wilayah_name

REF = dt.date(2026, 10, 15)


def test_nik_male_with_kemendagri_region() -> None:
    info = parse_nik('3201011508950001', lookup_wilayah=wilayah_name, reference_date=REF)
    assert info.valid
    assert info.gender == 'L'
    assert info.birth_date == '1995-08-15'
    assert info.province == 'Jawa Barat'
    assert info.regency == 'Kabupaten Bogor'
    assert info.district == 'Cibinong'
    assert info.serial == '0001'


def test_nik_female_2000s_spaces_ignored() -> None:
    info = parse_nik('3276 01 550803 0002', reference_date=REF)
    assert info.valid
    assert info.gender == 'P'
    assert info.birth_date == '2003-08-15'


def test_nik_bad_structure_explains_why() -> None:
    assert [e.code for e in parse_nik('12345').errors] == ['format']
    assert any(e.code == 'province' for e in parse_nik('9901011508950001').errors)
    assert parse_nik('3201013108950001').valid
    assert any(e.code == 'birth_date' for e in parse_nik('3201013102950001').errors)  # 31 Februari
    assert any(e.code == 'birth_date' for e in parse_nik('3201017508950001').errors)  # hari 75 - 40 = 35
    assert any(e.code == 'serial' for e in parse_nik('3201011508950000').errors)


def test_nik_old_region_code_warns_not_errors() -> None:
    info = parse_nik('3201991508950001', lookup_wilayah=wilayah_name, reference_date=REF)
    assert info.valid
    assert [w.code for w in info.warnings] == ['wilayah_unknown']


def test_npwp_legacy_15_digits() -> None:
    info = parse_npwp('01.234.567.8-901.000')
    assert info.valid
    assert info.kind == 'npwp15'
    assert info.npwp16 == '0012345678901000'
    assert info.formatted15 == '01.234.567.8-901.000'


def test_npwp_16_digits_and_nik_as_npwp() -> None:
    assert parse_npwp('0012345678901000').kind == 'npwp16'
    nik = parse_npwp('3201011508950001')
    assert nik.kind == 'nik'
    assert nik.valid
    assert not parse_npwp('3201011508950000').valid
    assert not parse_npwp('123').valid


def test_phone_formats_operators() -> None:
    a = parse_phone('0812-3456-7890')
    assert a.valid
    assert a.e164 == '+6281234567890'
    assert a.national == '0812-3456-7890'
    assert a.whatsapp == '6281234567890'
    assert a.operator == 'Telkomsel'
    assert parse_phone('+62 857 1234 5678').operator == 'Indosat'
    assert parse_phone('6289612345678').operator == 'Tri'
    assert parse_phone('6289612345678').group == 'Indosat Ooredoo Hutchison'
    assert parse_phone('0881-2345-6789').group == 'XLSmart'
    assert normalize_phone('+62 (0) 812 3456 7890') == '+6281234567890'


def test_landline_and_invalid() -> None:
    home = parse_phone('(021) 555-1234')
    assert home.valid
    assert home.type == 'landline'
    assert home.area == 'Jakarta'
    assert home.e164 == '+62215551234'
    assert not parse_phone('12345').valid
    assert not parse_phone('0812').valid
