"""Kembaran ("twin"): replaces Indonesian personal data with realistic stand-ins.

Port of packages/core/src/kembaran.ts.

A copy of production data can then go to staging, a developer's laptop, or a vendor without anyone in it being a real
person. Unlike Samaran's [NIK_1] placeholders, the result looks like the original and still works as data:

- The same value always gets the same stand-in, across tables and files, so joins and foreign keys hold.
- Stand-ins keep what analysis needs and nothing that identifies: a NIK keeps its district, gender, and birth year; a
  phone number its operator; an address its RT/RW and area; a name its number of words and its casing.
- Within one line (a CSV row, an SQL tuple), a birth date follows the stand-in NIK, so the row stays consistent.
- Stand-ins come from HMAC-SHA256 under a secret: random for each run unless one is given, and never reversible
  without it. Unique values (NIK, phone, account numbers) never collide.

For the same secret the output is identical to the TypeScript package's.

>>> k = Kembaran(secret='staging-2026')                                   # doctest: +SKIP
>>> k.text('Nama: Budi Santoso, NIK 3201011508950001').text              # doctest: +SKIP
'Nama: Slamet Matondang, NIK 3201012409953895'
"""

from __future__ import annotations

import bisect
import datetime as _dt
import hashlib
import re
import secrets
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Optional

from . import _js
from ._js import rx
from ._kembaran_data import (
    FEMALE_FIRST,
    FEMALE_LAST,
    HEALTH,
    MALE_FIRST,
    MALE_LAST,
    MARITAL,
    NAME_KEEP,
    RELIGIONS,
    STREETS,
)
from ._result import Result
from .samaran.core import _canonical
from .samaran.custom import CustomRule, RuleLike, to_rules
from .samaran.detectors import check_types, detect_pii
from .samaran.types import Confidence, PiiType

KEEP_BY_DEFAULT: tuple[PiiType, ...] = ('GENDER', 'RELIGION', 'MARITAL_STATUS', 'NATIONALITY')

# Values that must stay unique: two people must not end up with one stand-in.
_UNIQUE = frozenset((
    'NIK', 'KK', 'NPWP', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CARD', 'BPJS', 'SIM', 'NIP', 'NISN', 'AKTA', 'PASSPORT',
    'PLATE', 'IP',
))

_MONTHS: tuple[tuple[str, ...], ...] = (
    ('januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november',
     'desember'),
    ('january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november',
     'december'),
    ('jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'),
    ('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'),
)
_MONTH_ALIASES = {'agt': 7, 'ags': 7, 'sept': 8, 'nop': 10, 'peb': 1}
_MONTH_NAMES = '|'.join(sorted(
    dict.fromkeys([*(m for family in _MONTHS for m in family), *_MONTH_ALIASES]), key=len, reverse=True
))
_DMY = rx(r'(\d{1,2})([-/. ])(\d{1,2})\2(\d{4})')
_YMD = rx(r'(\d{4})([-/.])(\d{1,2})\2(\d{1,2})')
_D_NAME_Y = rx(rf'(\d{{1,2}})(\s+)({_MONTH_NAMES})(\.?\s+)(\d{{4}})', 'i')
_EXCEL_SERIAL = re.compile(r'[0-9]{5}')
_STREET = rx(
    r"\b(Jl|Jln|Jalan|Gg|Gang|Komp|Kompleks|Perum|Perumahan)(\.?\s+)([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)*?)"
    r'(?=\s+(?:No|Nomor|Blok|Kav|RT|RW)\b|\s*\d|\s*$)',
    'i',
)
_INITIAL = re.compile(r'[A-Za-z]\.')
_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
_FEMALE_SET = frozenset(n.lower() for n in FEMALE_FIRST)
_MALE_SET = frozenset(n.lower() for n in MALE_FIRST)
_NON_DIGIT = re.compile(r'[^0-9]')
_DIGIT_RUN = re.compile(r'[0-9]+')
_GEO_DECIMALS = re.compile(r'(\.[0-9]{2})([0-9]+)')
_PLATE = rx(r'^([A-Za-z]{1,2})(\s*)(\d{1,4})(\s*)([A-Za-z]{0,3})$')
_WS_KEEP = rx(r'(\s+)')
_ALL_WS = rx(r'^\s+$')
_TRAILING_COMMA = re.compile(r',\Z')
_EPOCH = _dt.date(1899, 12, 30)


