from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Literal, Optional, Union

from .. import _js
from .._result import Result
from ..phone import parse_phone
from .custom import CustomRule, RuleLike, check_custom_rules, to_rules
from .detectors import check_types, detect_pii
from .types import PII_TYPES, Confidence, PiiMatch, PiiType

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
    if pii_type in ('PLATE', 'PASSPORT', 'AKTA'):
        return ''.join(_js.split_ws(value.upper()))
    if pii_type in ('NIK', 'KK', 'NPWP', 'SIM', 'NIP', 'BPJS', 'NISN', 'BANK_ACCOUNT', 'CARD'):
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
    if pii_type in ('NIP', 'SIM', 'NISN', 'AKTA'):
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
    if pii_type == 'CUSTOM':
        # In UTF-16 units, as JavaScript counts them, so both ports mask "🌸 Dewi Lestari" alike.
        units = value.encode('utf-16-le')
        tail = units[-4:].decode('utf-16-le', errors='ignore') if len(units) > 12 else ''
        return f'{stars(len(units) // 2 - 2)}{tail}'
    raise ValueError(f'Unknown PII type: {pii_type}')


_PLACEHOLDER = re.compile(r'\[([A-Z_]+_[0-9]+)\]')
_HAS_LOWER = re.compile(r'[a-z]')
_HAS_UPPER = re.compile(r'[A-Z]')


