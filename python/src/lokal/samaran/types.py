from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal, Optional

from .._result import Result

PiiType = Literal[
    # Identifiers
    'NIK', 'KK', 'NPWP', 'PASSPORT', 'SIM', 'NIP', 'BPJS', 'NISN', 'AKTA', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CARD',
    'PLATE', 'IP', 'GEO', 'NAME', 'ADDRESS', 'BIRTH_DATE',
    # Attributes listed in UU PDP Pasal 4
    'GENDER', 'RELIGION', 'MARITAL_STATUS', 'NATIONALITY', 'HEALTH', 'FINANCIAL', 'CRIMINAL_RECORD', 'BIOMETRIC',
    # A team's own rules (CustomRule), masked under their own label: [EMPLOYEE_ID_1]
    'CUSTOM',
]

PII_TYPES: tuple[PiiType, ...] = (
    'NIK', 'KK', 'NPWP', 'PASSPORT', 'SIM', 'NIP', 'BPJS', 'NISN', 'AKTA', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CARD',
    'PLATE', 'IP', 'GEO', 'NAME', 'ADDRESS', 'BIRTH_DATE', 'GENDER', 'RELIGION', 'MARITAL_STATUS', 'NATIONALITY',
    'HEALTH', 'FINANCIAL', 'CRIMINAL_RECORD', 'BIOMETRIC', 'CUSTOM',
)

_SPESIFIK = {'HEALTH', 'BIOMETRIC', 'CRIMINAL_RECORD', 'FINANCIAL', 'BANK_ACCOUNT', 'CARD', 'NISN'}

#: UU PDP (UU 27/2022) Pasal 4: "spesifik" data needs stricter handling (health, biometrics, genetics, criminal
#: records, children's data, personal finance). Everything else here is "umum": general personal data, including
#: identifiers that single out a person when combined.
UU_PDP_CATEGORY: Mapping[PiiType, Literal['spesifik', 'umum']] = MappingProxyType(
    {t: ('spesifik' if t in _SPESIFIK else 'umum') for t in PII_TYPES}
)

Confidence = Literal['high', 'medium']

#: How much of an input a check could see, the same in every Lokal integration, so "no personal data found" is never
#: confused with "never looked": ``scanned`` (all of it), ``partial`` (some of it, such as a PDF with scanned pages),
#: ``unsupported`` (none, Lokal does not read this kind of input: .xls, archives, images, too large), or ``failed``
#: (none, this input could not be read although its kind is supported: damaged, encrypted).
ScanStatus = Literal['scanned', 'partial', 'unsupported', 'failed']

SCAN_STATUSES: tuple[ScanStatus, ...] = ('scanned', 'partial', 'unsupported', 'failed')


@dataclass(slots=True, frozen=True)
class PiiMatch(Result):
    type: PiiType
    #: Character offsets into the Python string (``text[start:end] == value``).
    start: int
    end: int
    value: str
    confidence: Confidence
    #: For CUSTOM matches: the rule's label, which names the placeholder.
    label: Optional[str] = None
