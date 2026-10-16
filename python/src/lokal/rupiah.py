from __future__ import annotations

import math
import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional, Union

from ._js import WS_CHARS, number_to_string, round_half_up, trim
from ._result import Result

Number = Union[int, float, Decimal]


def _check_amount(amount: Number) -> Decimal:
    if isinstance(amount, bool) or not isinstance(amount, (int, float, Decimal)):
        raise TypeError('amount must be an int, float, or Decimal')
    d = Decimal(amount)
    if not d.is_finite():
        raise ValueError('amount must be a finite number')
    return d


def _group_thousands(int_digits: str) -> str:
    return re.sub(r'\B(?=(\d{3})+(?!\d))', '.', int_digits, flags=re.ASCII)


def format_rupiah(amount: Number, *, decimals: bool = False, symbol: bool = True) -> str:
    """1500000 → "Rp1.500.000" (PUEBI style: no space, dot thousands, comma decimals).

    Accepts ``int``, ``float``, and ``Decimal``; a ``Decimal`` from your database is formatted exactly.
    ``decimals=True`` shows sen as ",00". Rupiah is almost always shown without sen.
    """
    d = _check_amount(amount)
    a = abs(d)
    # Half-up on the exact value: the same digits as JavaScript's toFixed(2) and Math.round.
    fixed = str(a.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)) if decimals else str(round_half_up(a))
    int_part, _, frac = fixed.partition('.')
    body = _group_thousands(int_part) + (f',{frac}' if frac else '')
    sign = '-' if d < 0 and Decimal(fixed) != 0 else ''
    return f'{sign}{"Rp" if symbol else ""}{body}'


_SHORT_UNITS: list[tuple[int, str]] = [(10**12, 'T'), (10**9, 'M'), (10**6, 'jt'), (10**3, 'rb')]


def format_rupiah_short(amount: Number) -> str:
    """1500000 → "Rp1,5 jt", 2300000000 → "Rp2,3 M"."""
    d = _check_amount(amount)
    a = float(abs(d))
    sign = '-' if d < 0 else ''

    def one_decimal(size: int) -> float:
        return round_half_up((a / size) * 10) / 10

    def short(size: int, unit: str) -> str:
        return f'{sign}Rp{number_to_string(one_decimal(size)).replace(".", ",", 1)} {unit}'

    for i, (size, unit) in enumerate(_SHORT_UNITS):
        if a < size:
            continue
        # 999.999 rounds to "1000 rb"; say "1 jt" instead.
        if i > 0 and one_decimal(size) >= 1000:
            return short(*_SHORT_UNITS[i - 1])
        return short(size, unit)
    return short(10**3, 'rb') if round_half_up(a) >= 1000 else f'{sign}Rp{round_half_up(a)}'


@dataclass(slots=True)
class ParsedRupiah(Result):
    #: An int for whole amounts (almost always), a float when sen are involved.
    amount: Union[int, float]
    #: True for "2jtan", "50rb-an", "sekitar 1 juta", "2 juta lebih".
    approximate: bool = False


_DIGIT_WORDS = {
    'nol': 0, 'satu': 1, 'dua': 2, 'tiga': 3, 'empat': 4, 'lima': 5, 'enam': 6, 'tujuh': 7, 'delapan': 8, 'sembilan': 9,
}
_SCALES = {
    'ribu': 1e3, 'rb': 1e3, 'rbu': 1e3, 'rebu': 1e3, 'k': 1e3, 'ceng': 1e3,
    'juta': 1e6, 'jt': 1e6, 'jeti': 1e6,
    'miliar': 1e9, 'milyar': 1e9, 'm': 1e9,
    'triliun': 1e12, 't': 1e12,
}
_SE_SCALES = {'seribu': 1e3, 'sejuta': 1e6, 'semiliar': 1e9, 'semilyar': 1e9, 'setriliun': 1e12}
#: Jakarta slang (from Hokkien) for amounts that behave like plain numbers.
_SLANG_NUMBERS = {'jigo': 25, 'gocap': 50, 'cepek': 100, 'gopek': 500}
#: Slang for complete amounts; a number before them multiplies ("2 ceban" = 20.000).
_SLANG_AMOUNTS = {
    'seceng': 1e3, 'noceng': 2e3, 'goceng': 5e3, 'ceban': 1e4, 'noban': 2e4, 'goban': 5e4,
    'cetiao': 1e6, 'cetiau': 1e6, 'cetiaw': 1e6,
}
_FILLERS = {
    'rp', 'idr', 'rupiah', 'aja', 'saja', 'doang', 'sih', 'deh', 'kak', 'cuma', 'hanya', 'harga', 'harganya',
    'total', 'totalnya', 'senilai', 'sebesar', 'dong', 'ya', 'yah',
}
_APPROX_WORDS = {'sekitar', 'kira', 'kurang', 'lebih', 'kisaran', 'kurleb', 'an', 'ish', 'an-an'}

_NUMBER_TOKEN = re.compile(r'[0-9]+(?:[.,][0-9]+)*')
_APPROX_SUFFIX = re.compile(r'(.+?)-?an', re.DOTALL)
_TOKEN_SPLIT = re.compile(f'[{WS_CHARS}\\-/]+')
# JavaScript `\w` is ASCII: [A-Za-z0-9_].
_EDGE_PUNCT = re.compile(r'^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+\Z')


