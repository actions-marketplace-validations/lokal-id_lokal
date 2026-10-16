"""JavaScript semantics this port relies on, so results match @lokal-id/core exactly.

Python's `re` and string methods differ from JavaScript's in ways that change results on real text:
`\\s` and `str.strip()` treat other characters as whitespace, `$` also matches before a final newline,
and `round()` rounds half to even. Every pattern in this package is compiled with ``re.ASCII`` (JavaScript's
``\\d``, ``\\w`` and ``\\b`` are ASCII-only) and uses the whitespace class below instead of ``\\s``.
"""

from __future__ import annotations

import math
import re
from decimal import ROUND_HALF_UP, Decimal

# JavaScript's WhiteSpace and LineTerminator characters: what `\s` and `String.prototype.trim` cover.
_WS_CODES = (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F,
             0x3000, 0xFEFF)
WS_SET = frozenset(map(chr, _WS_CODES))
WS_CHARS = ''.join(rf'\x{c:02x}' if c < 0x100 else rf'\u{c:04x}' for c in _WS_CODES)  # regex-escaped
WS = f'[{WS_CHARS}]'
NOT_WS = f'[^{WS_CHARS}]'
# Line terminators for `^` / `$` in multiline mode.
LINE_TERMINATORS = ''.join(rf'\u{c:04x}' for c in (0x0A, 0x0D, 0x2028, 0x2029))  # regex-escaped
BOL = f'(?:(?<=[{LINE_TERMINATORS}])|\\A)'
EOL = f'(?=[{LINE_TERMINATORS}]|\\Z)'

_TRIM = re.compile(f'^{WS}+|{WS}+\\Z')
_WS_RUN = re.compile(f'{WS}+')


def compile(pattern: str, flags: int = 0) -> re.Pattern[str]:  # noqa: A001 - mirrors re.compile
    """Compiles a pattern written with ``{WS}``-style JavaScript semantics (ASCII classes)."""
    return re.compile(pattern, flags | re.ASCII)


_ANY = f'[^{LINE_TERMINATORS}]'


def rx(pattern: str, flags: str = '') -> re.Pattern[str]:
    """Compiles a JavaScript regex source with JavaScript semantics.

    ``flags`` takes the JavaScript letters: ``i`` (case-insensitive) and ``m`` (multiline) change matching; ``g``,
    ``y`` and ``d`` are accepted and ignored (iterate with ``finditer``, use ``match(text, pos)`` for sticky).
    Outside a character class ``\\s``/``\\S``, ``.``, ``^`` and ``$`` are rewritten to their JavaScript meaning;
    inside a class ``\\s`` becomes the JavaScript whitespace set.
    """
    multiline = 'm' in flags
    out: list[str] = []
    in_class = False
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == '\\':
            nxt = pattern[i + 1]
            if nxt == 's':
                out.append(WS_CHARS if in_class else WS)
            elif nxt == 'S' and not in_class:
                out.append(NOT_WS)
            else:
                out.append(pattern[i : i + 2])
            i += 2
            continue
        if in_class:
            if ch == ']':
                in_class = False
                out.append(ch)
            elif ch == '[':
                out.append('\\[')  # a literal "[" inside a class; Python warns about possible nested sets
            else:
                out.append(ch)
        elif ch == '[':
            in_class = True
            out.append(ch)
            # "[^]..." and "[]..." keep a leading "]" or "^" inside the class.
            if pattern[i + 1 : i + 2] == '^':
                out.append('^')
                i += 1
        elif ch == '.':
            out.append(_ANY)
        elif ch == '^':
            out.append(BOL if multiline else '^')
        elif ch == '$':
            out.append(EOL if multiline else '\\Z')
        else:
            out.append(ch)
        i += 1
    return re.compile(''.join(out), re.ASCII | (re.IGNORECASE if 'i' in flags else 0))


def trim(s: str) -> str:
    return _TRIM.sub('', s)


def split_ws(s: str) -> list[str]:
    """``s.split(/\\s+/)``."""
    return _WS_RUN.split(s)


def has_ws(s: str) -> bool:
    return _WS_RUN.search(s) is not None


def round_half_up(x: float | Decimal) -> int:
    """``Math.round`` for non-negative numbers, computed exactly (no float drift at .5)."""
    return int(Decimal(x).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def number_to_string(x: float | int) -> str:
    """``Number.prototype.toString``: shortest round-trip digits, no ".0" on whole numbers."""
    if isinstance(x, int):
        return str(x)
    if math.isfinite(x) and x == int(x) and abs(x) < 1e21:
        return str(int(x))
    r = repr(x)
    m = re.fullmatch(r'(-?)(\d)(?:\.(\d+))?e([+-])0*(\d+)', r)
    if m:
        sign, lead, frac, esign, exp = m.groups()
        e = int(exp) if esign == '+' else -int(exp)
        if -7 < e < 21:
            return sign + plain_decimal(abs(x))
        return f'{sign}{lead}{"." + frac if frac else ""}e{esign}{int(exp)}'
    return r


def plain_decimal(x: float | int | Decimal) -> str:
    """The shortest decimal digits of a non-negative number without exponent notation: 1e-7 → "0.0000001"."""
    if isinstance(x, int):
        return str(x)
    if isinstance(x, Decimal):
        s = format(x.normalize(), 'f') if x != 0 else '0'
        return s
    s = repr(float(x))
    m = re.fullmatch(r'(\d+)(?:\.(\d+))?e([+-]\d+)', s)
    if not m:
        return s[:-2] if s.endswith('.0') else s
    int_digits, frac, exp = m.group(1), m.group(2) or '', int(m.group(3))
    digits = int_digits + frac
    point = len(int_digits) + exp
    if point <= 0:
        return '0.' + '0' * -point + digits
    if point >= len(digits):
        return digits + '0' * (point - len(digits))
    return f'{digits[:point]}.{digits[point:]}'
