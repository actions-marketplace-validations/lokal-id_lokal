"""Free-text Indonesian addresses → Kemendagri regions, a line-by-line port of ``packages/core/src/alamat.ts``.

"Jl. Margonda Raya No. 100 RT 3/5 Kemiri Muka, Beji, Depok 16424" becomes the street, RT/RW, kode pos, and the
kelurahan, kecamatan, kota, and provinsi with their codes. Region names are matched against the Kemendagri data; a
region only counts when the rest of the address agrees with it (its parents, a level word such as "kec.", or the kode
pos), since many villages share a name.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal, Optional, Union

from ._js import rx, trim
from ._result import Result
from .wilayah import Wilayah, WilayahLevel, _region_names, get_wilayah, villages_with_postal_code

AlamatLevel = Literal['provinsi', 'kabupaten_kota', 'kecamatan', 'kelurahan_desa']
_LEVEL_KEYS: list[AlamatLevel] = ['provinsi', 'kabupaten_kota', 'kecamatan', 'kelurahan_desa']
Confidence = Literal['high', 'medium', 'low', 'none']


@dataclass(slots=True)
class ParsedAlamat(Result):
    #: Levels taken from the region's code or the kode pos, not read from the text.
    inferred: list[AlamatLevel] = field(default_factory=list)
    #: high: the kelurahan/desa and its kecamatan or kota were read from the text and agree with the kode pos.
    #: medium: a region was found and agrees with something else in the address. low: a guess. none: no region.
    confidence: Confidence = 'none'
    #: Things to check, such as a kode pos that belongs to another kelurahan.
    issues: list[str] = field(default_factory=list)
    #: Other regions the address could mean, most likely first.
    alternatives: list[Wilayah] = field(default_factory=list)
    #: Street, house number, block, and housing estate, as written: "Jl. Margonda Raya No. 100".
    street: Optional[str] = None
    #: Three digits, as Dukcapil writes them: "003".
    rt: Optional[str] = None
    rw: Optional[str] = None
    #: The kode pos as written in the address.
    postal_code: Optional[str] = None
    provinsi: Optional[Wilayah] = None
    kabupaten_kota: Optional[Wilayah] = None
    kecamatan: Optional[Wilayah] = None
    kelurahan_desa: Optional[Wilayah] = None
    #: Code of the most specific region found, e.g. "32.76.02.1005".
    code: Optional[str] = None
    #: The address in the usual order: street, RT/RW, kelurahan, kecamatan, kota, provinsi, kode pos.
    formatted: Optional[str] = None


# --- region names --------------------------------------------------------------------------------------------

_APOSTROPHES = re.compile("['’`]")
_NOT_NAME = re.compile(r'[^a-z0-9]+')


def _norm(s: str) -> str:
    return _NOT_NAME.sub(' ', _APOSTROPHES.sub('', s.lower())).strip(' ')


_PROVINCE_ALIASES: dict[str, list[str]] = {
    '11': ['nad', 'nanggroe aceh darussalam'],
    '12': ['sumut'],
    '13': ['sumbar'],
    '16': ['sumsel'],
    '19': ['babel', 'bangka belitung'],
    '21': ['kepri'],
    '31': ['dki', 'dki jakarta', 'jakarta'],
    '32': ['jabar'],
    '33': ['jateng'],
    '34': ['diy', 'yogyakarta', 'jogja', 'jogjakarta', 'yogya', 'di yogyakarta'],
    '35': ['jatim'],
    '52': ['ntb'],
    '53': ['ntt'],
    '61': ['kalbar'],
    '62': ['kalteng'],
    '63': ['kalsel'],
    '64': ['kaltim'],
    '65': ['kaltara'],
    '71': ['sulut'],
    '72': ['sulteng'],
    '73': ['sulsel'],
    '74': ['sultra'],
    '76': ['sulbar'],
    '82': ['malut'],
    '92': ['papua barat', 'pabar'],
}
_REGENCY_ALIASES: dict[str, list[str]] = {
    '31.71': ['jakpus', 'jakarta pusat'],
    '31.72': ['jakut', 'jakarta utara'],
    '31.73': ['jakbar', 'jakarta barat'],
    '31.74': ['jaksel', 'jakarta selatan'],
    '31.75': ['jaktim', 'jakarta timur'],
    '36.74': ['tangsel'],
}

_NUMERALS = [
    ['satu', 'i', '1'],
    ['dua', 'ii', '2'],
    ['tiga', 'iii', '3'],
    ['empat', 'iv', '4'],
    ['lima', 'v', '5'],
    ['enam', 'vi', '6'],
    ['tujuh', 'vii', '7'],
    ['delapan', 'viii', '8'],
    ['sembilan', 'ix', '9'],
    ['sepuluh', 'x', '10'],
]
_NUMBER_WORD = rx(r'\b(?:[ivx]+|\d+)\b')

_index: Optional[dict[str, list[str]]] = None
_longest = 1
_REGENCY_WORD = re.compile(r'^(?:kabupaten|kota)(?: administrasi)? ')


def _name_index() -> dict[str, list[str]]:
    """Normalized name → region codes, for every level. Kabupaten and kota are indexed without that word."""
    global _index, _longest
    if _index is not None:
        return _index
    index: dict[str, list[str]] = {}
    longest = 1

    def add(key: str, code: str) -> None:
        nonlocal longest
        if not key:
            return
        codes = index.setdefault(key, [])
        if code not in codes:
            codes.append(code)
        longest = max(longest, len(key.split(' ')))

    for code, name in _region_names():
        level = len(code.split('.'))
        n = _norm(name)
        if level == 2:
            add(_REGENCY_WORD.sub('', n, count=1), code)
        else:
            add(n, code)
        # "Kotabaru", "Pangkalpinang": also findable as written apart, and the other way round. Not with numbers: "Sei
        # Dadap I II" run together is "Sei Dadap III".
        if level >= 3 and ' ' in n and not _NUMBER_WORD.search(n):
            add(n.replace(' ', ''), code)
        # "Ilir Barat Dua" is also written "Ilir Barat II" or "Ilir Barat 2", and the other way round.
        if level >= 3:
            words = n.split(' ')
            for forms in _NUMERALS:
                at = next((i for i, w in enumerate(words) if i > 0 and w in forms), -1)
                if at < 0:
                    continue
                for form in forms:
                    add(' '.join([*words[:at], form, *words[at + 1 :]]), code)
    for code, aliases in [*_PROVINCE_ALIASES.items(), *_REGENCY_ALIASES.items()]:
        for alias in aliases:
            add(alias, code)
    _longest = longest
    _index = index
    return index


# --- reading the text ----------------------------------------------------------------------------------------


@dataclass(slots=True, frozen=True)
class _Hint:
    level: WilayahLevel
    kind: Optional[Literal['kota', 'kabupaten']] = None
    #: Kelurahan have codes 1xxx, desa (gampong, nagari, kampung) 2xxx. People mix the words up, so it is a preference.
    village: Optional[Literal['kelurahan', 'desa']] = None


_HINTS: dict[str, _Hint] = {
    'kel': _Hint(4, village='kelurahan'),
    'kelurahan': _Hint(4, village='kelurahan'),
    'desa': _Hint(4, village='desa'),
    'ds': _Hint(4, village='desa'),
    'gampong': _Hint(4, village='desa'),
    'nagari': _Hint(4, village='desa'),
    'kec': _Hint(3),
    'kecamatan': _Hint(3),
    'distrik': _Hint(3),
    'kab': _Hint(2, 'kabupaten'),
    'kabupaten': _Hint(2, 'kabupaten'),
    'kota': _Hint(2, 'kota'),
    'kotamadya': _Hint(2, 'kota'),
    'kodya': _Hint(2, 'kota'),
    'prov': _Hint(1),
    'provinsi': _Hint(1),
    'propinsi': _Hint(1),
    'prop': _Hint(1),
}
# Words between a level word and the name: "Kota Adm. Jakarta Selatan", "Kab. Administrasi Kepulauan Seribu".
_FILLER = frozenset(['adm', 'administrasi', 'daerah', 'tingkat', 'ii'])
# Shortened words in names, as Google Maps writes them ("Kec. Kby. Baru", "Kota Jakarta Sel.", "Tj. Priok"). The
# ones in _DOTTED only count with a dot after them, since they are also words or names of their own.
_SHORT: dict[str, str] = {
    'kby': 'kebayoran',
    'kb': 'kebon',
    'pd': 'pondok',
    'tj': 'tanjung',
    'tg': 'tanjung',
    'tlk': 'teluk',
    'kp': 'kampung',
    'ps': 'pasar',
    'klp': 'kelapa',
    'prpt': 'prapatan',
    'cemp': 'cempaka',
    'gn': 'gunung',
    'bkt': 'bukit',
    'jkt': 'jakarta',
    'utr': 'utara',
    'tgh': 'tengah',
    'bar': 'barat',
    'tim': 'timur',
    'sel': 'selatan',
    'ut': 'utara',
    'teng': 'tengah',
}
_DOTTED = frozenset(['bar', 'tim', 'sel', 'ut', 'teng', 'tg', 'gn'])
# A Google Plus Code in front of the address: "92JW+6X7".
_PLUS_CODE = rx(r'\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b', 'gi')

_STREET_START = rx(
    r'\b(?:jl|jln|jalan|gg|gang|lr|lorong|komp|komplek|kompleks|perum|perumahan|perumnas|cluster|klaster|blok|dusun|dsn|lingkungan|lingk|lk|jorong|apartemen|apartment|apt|ruko|graha|wisma|tower|menara)\b\.?',
    'gi',
)
_STREET_STOP = rx(
    r'[,;\n]|\b(?:rt|rw|kel|kelurahan|desa|ds|kec|kecamatan|distrik|kab|kabupaten|kota|prov|provinsi|propinsi)\b\.?|\b[1-9]\d{4}\b',
    'i',
)
_HOUSE_NUMBER = rx(r'\b(?:no|nomor|nmr)\b\.?\s*[\w/-]+', 'i')
_RT_RW = rx(
    r'\brt[.:]?\s*0*(\d{1,3})\b(?:\s*(?:[/\\-]|\s)\s*(?:rw[.:]?\s*)?0*(\d{1,3})\b)?|\brw[.:]?\s*0*(\d{1,3})\b',
    'gi',
)
# "Kode Pos:" in front of the kode pos.
_POSTAL_LABEL = rx(r'\b(?:kode\s*pos|kodepos|kd\.?\s*pos)\b\s*[.:]?', 'gi')
_FIRST_WORD = rx(r'^\s*[^\s,;]+')
_POSTAL = rx(r'(?<![\d.-])[1-9]\d{4}(?![\d.-])', 'g')
_NON_SPACE = rx(r'\S+', 'g')
_HOUSE_DIGITS = rx(r'^\d+[a-z]?$')
_TOKEN = rx(r"[A-Za-z0-9]+(?:['’][A-Za-z]+)?|[,;\n|()/]", 'g')
_ALNUM = rx(r'[A-Za-z0-9]')
_LETTER = rx(r'[A-Za-z]')
_TOKEN_APOSTROPHE = re.compile("['’]")

_Range = tuple[int, int]


def _street_ranges(text: str) -> list[_Range]:
    out: list[_Range] = []
    for m in _STREET_START.finditer(text):
        start = m.start()
        if out and start < out[-1][1]:
            continue
        rest = text[start + len(m[0]) :]
        # The first word is the street's name even when it is a level word: "Jalan Kota Baru", "Jl. Kecamatan".
        lead = _FIRST_WORD.search(rest)
        first = len(lead[0]) if lead else 0
        after = _STREET_STOP.search(rest[first:])
        stop = (first + after.start(), after[0]) if after else None
        before = rest[: stop[0] if stop else len(rest)]
        # Up to a comma, "RT", or "Kel."; within that, up to the house number ("No. 5", or a bare "22" after the
        # street name), or before a kota, kabupaten, or provinsi name. With nothing marking the end ("jl melati wuwur
        # gabus pati 59173": a kode pos ends the address, not the street), only the first word is surely the street.
        # The rest is left to the region names, and the street is then read as everything before them.
        delimited = stop is not None and not stop[1][:1].isdigit()
        length = 0
        for n, w in enumerate(_NON_SPACE.finditer(before), start=1):
            word = _norm(w[0])
            if n >= 2 and any(_level_of(code) <= 2 for code in _name_index().get(word, [])):
                break
            length = w.start() + len(w[0])
            if (n >= 2 and _HOUSE_DIGITS.search(word)) or not delimited:
                break
        house = _HOUSE_NUMBER.search(before)
        if house and house.start() < length:
            length = min(length, house.start() + len(house[0]))
        out.append((start, start + len(m[0]) + length))
    return out


@dataclass(slots=True)
class _Token:
    #: Lowercase, with shortened words written out ("kby." → "kebayoran").
    word: str
    #: Lowercase, as written.
    raw: str
    start: int
    end: int
    #: A comma, a line break, or a part already read (street, RT/RW, kode pos) comes before this word.
    break_before: bool


def _tokens(text: str, skip: list[_Range]) -> list[_Token]:
    out: list[_Token] = []
    pending_break = True
    for m in _TOKEN.finditer(text):
        start = m.start()
        end = start + len(m[0])
        # A slash inside a name joins its parts: "Mantehage/Buhias", "Sei Dadap III/IV".
        if m[0] == '/' and start > 0 and _LETTER.search(text[start - 1]) and _LETTER.search(text[end : end + 1]):
            continue
        if not _ALNUM.search(m[0]) or any(start < b and end > a for a, b in skip):
            pending_break = True
            continue
        raw = _TOKEN_APOSTROPHE.sub('', m[0].lower())
        short = _SHORT.get(raw)
        word = short if short and (raw not in _DOTTED or text[end : end + 1] == '.') else raw
        out.append(_Token(word, raw, start, end, pending_break))
        pending_break = False
    return out


# --- matching regions ------------------------------------------------------------------------------------------


@dataclass(slots=True)
class _Hit:
    code: str
    level: WilayahLevel
    #: Word positions in the token list, ``to`` exclusive.
    start: int
    to: int
    #: The words matched, as normalized.
    text: str
    hinted: bool
    #: No other region anywhere (at the level the address marks, if it does) has this name.
    unique: bool
    #: Unique, and more than one word ("Denpasar Selatan").
    distinctive: bool
    #: Matched with a typo ("Cibinog" for Cibinong).
    fuzzy: bool = False


@dataclass(slots=True)
class _Marked:
    """A name the address marks with a level word ("Desa Sukamaju"), to report when no such region is found."""

    level: WilayahLevel
    text: str


def _level_of(code: str) -> WilayahLevel:
    return len(code.split('.'))  # type: ignore[return-value]


def _is_kota(code: str) -> bool:
    return _level_of(code) == 2 and int(code[3:5]) >= 71


def _village_kind(code: str) -> str:
    return 'kelurahan' if code[-4:-3] == '1' else 'desa'


def _fits(code: str, hint: Optional[_Hint]) -> bool:
    return hint is None or (
        hint.level == _level_of(code) and (not hint.kind or (hint.kind == 'kota') == _is_kota(code))
    )


def _hint_at(words: list[_Token], i: int) -> Optional[_Hint]:
    """The level word right before word ``i``, skipping "adm." and the like."""
    j = i - 1
    while j >= 0 and not words[j + 1].break_before:
        w = words[j].word
        if w in _HINTS:
            return _HINTS[w]
        if w not in _FILLER:
            return None
        j -= 1
    return None


def _to_hits(
    codes: list[str], hint: Optional[_Hint], start: int, to: int, text: str, fuzzy: bool = False
) -> list[_Hit]:
    """Hits for the regions a span of words names, already narrowed to the level its level word gives."""
    # "Kel. Kamal" prefers the kelurahan in Jakarta Barat to the desa of that name.
    village = hint.village if hint else None
    preferred = village is not None and any(_village_kind(code) == village for code in codes)
    unique = not fuzzy and len(codes) == 1
    return [
        _Hit(
            code,
            _level_of(code),
            start,
            to,
            text,
            hint is not None and (not preferred or _village_kind(code) == village),
            unique,
            to - start > 1 and unique,
            fuzzy,
        )
        for code in codes
    ]


def _find_hits(words: list[_Token]) -> tuple[list[_Hit], list[_Marked]]:
    names = _name_index()
    hits: list[_Hit] = []
    marked: list[_Marked] = []
    for i in range(len(words)):
        hint = _hint_at(words, i)
        # The name after a level word may itself start with one: "Kec. Kota Baru".
        if hint and words[i].word not in _FILLER:
            name: list[str] = []
            k = i
            while k < len(words) and len(name) < 4:
                if k > i and (words[k].break_before or words[k].word in _HINTS):
                    break
                name.append(words[k].word)
                k += 1
            marked.append(_Marked(hint.level, ' '.join(name)))
        # A level word before a name is a label, not a name by itself: there is a desa called Kelurahan in Kabupaten
        # Semarang. It can start one ("Kota Maju").
        label = hint is None and words[i].word in _HINTS and i + 1 < len(words) and not words[i + 1].break_before
        key = ''
        raw = ''
        length = 0
        while length < _longest and i + length < len(words):
            length += 1
            w2 = words[i + length - 1]
            if length > 1 and w2.break_before:
                break
            key = w2.word if length == 1 else f'{key} {w2.word}'
            raw = w2.raw if length == 1 else f'{raw} {w2.raw}'
            if label and length == 1:
                continue
            written = _lookup(names, raw, length) if raw != key else []
            codes = [code for code in dict.fromkeys([*_lookup(names, key, length), *written]) if _fits(code, hint)]
            hits.extend(_to_hits(codes, hint, i, i + length, key))
    # A name inside a longer kota, kabupaten, or provinsi, or a longer name the address marks, is not a name of its
    # own: "Lampung" in "Lampung Timur", "Depok" in "Kel. Depok Jaya". Other longer names may run into the next one
    # ("wates wates kulon progo" holds a desa Wates Kulon elsewhere).
    kept = [
        h
        for h in hits
        if not any(
            (g.level <= 2 or g.hinted) and g.start <= h.start and g.to >= h.to and g.to - g.start > h.to - h.start
            for g in hits
        )
    ]
    return kept, marked


def _lookup(names: dict[str, list[str]], key: str, length: int) -> list[str]:
    # "Suka Maju" for "Sukamaju": the words run together find a name written as one.
    return [*names.get(key, []), *(names.get(key.replace(' ', ''), []) if length > 1 else [])]


# --- names with a typo -----------------------------------------------------------------------------------------

_region_pool: Optional[list[tuple[str, list[str], str]]] = None
_child_pool: Optional[dict[str, list[tuple[str, str, str]]]] = None


def _pools() -> tuple[list[tuple[str, list[str], str]], dict[str, list[tuple[str, str, str]]]]:
    """Names without spaces: kabupaten, kota, and provinsi; and the kecamatan and kelurahan of each kabupaten or
    kota."""
    global _region_pool, _child_pool
    if _region_pool is None or _child_pool is None:
        regions: list[tuple[str, list[str], str]] = []
        children: dict[str, list[tuple[str, str, str]]] = {}
        for key, codes in _name_index().items():
            flat = key.replace(' ', '')
            top = [code for code in codes if _level_of(code) <= 2]
            if top:
                regions.append((flat, top, key))
            for code in codes:
                if _level_of(code) >= 3:
                    children.setdefault(code[:5], []).append((flat, code, key))
        _region_pool = regions
        _child_pool = children
    return _region_pool, _child_pool


def _distance(a: str, b: str, most: int) -> int:
    """Edits between two words (a swap of two letters is one), or ``most + 1`` once it is more than ``most``."""
    if abs(len(a) - len(b)) > most:
        return most + 1
    before: list[int] = []
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        row = [i]
        low = i
        for j in range(1, len(b) + 1):
            d = min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (0 if a[i - 1] == b[j - 1] else 1))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d = min(d, before[j - 2] + 1)
            row.append(d)
            low = min(low, d)
        if low > most:
            return most + 1
        before = prev
        prev = row
    return prev[len(b)]


_END_NUMBER = rx(r'(?:^| )([ivx]+|\d+)$')
_LETTERS_ONLY = rx(r'^[a-z]+$')


def _end_number(name: str) -> Optional[str]:
    m = _END_NUMBER.search(name)
    return m[1] if m else None


def _allowed(letters: int) -> int:
    """Typos allowed in a name of this many letters: none in short names, where one letter makes another name."""
    return 2 if letters >= 10 else 1 if letters >= 5 else 0


@dataclass(slots=True)
class _Span:
    start: int
    to: int
    flat: str
    text: str
    hint: Optional[_Hint]


def _typo_hits(words: list[_Token], hits: list[_Hit], postal_villages: Optional[list[str]]) -> list[_Hit]:
    """Names written with a typo, for the words no region was found for: "Kab. Tasikmalayah", "Cibinog, Bogor".

    Kabupaten, kota, and provinsi are looked for everywhere; kecamatan and kelurahan only inside the kabupaten or kota
    the address names or its kode pos points to, since thousands of villages are one letter apart. The first letter
    has to match.
    """
    # A kabupaten, kota, or provinsi written right, or a name of more than one word no other region has ("Pasar
    # Minggu"), is not a typo of another name.
    covered: set[int] = set()
    for h in hits:
        if h.level <= 2 or h.distinctive:
            covered.update(range(h.start, h.to))
    spans: list[_Span] = []
    for i in range(len(words)):
        flat = ''
        for length in range(1, 4):
            if i + length > len(words):
                break
            w = words[i + length - 1]
            if (
                (length > 1 and w.break_before)
                or (i + length - 1) in covered
                or w.word in _HINTS
                or w.word in _FILLER
                or not _LETTERS_ONLY.search(w.word)
            ):
                break
            flat += w.word
            if _allowed(len(flat)):
                text = ' '.join(t.word for t in words[i : i + length])
                spans.append(_Span(i, i + length, flat, text, _hint_at(words, i)))
    if not spans:
        return []
    regions, children = _pools()
    out: list[_Hit] = []

    def add(span: _Span, candidates: Iterable[tuple[str, Union[list[str], str], str]]) -> None:
        """The closest names, if there are only a few of them."""
        most = _allowed(len(span.flat))
        # "Jaga Baya I" is not Jagabaya II, and "Rengas" not Rengas IX: a number at the end has to be the same.
        number = _end_number(span.text)
        best_distance = most + 1
        codes: list[str] = []
        for name, found, key in candidates:
            if name[0] != span.flat[0] or _end_number(key) != number:
                continue
            d = _distance(span.flat, name, min(most, best_distance))
            if d > most or d > best_distance or d == 0:
                continue
            fitting = [code for code in ([found] if isinstance(found, str) else found) if _fits(code, span.hint)]
            if not fitting:
                continue
            if d < best_distance:
                codes = []
            best_distance = d
            codes.extend(fitting)
        codes = list(dict.fromkeys(codes))
        if codes and len(codes) <= 3:
            out.extend(_to_hits(codes, span.hint, span.start, span.to, span.text, True))

    for span in spans:
        add(span, regions)
    # Where to look: the kabupaten and kota named, the kode pos, or a kecamatan the address marks or no other region
    # shares.
    scope: dict[str, None] = {}
    for h in [*hits, *out]:
        if h.level == 2:
            scope[h.code] = None
    for v in postal_villages or []:
        scope[v[:5]] = None
    if not scope:
        for h in hits:
            if h.level == 3 and (h.hinted or h.unique):
                scope[h.code[:5]] = None
    if len(scope) > 6:
        return out
    for span in spans:
        for kab in scope:
            add(span, children.get(kab, []))
    return out


@dataclass(slots=True)
class _Chain:
    node: _Hit
    #: The hits used, by level (1–4); a level the text does not name is missing.
    used: dict[int, _Hit]
    score: float
    postal_agrees: bool
    #: A name the address marks with a level word is left out ("Dusun Donomulyo, Desa Adipuro" read as Donomulyo).
    ignores_marked: bool


_WEIGHT = {1: 2, 2: 3, 3: 3, 4: 3}


def _chains(hits: list[_Hit], postal_villages: Optional[list[str]]) -> list[_Chain]:
    out: list[_Chain] = []
    for node in hits:
        used: dict[int, _Hit] = {node.level: node}
        parts = node.code.split('.')
        for level in range(node.level - 1, 0, -1):
            prefix = '.'.join(parts[:level])
            taken = list(used.values())
            candidates = [
                h for h in hits if h.code == prefix and not any(h.start < u.to and h.to > u.start for u in taken)
            ]
            # Parents come after: in "Gedung Setiabudi, Karet, Setiabudi" the second Setiabudi is Karet's kecamatan.
            candidates.sort(key=lambda h: (-int(h.start >= node.to), -(h.to - h.start), -int(h.hinted)))
            if candidates:
                used[level] = candidates[0]
        postal_agrees = bool(postal_villages) and any(
            v == node.code or v.startswith(f'{node.code}.') for v in postal_villages or []
        )
        score = 0.0
        for level, h in used.items():
            score += _WEIGHT[level] - (1 if h.fuzzy else 0) + (2 if h.hinted else 0) + 0.5 * (h.to - h.start - 1)
        # Addresses run from small to large; a kota named before its own kelurahan is likely part of a street name
        # ("Jl. Raya Bogor KM 30, Cimanggis").
        for level, h in used.items():
            for other, g in used.items():
                if other < level and g.start < h.start:
                    score -= 1.5
        if postal_agrees:
            score += 3 if node.level == 4 else 2
        elif postal_villages and node.level >= 3:
            score -= 1
        # Another kecamatan or kelurahan of the same kota named but left out: "Lengkong Gudang, Serpong, Tangsel 15311"
        # is the kelurahan Lengkong Gudang in Serpong with a wrong kode pos, not the kelurahan Serpong that has that
        # kode pos.
        taken = list(used.values())

        # Not read yet: a name repeated ("Sinduadi, Sleman, Kabupaten Sleman") is read already.
        def free(h: _Hit, taken: list[_Hit] = taken) -> bool:
            return not any((h.start < u.to and h.to > u.start) or h.text == u.text for u in taken)

        region = f'{node.code[:5]}.'
        if any(
            not h.fuzzy
            and h.level >= 3
            and h.code.startswith(region)
            and not node.code.startswith(h.code)
            and free(h)
            for h in hits
        ):
            score -= 3
        ignores_marked = any(not h.fuzzy and h.hinted and not node.code.startswith(h.code) and free(h) for h in hits)
        if ignores_marked:
            score -= 2
        # A lone name only counts when it is a kabupaten, kota, or provinsi, or the address marks or confirms it, or
        # no other region has that name. With a typo, a parent has to come after it, or the kode pos agree: "Jl. Raya
        # Metro Wates, Desa Purwodadi" is not a typo of Purwosari in Kota Metro.
        if node.fuzzy:
            parent_after = any(level < node.level and h.start >= node.to for level, h in used.items())
            supported = parent_after or postal_agrees or (node.level <= 2 and node.hinted)
        else:
            supported = len(used) > 1 or node.hinted or postal_agrees or node.level <= 2 or node.unique
        if supported:
            out.append(_Chain(node, used, score, postal_agrees, ignores_marked))
    # A tie goes to the larger region: "Pondok Aren, Tangsel" is the kecamatan, not the kelurahan of the same name.
    out.sort(key=lambda c: (-c.score, c.node.level, c.node.code))
    return out


def _with_typo(c: _Chain) -> bool:
    return any(h.fuzzy for h in c.used.values())


# --- putting it together -------------------------------------------------------------------------------------


def _common_prefix(codes: list[str]) -> str:
    """The deepest region that contains every code: "32.76.06" for two kelurahan in Beji."""
    p = codes[0]
    for v in codes[1:]:
        a = p.split('.')
        b = v.split('.')
        i = 0
        while i < len(a) and i < len(b) and a[i] == b[i]:
            i += 1
        p = '.'.join(a[:i])
    return p


def _related(a: str, b: str) -> bool:
    return a == b or a.startswith(f'{b}.') or b.startswith(f'{a}.')


_WORD_START = rx(r'\b[a-z]', 'g')


def _title(s: str) -> str:
    return _WORD_START.sub(lambda m: m[0].upper(), s)


_LEVEL_WORD = {1: 'Provinsi', 2: 'Kabupaten/kota', 3: 'Kecamatan', 4: 'Kelurahan/desa'}


def _label(w: Wilayah) -> str:
    """A region as a sentence names it: "Kecamatan Beji", "Kota Depok", "Jawa Barat"."""
    if w.level == 3:
        return f'{"Distrik" if w.type == "distrik" else "Kecamatan"} {w.name}'
    if w.level == 4:
        return f'{"Kelurahan" if w.type == "kelurahan" else "Desa"} {w.name}'
    return w.name


# A label in front of the address: "Alamat:", "Domisili -".
_LABEL = rx(
    r'^\s*(?:alamat(?:\s+(?:lengkap|rumah|domisili|pengiriman|kantor))?|domisili|address|tempat\s+tinggal)\s*[:=-]\s*',
    'i',
)
_WS_RUN = rx(r'\s+', 'g')
_EDGES = rx(r'^[\s,;.-]+|[\s,;-]+$', 'g')
_SEPARATOR_RUN = rx(r'\s*([,;])(?:\s*[,;/])+', 'g')
_TRAILING_SLASH = rx(r'\s*\/\s*$')


def _clean(s: str) -> str:
    return trim(_EDGES.sub('', _WS_RUN.sub(' ', s)))


def _street_text(part: str, read: list[_Range]) -> str:
    """The street part of the text: without the label, RT/RW, and kode pos read from it."""
    s = part
    for a, b in sorted(read, key=lambda r: -r[0]):
        if a < len(s):
            s = s[:a] + s[b:]
    return _clean(_TRAILING_SLASH.sub('', _SEPARATOR_RUN.sub(r'\1 ', _LABEL.sub('', s, count=1))))


def parse_alamat(address: str) -> ParsedAlamat:
    """Reads a free-text Indonesian address into its parts and Kemendagri regions.

    Works with commas or without, with abbreviations ("Kel.", "Kec.", "Kab.", "Jaksel", "Jabar"), and with levels
    left out: the missing ones come from the region's code and are listed in ``inferred``. Check ``confidence`` and
    ``issues`` before trusting the result.
    """
    text = str(address)[:2000]
    result = ParsedAlamat()
    skip: list[_Range] = []
    # RT/RW and the kode pos: left out of the street.
    read: list[_Range] = []

    streets = _street_ranges(text)
    if streets:
        result.street = ', '.join(s for s in (_clean(text[a:b]) for a, b in streets) if s) or None
        skip.extend(streets)
    for m in [*_PLUS_CODE.finditer(text), *_POSTAL_LABEL.finditer(text)]:
        skip.append((m.start(), m.end()))
        read.append((m.start(), m.end()))
    for m in _RT_RW.finditer(text):
        if m[1] and result.rt is None:
            result.rt = m[1].rjust(3, '0')
        rw = m[2] if m[2] is not None else m[3]
        if rw and result.rw is None:
            result.rw = rw.rjust(3, '0')
        skip.append((m.start(), m.end()))
        read.append((m.start(), m.end()))
    postals = [m for m in _POSTAL.finditer(text) if not any(a <= m.start() < b for a, b in skip)]
    postal = postals[-1] if postals else None
    if postal:
        result.postal_code = postal[0]
        skip.append((postal.start(), postal.start() + 5))
        read.append((postal.start(), postal.start() + 5))
    # House numbers outside a street ("No. 12, Beji") are not region names either.
    for m in _HOUSE_NUMBER.finditer(text):
        skip.append((m.start(), m.end()))

    postal_villages = villages_with_postal_code(result.postal_code) if result.postal_code else None
    if result.postal_code and not postal_villages:
        result.issues.append(f'Kode pos {result.postal_code} tidak terdaftar.')

    words = _tokens(text, skip)
    hits, marked = _find_hits(words)
    postal_list = postal_villages or None
    found = _chains([*hits, *_typo_hits(words, hits, postal_list)], postal_list)
    best = found[0] if found else None
    from_postal = False
    if best is None and postal_villages:
        # No region named: what the kode pos alone tells, down to the level all its villages share.
        shared = _common_prefix(postal_villages)
        if shared:
            level = _level_of(shared)
            best = _Chain(_Hit(shared, level, 0, 0, '', False, False, False), {}, 0, True, False)
            from_postal = True
    if best is None:
        for mk in marked:
            result.issues.append(f'{_LEVEL_WORD[mk.level]} {_title(mk.text)} tidak ditemukan di data Kemendagri.')
        # No region to end the street at: all of it is the street ("Jalan Kota Baru").
        if result.street and not marked:
            result.street = _street_text(text, read) or result.street
        result.formatted = _format(result)
        return result

    # Everything before the first region named is the street part: "Kp. Rawa Badak", "Rumah kuning dekat masjid".
    if best.used:
        first = min(h.start for h in best.used.values())
        while (
            first > 0
            and not words[first].break_before
            and (words[first - 1].word in _HINTS or words[first - 1].word in _FILLER)
        ):
            first -= 1
        street = _street_text(text[: words[first].start], read)
        if street:
            result.street = street

    code = best.node.code
    # A kecamatan or kota named in the text, and a kode pos used inside it by one kelurahan only (or by several in one
    # kecamatan): that kelurahan (or kecamatan).
    if best.node.level <= 3 and best.postal_agrees and postal_villages:
        inside = [v for v in postal_villages if v.startswith(f'{code}.')]
        if inside:
            code = _common_prefix(inside)
    parts = code.split('.')
    for depth in range(1, len(parts) + 1):
        key = _LEVEL_KEYS[depth - 1]
        setattr(result, key, get_wilayah('.'.join(parts[:depth])))
        if depth not in best.used:
            result.inferred.append(key)
    result.code = code

    # Other readings: different regions that scored nearly as well. A reading with a typo only competes with another
    # one.
    rivals = found if _with_typo(best) else [c for c in found if not _with_typo(c)]
    seen = {code}
    for c in rivals:
        if c is best:
            continue
        if c.score < best.score - 2 or len(result.alternatives) >= 3:
            break
        if c.node.code in seen or _related(code, c.node.code):
            continue
        seen.add(c.node.code)
        alternative = get_wilayah(c.node.code)
        if alternative:
            result.alternatives.append(alternative)
    following = next((c for c in rivals if c is not best), None)
    ambiguous = following is not None and following.score == best.score and not _related(code, following.node.code)

    village = result.kelurahan_desa
    if result.postal_code and postal_villages and not best.postal_agrees:
        expected = village.postal_code if village else None
        where = village or result.kecamatan or result.kabupaten_kota or result.provinsi
        if expected and village:
            result.issues.append(
                f'Kode pos {result.postal_code} bukan milik {_label(village)} (kode posnya {expected}).'
            )
        elif where:
            result.issues.append(f'Kode pos {result.postal_code} tidak berada di {_label(where)}.')
    if ambiguous:
        result.issues.append('Alamat ini cocok dengan lebih dari satu wilayah; lihat alternatives.')
    deepest = result.kelurahan_desa or result.kecamatan or result.kabupaten_kota or result.provinsi
    for mk in marked:
        if mk.level in best.used or mk.level <= best.node.level or deepest is None:
            continue
        result.issues.append(
            f'{_LEVEL_WORD[mk.level]} {_title(mk.text)} tidak ditemukan di {_label(deepest)} menurut data Kemendagri.'
        )

    # Names read with a typo: say what they were taken for.
    typos = [h for h in best.used.values() if h.fuzzy]
    for h in typos:
        written = text[words[h.start].start : words[h.to - 1].end]
        typo_region = get_wilayah(h.code)
        if typo_region:
            result.issues.append(f'"{written}" dibaca sebagai {_label(typo_region)}.')

    chain = best

    def named(level: int) -> bool:
        return level in chain.used

    # Another region nearly as likely ("Kemiri, Purworejo": the kecamatan, or the desa of that name elsewhere in it),
    # or a kelurahan nearly as likely if a name has a typo ("Kedunsari, Klirong": Kedungsari, not the desa Klirong).
    contested = any(
        c is not best
        and not _related(code, c.node.code)
        and (c.node.level == 4 and c.score >= best.score - 1 if _with_typo(c) else c.score >= best.score - 3)
        for c in found
    )
    if from_postal or ambiguous:
        result.confidence = 'low'
    elif (
        village
        and named(4)
        and (named(3) or named(2))
        and (best.postal_agrees or not result.postal_code)
        and not contested
        and not best.ignores_marked
        and not typos
    ):
        result.confidence = 'high'
    elif (
        len(best.used) > 1
        or best.postal_agrees
        or (best.node.hinted and best.node.unique)
        or best.node.level <= 2
        or best.node.distinctive
    ):
        result.confidence = 'medium'
    else:
        result.confidence = 'low'

    result.formatted = _format(result)
    return result


def _format(r: ParsedAlamat) -> Optional[str]:
    parts: list[str] = []
    if r.street:
        parts.append(r.street)
    if r.rt or r.rw:
        parts.append('/'.join(p for p in (r.rt and f'RT {r.rt}', r.rw and f'RW {r.rw}') if p))
    if r.kelurahan_desa:
        parts.append(_label(r.kelurahan_desa))
    if r.kecamatan:
        parts.append(_label(r.kecamatan))
    if r.kabupaten_kota:
        parts.append(r.kabupaten_kota.name)
    if r.provinsi:
        parts.append(r.provinsi.name)
    postal = r.postal_code or (r.kelurahan_desa.postal_code if r.kelurahan_desa else None)
    if not parts and not postal:
        return None
    return f'{", ".join(parts)} {postal}'.strip(' ') if postal else ', '.join(parts)
