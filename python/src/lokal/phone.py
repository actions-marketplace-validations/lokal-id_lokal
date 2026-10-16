from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal, Optional

from ._js import WS_CHARS, trim
from ._result import Result
from .nik import Issue

PhoneType = Literal['mobile', 'landline']


@dataclass(slots=True)
class PhoneInfo(Result):
    input: str
    valid: bool = False
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    type: Optional[PhoneType] = None
    #: +6281234567890: store this.
    e164: Optional[str] = None
    #: 0812-3456-7890: show this.
    national: Optional[str] = None
    #: For wa.me links: 6281234567890
    whatsapp: Optional[str] = None
    #: Original operator of the prefix. Indonesia has no mobile number portability (as of October 2026 it is
    #: only a pending Constitutional Court case, 319/PUU-XXIV/2026), so a prefix still tells the operator.
    operator: Optional[str] = None
    #: Operator group after the Indosat–Tri (2022) and XL–Smartfren (2025) mergers.
    group: Optional[str] = None
    area_code: Optional[str] = None
    area: Optional[str] = None


_MOBILE_PREFIXES: list[tuple[list[str], str, str]] = [
    (['0811', '0812', '0813', '0821', '0822', '0823', '0851', '0852', '0853'], 'Telkomsel', 'Telkomsel'),
    (['0814', '0815', '0816', '0855', '0856', '0857', '0858'], 'Indosat', 'Indosat Ooredoo Hutchison'),
    (['0895', '0896', '0897', '0898', '0899'], 'Tri', 'Indosat Ooredoo Hutchison'),
    (['0817', '0818', '0819', '0859', '0877', '0878'], 'XL', 'XLSmart'),
    (['0831', '0832', '0833', '0838'], 'Axis', 'XLSmart'),
    (['0881', '0882', '0883', '0884', '0885', '0886', '0887', '0888', '0889'], 'Smartfren', 'XLSmart'),
]
_OPERATOR_BY_PREFIX = {p: (operator, group) for prefixes, operator, group in _MOBILE_PREFIXES for p in prefixes}

_AREA_CODES = {
    '21': 'Jakarta', '22': 'Bandung', '24': 'Semarang', '31': 'Surabaya', '61': 'Medan', '251': 'Bogor',
    '254': 'Serang', '271': 'Surakarta', '274': 'Yogyakarta', '341': 'Malang', '361': 'Denpasar', '411': 'Makassar',
    '511': 'Banjarmasin', '541': 'Samarinda', '542': 'Balikpapan', '711': 'Palembang', '751': 'Padang',
    '761': 'Pekanbaru', '778': 'Batam',
}

_CLEAN = re.compile(f'[{WS_CHARS}().-]')
_LEADING_ZEROS = re.compile(r'^0+')
_DIGITS = re.compile(r'[0-9]+')


def parse_phone(input: str) -> PhoneInfo:  # noqa: A002
    """Parses an Indonesian phone number written any common way.

    0812-3456-7890, +62 812 3456 7890, 6281234567890, (021) 555-1234.
    """
    info = PhoneInfo(input=input)
    clean = _CLEAN.sub('', trim(str(input)))

    if clean.startswith('+62'):
        rest = clean[3:]
    elif clean.startswith('62') and len(clean) >= 10:
        rest = clean[2:]
    elif clean.startswith('0'):
        rest = clean[1:]
    elif clean.startswith('8'):
        rest = clean
    else:
        info.errors.append(Issue('format', 'Nomor harus diawali 0, 62, atau +62.'))
        return info
    rest = _LEADING_ZEROS.sub('', rest, count=1)

    if not _DIGITS.fullmatch(rest):
        info.errors.append(Issue('format', 'Nomor telepon hanya boleh berisi angka.'))
        return info

    if rest.startswith('8'):
        info.type = 'mobile'
        if len(rest) < 9 or len(rest) > 12:
            info.errors.append(Issue('length', 'Nomor HP harus 10–13 digit (termasuk 0 di depan).'))
            return info
        op = _OPERATOR_BY_PREFIX.get(f'0{rest[:3]}')
        if op:
            info.operator, info.group = op
        else:
            info.warnings.append(Issue('prefix_unknown', f'Prefix 0{rest[:3]} tidak dikenal.'))
        national = f'0{rest}'
        info.national = f'{national[:4]}-{national[4:8]}-{national[8:]}'
    elif rest[0] in '2345679':
        info.type = 'landline'
        if len(rest) < 7 or len(rest) > 11:
            info.errors.append(Issue('length', 'Panjang nomor telepon rumah tidak valid.'))
            return info
        area = next((c for c in (rest[:2], rest[:3]) if c in _AREA_CODES), None)
        if area:
            info.area_code = f'0{area}'
            info.area = _AREA_CODES[area]
            info.national = f'(0{area}) {rest[len(area):]}'
        else:
            info.national = f'0{rest}'
    else:
        info.errors.append(Issue('format', 'Nomor telepon Indonesia tidak valid.'))
        return info

    info.e164 = f'+62{rest}'
    if info.type == 'mobile':
        info.whatsapp = f'62{rest}'
    info.valid = True
    return info


def normalize_phone(input: str) -> Optional[str]:  # noqa: A002
    """Normalizes to E.164 (+62...), or returns None when the number is invalid."""
    return parse_phone(input).e164