def _is_number_token(tok: str) -> bool:
    return _NUMBER_TOKEN.fullmatch(tok) is not None


def _parse_number_token(tok: str, has_unit: bool) -> float:
    """Reads "1.500.000", "1,5", "1.5", "1,500,000" with Indonesian conventions first."""
    dots = tok.count('.')
    commas = tok.count(',')
    if dots and commas:
        decimal_sep = ',' if tok.rfind(',') > tok.rfind('.') else '.'
        thousand_sep = '.' if decimal_sep == ',' else ','
        normalized = tok.replace(thousand_sep, '').replace(decimal_sep, '.', 1)
    elif dots + commas > 1:
        normalized = re.sub(r'[.,]', '', tok)
    elif dots + commas == 1:
        sep = '.' if dots else ','
        after = re.split(r'[.,]', tok)[1]
        # "1.500" is fifteen hundred; "1.5jt", "1,5jt" and "1,5" are decimals.
        is_thousands = len(after) == 3 and (not has_unit or sep == '.')
        normalized = tok.replace(sep, '', 1) if is_thousands else tok.replace(sep, '.', 1)
    else:
        normalized = tok
    return float(normalized)


def _strip_approx_suffix(tok: str) -> tuple[str, bool]:
    m = _APPROX_SUFFIX.fullmatch(tok)
    if m:
        stem = m.group(1)
        if (
            stem in _SCALES or stem in _SE_SCALES or stem in _SLANG_AMOUNTS or stem in _SLANG_NUMBERS
            or _is_number_token(stem)
        ):
            return stem, True
    return tok, False


def parse_rupiah(text: str) -> Optional[ParsedRupiah]:
    """Parses how Indonesians actually write money.

    "Rp 25.000", "1,5jt", "2jtan", "50rb-an", "goceng", "2 ceban", "sejuta setengah",
    "dua ratus lima puluh ribu", "1jt 500rb". Returns None when the text is not an amount.
    "m" is read as miliar (Indonesian usage), not million.
    """
    t = trim(str(text).lower())
    if not t:
        return None
    t = re.sub(r'[~±]', ' sekitar ', t)
    t = re.sub(r'\brp\.?', ' ', t, flags=re.ASCII)
    t = re.sub(r'([0-9])([a-z])', r'\1 \2', t)
    t = re.sub(r'([a-z])([0-9])', r'\1 \2', t)

    approximate = False
    tokens: list[str] = []
    for raw in _TOKEN_SPLIT.split(t):
        cleaned = _EDGE_PUNCT.sub('', raw)
        if not cleaned:
            continue
        tok, approx = _strip_approx_suffix(cleaned)
        if approx:
            approximate = True
        tokens.append(tok)

    total = 0.0
    current = 0.0
    last_digit = 0.0
    last_scale = 0.0
    saw_value = False

    def is_scale_token(tok: Optional[str]) -> bool:
        return tok is not None and (tok in _SCALES or tok in _SE_SCALES)

    for i, tok in enumerate(tokens):
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None

        if _is_number_token(tok):
            n = _parse_number_token(tok, is_scale_token(nxt) or (nxt is not None and nxt in _SLANG_AMOUNTS))
            if not math.isfinite(n):
                return None
            current += n
            last_digit = n
            saw_value = True
        elif tok in _DIGIT_WORDS:
            n = _DIGIT_WORDS[tok]
            current += n
            last_digit = n
            saw_value = True
        elif tok in ('sepuluh', 'sebelas', 'seratus'):
            current += 10 if tok == 'sepuluh' else 11 if tok == 'sebelas' else 100
            last_digit = 0
            saw_value = True
        elif tok == 'belas':
            current += 10
            last_digit = 0
        elif tok in ('puluh', 'ratus'):
            mult = 10 if tok == 'puluh' else 100
            current = current - last_digit + (last_digit or 1) * mult
            last_digit = 0
            saw_value = True
        elif tok in _SE_SCALES:
            scale = _SE_SCALES[tok]
            total += (current + 1) * scale
            current = 0
            last_digit = 0
            last_scale = scale
            saw_value = True
        elif tok in _SCALES:
            if not saw_value:
                return None
            scale = _SCALES[tok]
            total += (current or 1) * scale
            current = 0
            last_digit = 0
            last_scale = scale
        elif tok in _SLANG_NUMBERS:
            current += _SLANG_NUMBERS[tok]
            last_digit = 0
            saw_value = True
        elif tok in _SLANG_AMOUNTS:
            total += (current or 1) * _SLANG_AMOUNTS[tok]
            current = 0
            last_digit = 0
            last_scale = 0
            saw_value = True
        elif tok == 'setengah':
            if is_scale_token(nxt):
                current += 0.5  # "setengah juta", "dua setengah juta"
            elif last_scale:
                total += last_scale * 0.5  # "sejuta setengah"
            else:
                current += 0.5
            saw_value = True
        elif tok in _APPROX_WORDS:
            approximate = True
        elif tok in _FILLERS:
            continue
        else:
            return None

    if not saw_value:
        return None
    amount = round_half_up((total + current) * 100) / 100
    return ParsedRupiah(int(amount) if float(amount).is_integer() else amount, approximate)