@dataclass(slots=True)
class KembaranResult(Result):
    text: str
    #: How many values of each type were replaced.
    replaced: dict[str, int] = field(default_factory=dict)


class _Hmac:
    """HMAC-SHA256 under one key, with the padded key hashed once instead of on every call."""

    __slots__ = ('_inner', '_outer')

    def __init__(self, secret: bytes) -> None:
        key = (hashlib.sha256(secret).digest() if len(secret) > 64 else secret).ljust(64, b'\x00')
        self._inner = hashlib.sha256(bytes(b ^ 0x36 for b in key))
        self._outer = hashlib.sha256(bytes(b ^ 0x5C for b in key))

    def digest(self, message: str) -> bytes:
        inner = self._inner.copy()
        inner.update(message.encode())
        outer = self._outer.copy()
        outer.update(inner.digest())
        return outer.digest()


class _Stream:
    """A stream of numbers from HMAC-SHA256(secret, label): the same label always gives the same stream."""

    __slots__ = ('_block', '_buf', '_key', '_label', '_pos')

    def __init__(self, key: _Hmac, label: str) -> None:
        self._key = key
        self._label = label
        self._block = 0
        self._buf = b''
        self._pos = 32

    def below(self, n: int) -> int:
        if self._pos + 4 > 32:
            self._buf = self._key.digest(f'{self._label}#{self._block}')
            self._block += 1
            self._pos = 0
        v = int.from_bytes(self._buf[self._pos : self._pos + 4], 'big')
        self._pos += 4
        return v % n

    def pick(self, xs: tuple[str, ...] | list[str]) -> str:
        return xs[self.below(len(xs))]

    def digits(self, n: int) -> str:
        return ''.join(str(self.below(10)) for _ in range(n))


def _pad(n: int, width: int = 2) -> str:
    return str(n).rjust(width, '0')


def _only_digits(s: str) -> str:
    return _NON_DIGIT.sub('', s)


def _put_digits(template: str, digits: str) -> str:
    """Writes `digits` into the digit positions of `template`, keeping its separators: "0812-3456-7890"."""
    if len(_only_digits(template)) != len(digits):
        return digits
    it = iter(digits)
    return re.sub(r'[0-9]', lambda _: next(it), template)


def _case_like(word: str, like: str) -> str:
    """Same casing as `like`: "BUDI", "budi", or "Budi"."""
    if len(like) > 1 and like == like.upper() and like != like.lower():
        return word.upper()
    if like == like.lower() and like != like.upper():
        return word.lower()
    return word


def _shape_digits(s: str, rng: _Stream) -> str:
    """Each run of digits replaced by random digits of the same length, keeping a leading zero."""

    def run(m: re.Match[str]) -> str:
        r = m.group(0)
        out = []
        for i, d in enumerate(r):
            if i > 0:
                out.append(str(rng.below(10)))
            elif d == '0' and len(r) > 1:
                out.append('0')
            else:
                out.append(str(1 + rng.below(9)))
        return ''.join(out)

    return _DIGIT_RUN.sub(run, s)


def _shape_all(s: str, rng: _Stream) -> str:
    """Letters to random letters of the same case, digits to random digits; anything else stays."""
    out = []
    for ch in s:
        if '0' <= ch <= '9':
            out.append(str(rng.below(10)))
        elif 'A' <= ch <= 'Z':
            out.append(_LETTERS[rng.below(26)])
        elif 'a' <= ch <= 'z':
            out.append(_LETTERS[rng.below(26)].lower())
        else:
            out.append(ch)
    return ''.join(out)


