from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from .._result import Result

PiiType = Literal[
    # Identifiers
    'NIK', 'KK', 'NPWP', 'PASSPORT', 'SIM', 'NIP', 'BPJS', 'NISN', 'AKTA', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CARD',
    'PLATE', 'IP', 'GEO', 'NAME', 'ADDRESS', 'BIRTH_DATE',
    # Attributes listed in UU PDP Pasal 4
    'GENDER', 'RELIGION', 'MARITAL_STATUS', 'NATIONALITY', 'HEALTH', 'FINANCIAL', 'CRIMINAL_RECORD', 'BIOMETRIC',
]

PII_TYPES: tuple[PiiType, ...] = (
    'NIK', 'KK', 'NPWP', 'PASSPORT', 'SIM', 'NIP', 'BPJS', 'NISN', 'AKTA', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CARD',
    'PLATE', 'IP', 'GEO', 'NAME', 'ADDRESS', 'BIRTH_DATE', 'GENDER', 'RELIGION', 'MARITAL_STATUS', 'NATIONALITY',
    'HEALTH', 'FINANCIAL', 'CRIMINAL_RECORD', 'BIOMETRIC',
)

_SPESIFIK = {'HEALTH', 'BIOMETRIC', 'CRIMINAL_RECORD', 'FINANCIAL', 'BANK_ACCOUNT', 'CARD', 'NISN'}

#: UU PDP (UU 27/2022) Pasal 4: "spesifik" data needs stricter handling (health, biometrics, genetics, criminal
#: records, children's data, personal finance). Everything else here is "umum": general personal data, including
#: identifiers that single out a person when combined.
UU_PDP_CATEGORY: Mapping[PiiType, Literal['spesifik', 'umum']] = MappingProxyType(
    {t: ('spesifik' if t in _SPESIFIK else 'umum') for t in PII_TYPES}
)

Confidence = Literal['high', 'medium']


@dataclass(slots=True, frozen=True)
class PiiMatch(Result):
    type: PiiType
    #: Character offsets into the Python string (``text[start:end] == value``).
    start: int
    end: int
    value: str
    confidence: Confidence