def _lower_case_around(text: str, start: int, end: int) -> bool:
    """No capital letter in the words around a placeholder (other placeholders aside): chat written in lower case."""
    around = _PLACEHOLDER.sub(' ', f'{text[max(0, start - 40) : start]} {text[end : end + 40]}')
    return bool(_HAS_LOWER.search(around)) and not _HAS_UPPER.search(around)
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
    ``types``, ``exclude``, ``min_confidence`` and ``custom`` (a team's own rules) are passed to ``detect_pii``.
    ``Samaran(exclude=['FINANCIAL', 'NAME'])`` keeps income, installments and names readable while still masking NIK,
    phone numbers, and accounts. ``ner`` adds an optional detector, such as ``lokal.samaran.ner.NerNames()`` for
    names the rules do not know (``pip install "lokal-id[ner]"``).
    """

    __slots__ = (
        'mode', 'allow', 'types', 'exclude', 'min_confidence', 'custom', 'ner',
        '_by_canonical', '_by_placeholder', '_lower_form', '_counters',
    )

    def __init__(
        self,
        *,
        mode: Mode = 'placeholder',
        allow: Iterable[Allow] = (),
        types: Optional[Iterable[PiiType]] = None,
        exclude: Optional[Iterable[PiiType]] = None,
        min_confidence: Optional[Confidence] = None,
        custom: Iterable[RuleLike] = (),
        ner: Optional[Callable[[str], Iterable[PiiMatch]]] = None,
    ) -> None:
        if mode not in ('placeholder', 'partial'):
            raise ValueError(f'mode must be "placeholder" or "partial", not {mode!r}')
        self.mode: Mode = mode
        self.allow: tuple[Allow, ...] = tuple(allow)
        self.types: Optional[tuple[PiiType, ...]] = check_types(types) if types is not None else None
        self.exclude: tuple[PiiType, ...] = check_types(exclude or ())
        self.min_confidence = min_confidence
        self.custom: tuple[CustomRule, ...] = to_rules(custom)
        self.ner = ner
        self._by_canonical: dict[str, str] = {}
        self._by_placeholder: dict[str, str] = {}
        # A value also written in lower case ("Paijo", later "paijo"): one placeholder, restored in the case around it.
        self._lower_form: dict[str, str] = {}
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
        matches = detect_pii(
            text, types=self.types, exclude=self.exclude, min_confidence=self.min_confidence, custom=self.custom,
            ner=self.ner,
        )
        return [m for m in matches if not self._allowed(m.value)]

    def reserve(self, text: str) -> None:
        """Keeps placeholder-like text that is already in ``text`` and did not come from this vault apart from real
        values: with "Halo [NAME_1]" in an e-mail template, the real name becomes [NAME_2], so restoring never fills
        the template with it. ``mask`` does this for its own input. When the parts of one request are masked one by
        one, call it on the whole request first, so a template in a later part does not take a number an earlier part
        already gave out."""
        for m in _PLACEHOLDER.finditer(text):
            if m.group(0) in self._by_placeholder:
                continue  # ours: the user or the model referring to a masked value
            name, _, number = m.group(1).rpartition('_')
            n = int(number)
            if self._counters.get(name, 0) < n < 1_000_000_000:
                self._counters[name] = n

    def mask(self, text: str) -> MaskResult:
        if self.mode != 'partial':
            self.reserve(text)
        masked: list[MaskedMatch] = []
        out: list[str] = []
        cursor = 0
        for m in self.scan(text):
            replacement = partial_mask(m.type, m.value) if self.mode == 'partial' else self._placeholder_for(m)
            out.append(text[cursor : m.start])
            out.append(replacement)
            cursor = m.end
            masked.append(MaskedMatch(m.type, m.start, m.end, m.value, m.confidence, m.label, replacement))
        out.append(text[cursor:])
        return MaskResult(''.join(out), masked)

    def unmask(self, text: str) -> str:
        """Puts the original values back. Unknown placeholders are left as they are."""

        def restore(m: re.Match[str]) -> str:
            value = self._by_placeholder.get(m.group(0))
            if value is None:
                return m.group(0)
            lower = self._lower_form.get(m.group(0))
            return lower if lower is not None and _lower_case_around(text, m.start(), m.end()) else value

        return _PLACEHOLDER.sub(restore, text)

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
            name = m.group(1)
            # A name that is not a built-in type is a custom rule's label.
            pii_type = name if name in PII_TYPES else 'CUSTOM'
            self._by_placeholder[placeholder] = value
            self._by_canonical[f'{name}:{_canonical(pii_type, value)}'] = placeholder
            self._counters[name] = max(self._counters.get(name, 0), int(m.group(2)))

    def placeholder(self, pii_type: PiiType, value: str, label: Optional[str] = None) -> str:
        """The placeholder for a value you already know is personal data, such as the street a parser split out of a
        masked address. A value gets the same placeholder here as from ``mask``, and ``unmask`` restores it. CUSTOM
        takes the rule's label: ``placeholder('CUSTOM', 'EMP-004211', 'EMPLOYEE_ID')`` gives [EMPLOYEE_ID_1]."""
        check_types([pii_type])
        if pii_type == 'CUSTOM':
            check_custom_rules([CustomRule(label or '', fields=('-',))])
        elif label is not None:
            raise ValueError('A label is only used with the CUSTOM type.')
        name = label if pii_type == 'CUSTOM' and label else pii_type
        key = f'{name}:{_canonical(pii_type, value)}'
        existing = self._by_canonical.get(key)
        if existing:
            if value != self._by_placeholder.get(existing) and value == value.lower() and _HAS_LOWER.search(value):
                self._lower_form[existing] = value
            return existing
        n = self._counters.get(name, 0) + 1
        self._counters[name] = n
        placeholder = f'[{name}_{n}]'
        self._by_canonical[key] = placeholder
        self._by_placeholder[placeholder] = value
        return placeholder

    def _placeholder_for(self, m: PiiMatch) -> str:
        return self.placeholder(m.type, m.value, m.label if m.type == 'CUSTOM' else None)


def mask_pii(
    text: str,
    *,
    mode: Mode = 'placeholder',
    allow: Iterable[Allow] = (),
    types: Optional[Iterable[PiiType]] = None,
    exclude: Optional[Iterable[PiiType]] = None,
    min_confidence: Optional[Confidence] = None,
    custom: Iterable[RuleLike] = (),
) -> MaskResult:
    """One-shot masking. Use a ``Samaran`` instance when you need to unmask later."""
    return Samaran(
        mode=mode, allow=allow, types=types, exclude=exclude, min_confidence=min_confidence, custom=custom
    ).mask(text)
