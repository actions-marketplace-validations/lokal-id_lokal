from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Literal, Optional, Union

from .. import _js
from .._result import Result
from ..phone import parse_phone
from .detectors import check_types, detect_pii
from .types import Confidence, PiiMatch, PiiType

Mode = Literal['placeholder', 'partial']
Allow = Union[str, re.Pattern[str]]


@dataclass(slots=True, frozen=True)
class MaskedMatch(PiiMatch):
    #: What replaced the value: "[NIK_1]" in placeholder mode, "3201********0001" in partial mode.
    replacement: str = ''


@dataclass(slots=True)
class MaskResult(Result):
    text: str
    matches: list[MaskedMatch] = field(default_factory=list)


_NON_DIGIT = re.compile(r'[^0-9]')


def _canonical(pii_type: PiiType, value: str) -> str:
    """Same person, same placeholder: "0812-3456-7890" and "+62 812 3456 7890" both map to [PHONE_1]."""
    if pii_type == 'PHONE':
        return parse_phone(value).e164 or _NON_DIGIT.sub('', value)
    if pii_type == 'EMAIL':
        return value.lower()
    if pii_type in ('PLATE', 'PASSPORT'):
        return ''.join(_js.split_ws(value.upper()))
    if pii_type in ('NIK', 'KK', 'NPWP', 'SIM', 'NIP', 'BPJS', 'BANK_ACCOUNT', 'CARD'):
        return _NON_DIGIT.sub('', value)
    return _js.trim(' '.join(_js.split_ws(value.lower())))


_GEO_DECIMALS = re.compile(r'(\.[0-9])[0-9]+')
_PLATE_REGION_END = _js.rx(r'[\s\d]')


def partial_mask(pii_type: PiiType, value: str) -> str:
    """Keeps just enough to recognise the value: 3201********0001, 0812****7890, b***@gmail.com."""

    def stars(n: int) -> str:
        return '*' * max(n, 3)

    digits = _NON_DIGIT.sub('', value)
    if pii_type in ('NIK', 'KK'):
        return f'{digits[:4]}{stars(8)}{digits[-4:]}'
    if pii_type in ('NIP', 'SIM'):
        return f'{stars(len(digits) - 3)}{digits[-3:]}'
    if pii_type == 'PASSPORT':
        return f'{value[:1]}{stars(5)}{value[-2:]}'
    if pii_type == 'IP':
        parts = value.split('.')
        return f'{parts[0]}.{parts[1] if len(parts) > 1 else "undefined"}.*.*'
    if pii_type == 'GEO':
        return _GEO_DECIMALS.sub(r'\1***', value)
    if pii_type in (
        'BIRTH_DATE', 'GENDER', 'RELIGION', 'MARITAL_STATUS', 'NATIONALITY', 'HEALTH', 'FINANCIAL', 'CRIMINAL_RECORD',
        'BIOMETRIC',
    ):
        return stars(3)
    if pii_type == 'PHONE':
        e164 = parse_phone(value).e164
        national = e164.replace('+62', '0', 1) if e164 else digits
        return f'{national[:4]}{stars(len(national) - 8)}{national[-4:]}'
    if pii_type == 'EMAIL':
        user, _, domain = value.partition('@')
        return f'{user[:1]}{stars(3)}@{domain}'
    if pii_type in ('CARD', 'BANK_ACCOUNT', 'BPJS', 'NPWP'):
        return f'{stars(len(digits) - 4)}{digits[-4:]}'
    if pii_type == 'PLATE':
        return f'{_PLATE_REGION_END.split(value, maxsplit=1)[0]} {stars(4)}'
    if pii_type == 'NAME':
        return ' '.join(f'{w[:1]}{stars(3)}' for w in _js.split_ws(value))
    if pii_type == 'ADDRESS':
        return f'{_js.split_ws(value)[0]} {stars(3)}'
    raise ValueError(f'Unknown PII type: {pii_type}')


_PLACEHOLDER = re.compile(r'\[([A-Z_]+_[0-9]+)\]')
_VAULT_KEY = re.compile(r'\[([A-Z_]+)_([0-9]+)\]')


