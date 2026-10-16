from __future__ import annotations

import datetime as _dt
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal, Optional

from ._js import WS_CHARS
from ._result import Result
from .provinces import PROVINCES

Gender = Literal['L', 'P']

_SEPARATORS = re.compile(f'[{WS_CHARS}.-]')
_SIXTEEN = re.compile(r'[0-9]{16}')


@dataclass(slots=True)
class Issue(Result):
    code: str
    message: str


@dataclass(slots=True)
class NikInfo(Result):
    input: str
    valid: bool = False
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    #: The 16 digits, or None when the input does not contain exactly 16 digits.
    nik: Optional[str] = None
    #: Kemendagri codes encoded in the NIK: "32", "32.01", "32.01.01".
    province_code: Optional[str] = None
    regency_code: Optional[str] = None
    district_code: Optional[str] = None
    province: Optional[str] = None
    regency: Optional[str] = None
    district: Optional[str] = None
    #: L = laki-laki, P = perempuan (day of birth + 40).
    gender: Optional[Gender] = None
    #: ISO date (YYYY-MM-DD). The century is inferred, see `reference_date`.
    birth_date: Optional[str] = None
    serial: Optional[str] = None


def _real_date(year: int, month: int, day: int) -> Optional[_dt.date]:
    try:
        return _dt.date(year, month, day)
    except ValueError:
        return None


def parse_nik(
    input: str,  # noqa: A002 - same name as the TypeScript API and the result field
    *,
    lookup_wilayah: Optional[Callable[[str], Optional[str]]] = None,
    reference_date: Optional[_dt.date] = None,
) -> NikInfo:
    """Parses and validates a NIK (Nomor Induk Kependudukan) by its structure.

    PP KK CC DDMMYY SSSS: province, regency, district, birth date (+40 for women), serial.
    Structure checks cannot prove a NIK is registered at Dukcapil; they only reject numbers that cannot be a NIK.

    Pass ``lookup_wilayah=wilayah_name`` (from ``lokal.wilayah``) to fill in region names.
    """
    info = NikInfo(input=input)
    digits = _SEPARATORS.sub('', str(input))

    if not _SIXTEEN.fullmatch(digits):
        info.errors.append(Issue('format', 'NIK harus terdiri dari 16 digit angka.'))
        return info
    info.nik = digits

    pp, kk, cc = digits[0:2], digits[2:4], digits[4:6]
    info.province_code = pp
    info.regency_code = f'{pp}.{kk}'
    info.district_code = f'{pp}.{kk}.{cc}'

    province = PROVINCES.get(pp)
    if not province:
        info.errors.append(Issue('province', f'Kode provinsi "{pp}" tidak dikenal.'))
    else:
        info.province = province
    if kk == '00' or cc == '00':
        info.errors.append(Issue('wilayah', 'Kode kabupaten/kota dan kecamatan tidak boleh 00.'))

    if lookup_wilayah and province:
        info.regency = lookup_wilayah(info.regency_code)
        info.district = lookup_wilayah(info.district_code)
        if not info.regency or not info.district:
            # Codes change after pemekaran, and a NIK keeps the code it was issued with.
            info.warnings.append(Issue(
                'wilayah_unknown',
                'Kode wilayah tidak ada di data Kemendagri terbaru (bisa jadi kode lama sebelum pemekaran).',
            ))

    day = int(digits[6:8])
    month = int(digits[8:10])
    yy = int(digits[10:12])
    gender: Optional[Gender]
    if day > 40:
        gender = 'P'
        day -= 40
    else:
        gender = 'L'

    ref = reference_date or _dt.date.today()
    year = 2000 + yy if yy <= ref.year % 100 else 1900 + yy
    date = _real_date(year, month, day) if day >= 1 else None
    if date is None:
        info.errors.append(Issue('birth_date', 'Tanggal lahir di NIK tidak valid.'))
        gender = None
    else:
        info.birth_date = date.isoformat()
    info.gender = gender

    serial = digits[12:]
    info.serial = serial
    if serial == '0000':
        info.errors.append(Issue('serial', 'Nomor urut NIK tidak boleh 0000.'))

    info.valid = not info.errors
    return info


def is_valid_nik(input: str) -> bool:  # noqa: A002
    """True when the input has a valid NIK structure."""
    return parse_nik(input).valid
