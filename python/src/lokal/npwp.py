from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal, Optional

from ._js import WS_CHARS
from ._result import Result
from .nik import Issue, NikInfo, parse_nik

NpwpKind = Literal['npwp15', 'npwp16', 'nik']

_SEPARATORS = re.compile(f'[{WS_CHARS}.-]')
_NON_DIGIT = re.compile(r'[^0-9]')
_DIGITS = re.compile(r'[0-9]+')


@dataclass(slots=True)
class NpwpInfo(Result):
    input: str
    valid: bool = False
    errors: list[Issue] = field(default_factory=list)
    #: ``npwp15``: legacy 15-digit NPWP (XX.XXX.XXX.X-XXX.XXX). ``npwp16``: 16-digit NPWP for entities and
    #: non-residents (legacy NPWP prefixed with 0). ``nik``: individual residents, whose NPWP is their NIK since
    #: PMK 112/2022.
    kind: Optional[NpwpKind] = None
    digits: Optional[str] = None
    #: The 16-digit form used by DJP today.
    npwp16: Optional[str] = None
    #: Legacy dotted format, when the number has a 15-digit form.
    formatted15: Optional[str] = None
    nik: Optional[NikInfo] = None


def format_npwp15(digits: str) -> str:
    d = _NON_DIGIT.sub('', digits)
    return f'{d[0:2]}.{d[2:5]}.{d[5:8]}.{d[8:9]}-{d[9:12]}.{d[12:15]}'


def parse_npwp(input: str) -> NpwpInfo:  # noqa: A002
    """Validates an NPWP in its 15-digit legacy form or its 16-digit form (including NIK-as-NPWP)."""
    info = NpwpInfo(input=input)
    digits = _SEPARATORS.sub('', str(input))

    if not _DIGITS.fullmatch(digits) or len(digits) not in (15, 16):
        info.errors.append(Issue('format', 'NPWP harus 15 digit (format lama) atau 16 digit.'))
        return info
    info.digits = digits

    if len(digits) == 15:
        info.kind = 'npwp15'
        info.npwp16 = f'0{digits}'
        info.formatted15 = format_npwp15(digits)
    elif digits.startswith('0'):
        info.kind = 'npwp16'
        info.npwp16 = digits
        info.formatted15 = format_npwp15(digits[1:])
    else:
        # A NIK never starts with 0 (province codes are 11–96).
        info.kind = 'nik'
        info.npwp16 = digits
        info.nik = parse_nik(digits)
        if not info.nik.valid:
            info.errors.append(Issue(
                'nik', 'NPWP 16 digit yang tidak diawali 0 adalah NIK, tetapi struktur NIK-nya tidak valid.',
            ))

    info.valid = not info.errors
    return info