def _luhn_fix(digits: str) -> str:
    body = digits[:-1]
    total = 0
    for i in range(len(body)):
        d = int(body[len(body) - 1 - i])
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return body + str((10 - total % 10) % 10)


@dataclass(frozen=True, slots=True)
class _Day:
    day: int
    month: int


class Kembaran:
    """Stand-ins for personal data, consistent for the life of the instance (or across runs with the same secret).

    ``keep`` lists types left as they are (default: gender, religion, marital status, nationality, which identify no
    one). ``keep_birth_date`` keeps whole birth dates instead of only the year. ``custom`` takes a team's own rules,
    as for ``Samaran``: their values get stand-ins of the same shape.
    """

    def __init__(
        self,
        *,
        secret: Optional[str] = None,
        keep: Optional[Iterable[str]] = None,
        keep_birth_date: bool = False,
        min_confidence: Confidence = 'medium',
        custom: Iterable[RuleLike] = (),
    ) -> None:
        self._key = _Hmac(secret.encode('utf-8') if secret is not None else secrets.token_bytes(32))
        self._keep: frozenset[str] = frozenset(check_types(keep) if keep is not None else KEEP_BY_DEFAULT)
        self._keep_birth_date = keep_birth_date
        self._min_confidence: Confidence = min_confidence
        self._custom: tuple[CustomRule, ...] = to_rules(custom)
        self._fakes: dict[str, str] = {}
        self._used: dict[str, set[str]] = {}
        self._nik_days: dict[str, _Day] = {}

    def text(self, text: str) -> KembaranResult:
        """Replaces every piece of personal data in a text: a CSV, an SQL dump, JSON, a log, or prose."""
        matches = detect_pii(
            text, min_confidence=self._min_confidence, exclude=sorted(self._keep), custom=self._custom  # type: ignore[arg-type]
        )
        line_starts = [0]
        i = text.find('\n')
        while i >= 0:
            line_starts.append(i + 1)
            i = text.find('\n', i + 1)

        def line_of(pos: int) -> int:
            return bisect.bisect_right(line_starts, pos) - 1

        # NIKs first, so a birth date on the same line can follow the stand-in NIK.
        out: list[Optional[str]] = [None] * len(matches)
        row_days: dict[int, _Day] = {}
        for i, m in enumerate(matches):
            if m.type != 'NIK':
                continue
            out[i] = self.value('NIK', m.value)
            day = self._nik_days.get(_only_digits(out[i] or ''))
            line = line_of(m.start)
            if day is not None and line not in row_days:
                row_days[line] = day
        for i, m in enumerate(matches):
            if out[i] is None:
                out[i] = self._value(m.type, m.value, row_days.get(line_of(m.start)))
        parts: list[str] = []
        cursor = 0
        replaced: dict[str, int] = {}
        for i, m in enumerate(matches):
            parts.append(text[cursor : m.start])
            parts.append(out[i] or '')
            cursor = m.end
            replaced[m.type] = replaced.get(m.type, 0) + 1
        parts.append(text[cursor:])
        return KembaranResult(''.join(parts), replaced)

    def value(self, pii_type: str, original: str) -> str:
        """The stand-in for one value of a known type."""
        check_types([pii_type])
        return self._value(pii_type, original, None)

    def _value(self, pii_type: str, original: str, row_day: Optional[_Day]) -> str:
        if pii_type in self._keep:
            return original
        canon = (
            ' '.join(t.lower() for t in self._name_core(original))
            if pii_type == 'NAME'
            else _canonical(pii_type, original)  # type: ignore[arg-type]
        )
        if pii_type == 'BIRTH_DATE' and row_day is not None and not self._keep_birth_date:
            return self._birth_date(original, _Stream(self._key, 'BIRTH_DATE|row'), row_day)
        cache_key = f'{pii_type}|{canon}'
        cached = self._fakes.get(cache_key)
        if cached is not None:
            return self._render(pii_type, original, cached)
        fake = ''
        for attempt in range(100):
            fake = self._make(pii_type, original, canon, _Stream(self._key, f'{pii_type}|{canon}|{attempt}'))
            if pii_type not in _UNIQUE:
                break
            used = self._used.setdefault(pii_type, set())
            if fake not in used:
                used.add(fake)
                break
        self._fakes[cache_key] = fake
        return self._render(pii_type, original, fake)

    @staticmethod
    def _name_core(name: str) -> list[str]:
        """The words of a name that identify the person: not honorifics, titles, or "bin"."""
        return [w for w in _js.split_ws(name) if w and w.lower().replace('.', '').replace(',', '') not in NAME_KEEP]

    def _make(self, pii_type: str, original: str, canon: str, rng: _Stream) -> str:  # noqa: C901 - one branch per type
        if pii_type == 'NIK':
            d = _only_digits(original)
            if len(d) != 16:
                return d[:6] + rng.digits(max(0, len(d) - 6))
            female = int(d[6:8]) > 40
            day = _Day(int(d[6:8]) - (40 if female else 0), int(d[8:10]))
            if not self._keep_birth_date:
                new_day = 1 + rng.below(28)
                day = _Day(new_day, 1 + rng.below(12))
            day_field = _pad(day.day + (40 if female else 0))
            nik = d[:6] + day_field + _pad(day.month) + d[10:12] + _pad(1 + rng.below(9999), 4)
            self._nik_days[nik] = day
            return nik
        if pii_type == 'KK':
            d = _only_digits(original)
            return d[:6] + rng.digits(max(0, len(d) - 6))
        if pii_type == 'NPWP':
            d = _only_digits(original)
            # An individual's NPWP is their NIK: the same person keeps one stand-in for both.
            if len(d) == 16 and d[0] != '0':
                return _only_digits(self._value('NIK', d, None))
            return d[:1] + rng.digits(max(0, len(d) - 1))
        if pii_type == 'PHONE':
            if canon.startswith('+62'):
                return canon[:6] + rng.digits(len(canon) - 6)
            d = _only_digits(original)
            return d[:4] + rng.digits(max(0, len(d) - 4))
        if pii_type == 'EMAIL':
            female = rng.below(2) == 1
            first = rng.pick(FEMALE_FIRST if female else MALE_FIRST).lower()
            last = rng.pick(FEMALE_LAST if female else MALE_LAST).lower()
            return f'{first}.{last}{_pad(rng.below(100))}'
        if pii_type == 'NAME':
            core = self._name_core(original)
            lead = next((w for w in core if not _INITIAL.fullmatch(w)), None)
            lead = lead.lower().replace('.', '').replace(',', '') if lead is not None else None
            if lead is not None and lead in _FEMALE_SET:
                female = True
            elif lead is not None and lead in _MALE_SET:
                female = False
            else:
                female = rng.below(2) == 1
            words: list[str] = []
            first_done = False
            for w in core:
                if _INITIAL.fullmatch(w):
                    words.append(f'{_LETTERS[rng.below(26)]}.')
                elif not first_done:
                    words.append(rng.pick(FEMALE_FIRST if female else MALE_FIRST))
                    first_done = True
                else:
                    nxt = rng.pick(FEMALE_LAST if female else MALE_LAST)
                    for _ in range(5):
                        if nxt not in words:
                            break
                        nxt = rng.pick(FEMALE_LAST if female else MALE_LAST)
                    words.append(nxt)
            return ' '.join(words)
        if pii_type == 'ADDRESS':
            return self._address(original, rng)
        if pii_type == 'BIRTH_DATE':
            return original if self._keep_birth_date else self._birth_date(original, rng, None)
        if pii_type in ('BANK_ACCOUNT', 'BPJS', 'SIM', 'NISN'):
            return rng.digits(len(_only_digits(original)))
        if pii_type == 'NIP':
            d = _only_digits(original)
            return d[:4] + rng.digits(max(0, len(d) - 4))
        if pii_type == 'CARD':
            d = _only_digits(original)
            return _luhn_fix(d[:6] + rng.digits(len(d) - 6)) if len(d) > 7 else rng.digits(len(d))
        if pii_type == 'PASSPORT':
            return original[:1] + _shape_all(original[1:], rng)
        if pii_type == 'PLATE':
            m = _PLATE.search(_js.trim(original))
            if not m:
                return _shape_all(original, rng)
            num = str(1 + rng.below(9)) + rng.digits(len(m.group(3)) - 1)
            suffix = ''.join(_case_like(_LETTERS[rng.below(26)], c) for c in m.group(5))
            return f'{m.group(1)}{m.group(2)}{num}{m.group(4)}{suffix}'
        if pii_type == 'IP':
            if ':' in original:
                return f'2001:db8::{rng.below(65536):x}:{rng.below(65536):x}'
            return f'{rng.pick(("192.0.2", "198.51.100", "203.0.113"))}.{1 + rng.below(254)}'
        if pii_type == 'GEO':
            return _GEO_DECIMALS.sub(lambda m: m.group(1) + rng.digits(len(m.group(2))), original)
        if pii_type in ('FINANCIAL', 'AKTA'):
            return _shape_digits(original, rng)
        if pii_type == 'HEALTH':
            return _case_like(rng.pick(HEALTH), original)
        if pii_type == 'CRIMINAL_RECORD':
            return _case_like('Tidak ada catatan', original)
        if pii_type == 'BIOMETRIC':
            dot = original.rfind('.')
            ext = original[dot:] if dot > 0 and len(original) - dot <= 5 else ''
            return _shape_all(original[: len(original) - len(ext)], rng) + ext
        if pii_type == 'GENDER':
            return rng.pick(('L', 'P')) if len(_js.trim(original)) == 1 else rng.pick(('Laki-laki', 'Perempuan'))
        if pii_type == 'RELIGION':
            return rng.pick(RELIGIONS)
        if pii_type == 'MARITAL_STATUS':
            return rng.pick(MARITAL)
        if pii_type == 'NATIONALITY':
            return 'WNI'
        return _shape_all(original, rng)

    def _render(self, pii_type: str, original: str, fake: str) -> str:
        """A stand-in in the original's format: its separators, its casing, its titles."""
        if pii_type in ('NIK', 'KK', 'NPWP', 'BANK_ACCOUNT', 'BPJS', 'SIM', 'NIP', 'NISN', 'CARD'):
            return _put_digits(original, fake)
        if pii_type == 'PHONE':
            if not fake.startswith('+62'):
                return _put_digits(original, fake)
            d = _only_digits(original)
            digits = f'0{fake[3:]}' if d.startswith('0') else fake[1:] if d.startswith('62') else fake[3:]
            return _put_digits(original, digits)
        if pii_type == 'EMAIL':
            return f'{fake}@example.com' if '@' in original else f'{fake} [at] example [dot] com'
        if pii_type == 'NAME':
            words = fake.split(' ')
            index = 0
            out = []
            for part in _WS_KEEP.split(original):
                if not part or _ALL_WS.search(part) or part.lower().replace('.', '').replace(',', '') in NAME_KEEP:
                    out.append(part)
                    continue
                word = words[index] if index < len(words) else part
                index += 1
                trail = ',' if _TRAILING_COMMA.search(part) else ''
                out.append(_case_like(word, _TRAILING_COMMA.sub('', part)) + trail)
            return ''.join(out)
        return fake

    @staticmethod
    def _address(original: str, rng: _Stream) -> str:
        comma = original.find(',')
        head = original if comma < 0 else original[:comma]
        tail = '' if comma < 0 else original[comma:]
        street = _STREET.sub(
            lambda m: m.group(1) + m.group(2) + _case_like(rng.pick(STREETS), m.group(3)), head, count=1
        )
        return _shape_digits(street, rng) + tail

    @staticmethod
    def _birth_date(original: str, rng: _Stream, row_day: Optional[_Day]) -> str:
        def pick() -> _Day:
            if row_day is not None:
                return row_day
            day = 1 + rng.below(28)
            return _Day(day, 1 + rng.below(12))

        def width(s: str, n: int) -> str:
            return _pad(n) if len(s) >= 2 else str(n)

        trimmed = _js.trim(original)
        if _EXCEL_SERIAL.fullmatch(trimmed):
            date = _EPOCH + _dt.timedelta(days=int(trimmed))
            d = pick()
            return str((_dt.date(date.year, d.month, d.day) - _EPOCH).days)
        m = _DMY.search(original)
        if m:
            d = pick()
            new = f'{width(m.group(1), d.day)}{m.group(2)}{width(m.group(3), d.month)}{m.group(2)}{m.group(4)}'
            return original[: m.start()] + new + original[m.end() :]
        m = _YMD.search(original)
        if m:
            d = pick()
            new = f'{m.group(1)}{m.group(2)}{width(m.group(3), d.month)}{m.group(2)}{width(m.group(4), d.day)}'
            return original[: m.start()] + new + original[m.end() :]
        m = _D_NAME_Y.search(original)
        if m:
            d = pick()
            word = m.group(3).lower()
            family = next((names for names in _MONTHS if word in names), _MONTHS[2])
            name = family[d.month - 1]
            styled = _case_like(name[0].upper() + name[1:], m.group(3))
            new = f'{width(m.group(1), d.day)}{m.group(2)}{styled}{m.group(4)}{m.group(5)}'
            return original[: m.start()] + new + original[m.end() :]
        return original


