from __future__ import annotations

import math
import re
from decimal import Decimal
from typing import Literal, Union

from ._js import plain_decimal

_ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan']
_SCALES = ['', 'ribu', 'juta', 'miliar', 'triliun', 'kuadriliun', 'kuintiliun']
_MAX_SAFE_INTEGER = 2**53 - 1


def _below_thousand(n: int) -> str:
    parts: list[str] = []
    hundreds, rest = divmod(n, 100)
    if hundreds == 1:
        parts.append('seratus')
    elif hundreds > 1:
        parts.append(f'{_ONES[hundreds]} ratus')

    if rest == 10:
        parts.append('sepuluh')
    elif rest == 11:
        parts.append('sebelas')
    elif 11 < rest < 20:
        parts.append(f'{_ONES[rest - 10]} belas')
    elif rest >= 20:
        parts.append(f'{_ONES[rest // 10]} puluh')
        if rest % 10:
            parts.append(_ONES[rest % 10])
    elif rest > 0:
        parts.append(_ONES[rest])
    return ' '.join(parts)


def _integer_words(value: int) -> str:
    if value == 0:
        return 'nol'
    groups: list[int] = []
    v = value
    while v > 0:
        v, g = divmod(v, 1000)
        groups.append(g)
    if len(groups) > len(_SCALES):
        raise ValueError('Angka terlalu besar untuk terbilang.')

    words: list[str] = []
    for i in range(len(groups) - 1, -1, -1):
        g = groups[i]
        if g == 0:
            continue
        if i == 1 and g == 1:
            words.append('seribu')
        else:
            words.append(' '.join(w for w in (_below_thousand(g), _SCALES[i]) if w))
    return ' '.join(words)


def terbilang(
    value: Union[int, float, Decimal],
    *,
    currency: bool = False,
    case: Literal['lower', 'sentence', 'title'] = 'lower',
) -> str:
    """Spells a number in Indonesian, for kuitansi, invoices, and cek.

    ``terbilang(1500000, currency=True)`` → "satu juta lima ratus ribu rupiah".

    ``int`` has no size limit here (up to kuintiliun), like ``bigint`` in the TypeScript package. A ``float`` must be
    a safe integer in its whole part; a ``Decimal`` is spelled from its exact digits.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise TypeError('value must be an int, float, or Decimal')
    if isinstance(value, int):
        text = ('minus ' if value < 0 else '') + _integer_words(abs(value))
    else:
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError('value must be a finite number')
        if isinstance(value, Decimal) and not value.is_finite():
            raise ValueError('value must be a finite number')
        a: Union[float, Decimal] = value.copy_abs() if isinstance(value, Decimal) else abs(value)
        if isinstance(value, float) and math.trunc(a) > _MAX_SAFE_INTEGER:
            raise ValueError('Gunakan int untuk angka sebesar ini.')
        int_part, _, frac_part = plain_decimal(a).partition('.')
        text = ('minus ' if value < 0 else '') + _integer_words(int(int_part))
        if frac_part:
            text += ' koma ' + ' '.join('nol' if d == '0' else _ONES[int(d)] for d in frac_part)

    if currency:
        text += ' rupiah'
    if case == 'sentence':
        text = text[:1].upper() + text[1:]
    if case == 'title':
        text = re.sub(r'\b\w', lambda m: m.group(0).upper(), text, flags=re.ASCII)
    return text