class Samaran:
    """Masks Indonesian personal data before text leaves your server, and restores it afterwards.

    >>> samaran = Samaran()
    >>> samaran.mask('NIK saya 3201011508950001, HP 0812-3456-7890').text
    'NIK saya [NIK_1], HP [PHONE_1]'
    >>> samaran.unmask('Baik, NIK [NIK_1] sudah kami cek.')
    'Baik, NIK 3201011508950001 sudah kami cek.'

    One instance keeps one vault: use one per conversation or request, not one global. An instance is not
    thread-safe; do not share it between concurrent requests.

    ``mode="placeholder"`` (default) gives reversible tokens like [NIK_1], for text sent to an LLM.
    ``mode="partial"`` gives human-readable masks like 0812****7890, for logs and admin screens; not reversible.
    ``allow`` lists values that are never masked (strings, or compiled patterns), e.g. your own support hotline.
    ``types``, ``exclude`` and ``min_confidence`` are passed to ``detect_pii``.
    ``Samaran(exclude=['FINANCIAL', 'NAME'])`` keeps income, installments and names readable while still masking NIK,
    phone numbers, and accounts.
    """

    __slots__ = ('mode', 'allow', 'types', 'exclude', 'min_confidence', '_by_canonical', '_by_placeholder', '_counters')

    def __init__(
        self,
        *,
        mode: Mode = 'placeholder',
        allow: Iterable[Allow] = (),
        types: Optional[Iterable[PiiType]] = None,
        exclude: Optional[Iterable[PiiType]] = None,
        min_confidence: Optional[Confidence] = None,
    ) -> None:
        if mode not in ('placeholder', 'partial'):
            raise ValueError(f'mode must be "placeholder" or "partial", not {mode!r}')
        self.mode: Mode = mode
        self.allow: tuple[Allow, ...] = tuple(allow)
        self.types: Optional[tuple[PiiType, ...]] = check_types(types) if types is not None else None
        self.exclude: tuple[PiiType, ...] = check_types(exclude or ())
        self.min_confidence = min_confidence
        self._by_canonical: dict[str, str] = {}
        self._by_placeholder: dict[str, str] = {}
        self._counters: dict[str, int] = {}

    def _allowed(self, value: str) -> bool:
        for a in self.allow:
            if isinstance(a, str):
                if a == value:
                    return True
            elif a.search(value):
                return True
        return False

    def scan(self, text: str) -> list[PiiMatch]:
        """Personal data in ``text``, minus allowed values. Does not touch the vault."""
        matches = detect_pii(text, types=self.types, exclude=self.exclude, min_confidence=self.min_confidence)
        return [m for m in matches if not self._allowed(m.value)]

    def mask(self, text: str) -> MaskResult:
        masked: list[MaskedMatch] = []
        out: list[str] = []
        cursor = 0
        for m in self.scan(text):
            replacement = partial_mask(m.type, m.value) if self.mode == 'partial' else self._placeholder_for(m)
            out.append(text[cursor : m.start])
            out.append(replacement)
            cursor = m.end
            masked.append(MaskedMatch(m.type, m.start, m.end, m.value, m.confidence, replacement))
        out.append(text[cursor:])
        return MaskResult(''.join(out), masked)

    def unmask(self, text: str) -> str:
        """Puts the original values back. Unknown placeholders are left as they are."""
        return _PLACEHOLDER.sub(lambda m: self._by_placeholder.get(f'[{m.group(1)}]', m.group(0)), text)

    @property
    def size(self) -> int:
        """Number of distinct values in the vault."""
        return len(self._by_placeholder)

    def __len__(self) -> int:
        return self.size

    def export_vault(self) -> list[tuple[str, str]]:
        """Serializable vault, to restore placeholders in another process. Treat it as the raw data it contains."""
        return list(self._by_placeholder.items())

    def import_vault(self, entries: Iterable[Sequence[str]]) -> None:
        """Loads entries from ``export_vault`` (a list of pairs, also as JSON lists)."""
        for placeholder, value in entries:
            m = _VAULT_KEY.fullmatch(placeholder)
            if not m:
                continue
            pii_type = m.group(1)
            self._by_placeholder[placeholder] = value
            self._by_canonical[f'{pii_type}:{_canonical(pii_type, value)}'] = placeholder  # type: ignore[arg-type]
            self._counters[pii_type] = max(self._counters.get(pii_type, 0), int(m.group(2)))

    def _placeholder_for(self, m: PiiMatch) -> str:
        key = f'{m.type}:{_canonical(m.type, m.value)}'
        existing = self._by_canonical.get(key)
        if existing:
            return existing
        n = self._counters.get(m.type, 0) + 1
        self._counters[m.type] = n
        placeholder = f'[{m.type}_{n}]'
        self._by_canonical[key] = placeholder
        self._by_placeholder[placeholder] = m.value
        return placeholder


def mask_pii(
    text: str,
    *,
    mode: Mode = 'placeholder',
    allow: Iterable[Allow] = (),
    types: Optional[Iterable[PiiType]] = None,
    exclude: Optional[Iterable[PiiType]] = None,
    min_confidence: Optional[Confidence] = None,
) -> MaskResult:
    """One-shot masking. Use a ``Samaran`` instance when you need to unmask later."""
    return Samaran(mode=mode, allow=allow, types=types, exclude=exclude, min_confidence=min_confidence).mask(text)