def kembaran(text: str, **options: object) -> KembaranResult:
    """One-shot: replaces personal data in a text with stand-ins under a random secret."""
    return Kembaran(**options).text(text)  # type: ignore[arg-type]


def main(argv: Optional[list[str]] = None) -> int:
    """``python -m lokal.kembaran prod.sql -o staging.sql``: the same as ``lokal-mcp kembaran``."""
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(
        prog='python -m lokal.kembaran',
        description='Replace Indonesian personal data in text files (SQL dumps, CSV, JSON, logs) with realistic '
        'stand-ins. Several files share one set of stand-ins, so their joins still work.',
    )
    parser.add_argument('inputs', nargs='+', type=Path)
    parser.add_argument('-o', '--output', type=Path, required=True, help='a file, or a folder for several inputs')
    parser.add_argument('--secret', help='the same secret gives the same stand-ins on every run')
    parser.add_argument('--keep', default='', help='types to leave as they are, e.g. FINANCIAL,NAME')
    parser.add_argument('--keep-birth-date', action='store_true', help='keep whole birth dates, not only the year')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args(argv)

    keep = [*KEEP_BY_DEFAULT, *(t.strip().upper() for t in args.keep.split(',') if t.strip())]
    try:
        k = Kembaran(secret=args.secret, keep=keep, keep_birth_date=args.keep_birth_date)
    except ValueError as e:
        parser.error(str(e))
    several = len(args.inputs) > 1 or args.output.is_dir()
    for src in args.inputs:
        dest = args.output / src.name if several else args.output
        if dest.exists() and not args.overwrite:
            print(f'{dest} exists; pass --overwrite to replace it', file=sys.stderr)
            return 1
        result = k.text(src.read_bytes().decode('utf-8', 'replace'))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(result.text.encode('utf-8'))
        counts = ', '.join(f'{t}={n}' for t, n in result.replaced.items()) or 'nothing found'
        print(f'{src} -> {dest}: {counts}', file=sys.stderr)
    return 0


__all__ = ['KEEP_BY_DEFAULT', 'Kembaran', 'KembaranResult', 'kembaran', 'main']

if __name__ == '__main__':
    sys.exit(main())
