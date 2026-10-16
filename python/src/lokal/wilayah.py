"""Kemendagri administrative regions (provinsi → kabupaten/kota → kecamatan → kelurahan/desa) with kode pos.

The data (Kepmendagri 300.2.2-2138/2025) ships with the package and is loaded on first use: about 0.25 s and
20 MB of memory for all 83,762 villages. Importing ``lokal`` alone does not load it.
"""

from __future__ import annotations

import gzip
import json
import re
import threading
from dataclasses import dataclass
from importlib import resources
from typing import Literal, Optional

from ._js import trim
from ._result import Result

WilayahLevel = Literal[1, 2, 3, 4]
WilayahType = Literal['provinsi', 'kabupaten', 'kota', 'kecamatan', 'distrik', 'kelurahan', 'desa', 'desa_adat']


@dataclass(slots=True, frozen=True)
class Wilayah(Result):
    #: Dotted Kemendagri code: "32", "32.76", "32.76.01", "32.76.01.1001"
    code: str
    name: str
    level: WilayahLevel
    type: WilayahType
    #: "Kota Depok, Jawa Barat": the region with its parents, nearest first.
    path: str
    #: Kode pos, for kelurahan/desa.
    postal_code: Optional[str] = None


_lock = threading.Lock()
_cache: dict[str, dict[str, str]] = {}
_child_index: Optional[dict[str, list[str]]] = None


def _load(name: str) -> dict[str, str]:
    data = _cache.get(name)
    if data is None:
        with _lock:
            data = _cache.get(name)
            if data is None:
                raw = resources.files('lokal').joinpath('data').joinpath(f'{name}.json.gz').read_bytes()
                data = json.loads(gzip.decompress(raw))
                _cache[name] = data
    return data


def _base() -> dict[str, str]:
    return _load('wilayah')


def _desa() -> dict[str, str]:
    return _load('desa')


def _kodepos() -> dict[str, str]:
    return _load('kodepos')


_NON_DIGIT = re.compile(r'[^0-9]')


def normalize_wilayah_code(code: str) -> str:
    """Accepts "3276", "32.76", "3276011001" and returns the dotted form."""
    c = trim(str(code))
    if '.' in c:
        return c
    d = _NON_DIGIT.sub('', c)
    return '.'.join(p for p in (d[0:2], d[2:4], d[4:6], d[6:10]) if p)


def _level_of(code: str) -> WilayahLevel:
    return len(code.split('.'))  # type: ignore[return-value]


_KOTA = re.compile(r'kota\b', re.ASCII | re.IGNORECASE)


def _type_of(code: str, name: str) -> WilayahType:
    level = _level_of(code)
    if level == 1:
        return 'provinsi'
    if level == 2:
        return 'kota' if _KOTA.match(name) else 'kabupaten'
    if level == 3:
        return 'distrik' if int(code[:2]) >= 91 else 'kecamatan'
    # Fourth segment: 1xxx kelurahan, 2xxx desa, 3xxx desa adat (Kabupaten Jayapura).
    first = code.split('.')[3][:1]
    return 'kelurahan' if first == '1' else 'desa_adat' if first == '3' else 'desa'


def wilayah_name(code: str) -> Optional[str]:
    """Name of a region by code, or None. Pass this as ``lookup_wilayah`` to ``parse_nik``."""
    c = normalize_wilayah_code(code)
    return (_desa() if _level_of(c) == 4 else _base()).get(c)


def _to_wilayah(code: str, name: str) -> Wilayah:
    parts = code.split('.')
    names = [name]
    base = _base()
    for i in range(len(parts) - 1, 0, -1):
        parent_name = base.get('.'.join(parts[:i]))
        if parent_name:
            names.append(parent_name)
    level = _level_of(code)
    return Wilayah(
        code=code,
        name=name,
        level=level,
        type=_type_of(code, name),
        path=', '.join(names),
        postal_code=_kodepos().get(code) if level == 4 else None,
    )


def get_wilayah(code: str) -> Optional[Wilayah]:
    c = normalize_wilayah_code(code)
    name = wilayah_name(c)
    return _to_wilayah(c, name) if name else None


def _get_child_index() -> dict[str, list[str]]:
    global _child_index
    if _child_index is None:
        index: dict[str, list[str]] = {}
        for source in (_base(), _desa()):
            for code in source:
                parent = code[: code.rfind('.')] if '.' in code else ''
                index.setdefault(parent, []).append(code)
        _child_index = index
    return _child_index


def list_wilayah(parent_code: Optional[str] = None) -> list[Wilayah]:
    """Direct children of a region, for cascading address dropdowns. No code → the 38 provinces."""
    parent = normalize_wilayah_code(parent_code) if parent_code else ''
    return [_to_wilayah(c, wilayah_name(c) or '') for c in _get_child_index().get(parent, [])]


def postal_codes_in(code: str) -> list[str]:
    """All kode pos inside a region, e.g. every kode pos in Kota Depok ("32.76")."""
    c = normalize_wilayah_code(code)
    prefix = f'{c}.'
    return sorted({pos for desa_code, pos in _kodepos().items() if desa_code == c or desa_code.startswith(prefix)})


_POSTAL = re.compile(r'[0-9]{5}')


def find_by_postal_code(postal_code: str) -> list[Wilayah]:
    """Kelurahan/desa that use a kode pos. One kode pos often covers several villages."""
    pos = trim(str(postal_code))
    if not _POSTAL.fullmatch(pos):
        return []
    desa = _desa()
    return [_to_wilayah(code, desa[code]) for code, p in _kodepos().items() if p == pos]


_PREFIX = re.compile(
    r'^(provinsi|prov|kabupaten|kab|kota administrasi|kota adm|kota|kecamatan|kec|distrik|kelurahan|kel|desa)\.?\s+',
    re.ASCII,
)
_NAME_NOISE = re.compile(r"[^a-z0-9' ]+")
_SPACES = re.compile(r'\s+', re.ASCII)


def _normalize_name(s: str) -> str:
    s = _NAME_NOISE.sub(' ', s.lower())
    s = _SPACES.sub(' ', s).strip()
    return _PREFIX.sub('', s, count=1)


def search_wilayah(
    query: str,
    *,
    level: Optional[WilayahLevel] = None,
    within: Optional[str] = None,
    limit: int = 10,
) -> list[Wilayah]:
    """Finds regions by name. "depok" → Kota Depok; "kec. cibinong" → Cibinong.

    Villages are only searched when ``level`` is 4 or ``within`` points at a kecamatan or lower, since many villages
    share names. ``within="32"`` keeps results inside Jawa Barat.
    """
    q = _normalize_name(query)
    if not q:
        return []
    inside = normalize_wilayah_code(within) if within else None
    include_desa = level == 4 or (inside is not None and _level_of(inside) >= 3)

    scored: list[tuple[int, str, str]] = []

    def consider(source: dict[str, str]) -> None:
        for code, name in source.items():
            if level and _level_of(code) != level:
                continue
            if inside and not (code == inside or code.startswith(f'{inside}.')):
                continue
            n = _normalize_name(name)
            if n == q:
                score = 100
            elif n.startswith(q):
                score = 80
            elif f' {q}' in f' {n}':
                score = 60
            elif q in n:
                score = 40
            else:
                continue
            # Prefer larger regions when names tie: "Bogor" the kabupaten before the kecamatan.
            scored.append((score - _level_of(code), code, name))

    consider(_base())
    if include_desa:
        consider(_desa())

    scored.sort(key=lambda s: (-s[0], s[1]))
    return [_to_wilayah(code, name) for _, code, name in scored[:limit]]
