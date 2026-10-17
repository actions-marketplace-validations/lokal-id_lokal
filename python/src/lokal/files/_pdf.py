"""Minimal PDF text reader for scanning and masking, without dependencies (port of packages/mcp/src/pdf.ts).

It covers PDFs that a program wrote: invoices, letters, statements, forms, and reports from browsers, Word, and PDF
libraries. It reads every object (also inside object streams), decodes Flate, ASCII85, and ASCIIHex streams, and turns
each page's text operators into lines, using the font's ToUnicode map or its encoding, and glyph widths to tell word
gaps from kerning and table columns. Filled-in form fields, stamps, and comments are read as well. A scanned page has
no text operators, so it comes back empty and the caller reports it as needing OCR. Encrypted PDFs raise.

The output must equal the TypeScript reader's, so JavaScript semantics are kept where they differ from Python's: the
JavaScript whitespace set, ``undefined`` versus PDF ``null``, NaN in ``Math.min``/``Math.max`` and ``||``, and strings
built from UTF-16 code units.
"""

from __future__ import annotations

import contextlib
import math
import re
import unicodedata
import zlib
from typing import Final, Optional, Union

from .. import _js
from .._js import rx


class PdfError(ValueError):
    """A PDF that cannot be read: not a PDF, encrypted, without pages, or damaged beyond use."""


class _Undefined:
    """JavaScript's ``undefined``: a missing key or object, as opposed to the PDF value ``null`` (None)."""

    __slots__ = ()

    def __repr__(self) -> str:
        return 'undefined'


UNDEF: Final = _Undefined()


class Name:
    __slots__ = ('v',)

    def __init__(self, v: str) -> None:
        self.v = v


class Str:
    """A PDF string: its bytes as a latin1 string."""

    __slots__ = ('v',)

    def __init__(self, v: str) -> None:
        self.v = v


class Ref:
    __slots__ = ('gen', 'num')

    def __init__(self, num: int, gen: int) -> None:
        self.num = num
        self.gen = gen


class Op:
    __slots__ = ('v',)

    def __init__(self, v: str) -> None:
        self.v = v


class Stream:
    __slots__ = ('dict', 'raw', 'truncated')

    def __init__(self, d: PdfDict, raw: bytes, truncated: bool = False) -> None:
        self.dict = d
        self.raw = raw
        # The file ends inside this stream: a cut-off download or a partial copy.
        self.truncated = truncated


Value = Union[float, bool, None, Name, Str, Ref, Op, Stream, 'dict[str, Value]', 'list[Value]', _Undefined]
PdfDict = dict[str, Value]

_SKIP = re.compile(r'(?:[\x00\t\n\x0c\r ]+|%[^\r\n]*)*')
_REGULAR = re.compile(r'[^\x00\t\n\x0c\r ()<>\[\]{}/%]*')
# Whitespace and comments, then a run of regular characters (group 1) or one delimiter (group 2); neither at the end.
_NEXT = re.compile(r'(?:[\x00\t\n\x0c\r ]+|%[^\r\n]*)*(?:([^\x00\t\n\x0c\r ()<>\[\]{}/%]+)|(.))?', re.S)
# After an integer: " 0 R" makes it a reference.
_REF_TAIL = re.compile(
    r'(?:[\x00\t\n\x0c\r ]+|%[^\r\n]*)*([0-9]+)(?![^\x00\t\n\x0c\r ()<>\[\]{}/%])'
    r'(?:[\x00\t\n\x0c\r ]+|%[^\r\n]*)*R(?=[\x00\t\n\x0c\r ()<>\[\]{}/%]|\Z)'
)
_NUMBER = re.compile(r'[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)')
_NUMBER_START: Final = frozenset('0123456789+-.')
_NAME_ESCAPE = re.compile(r'#([0-9A-Fa-f]{2})')
_NOT_HEX = re.compile(r'[^0-9A-Fa-f]')
_LITERAL_SPECIAL = re.compile(r'[\\()]')
_ESCAPES: Final = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f'}
_MAX_DEPTH = 64


def _is_num(v: object) -> bool:
    return type(v) is float


class _Lexer:
    __slots__ = ('pos', 's')

    def __init__(self, s: str) -> None:
        self.s = s
        self.pos = 0

    def skip(self) -> None:
        m = _SKIP.match(self.s, self.pos)
        if m:
            self.pos = m.end()

    def _regular(self) -> str:
        m = _REGULAR.match(self.s, self.pos)
        if not m:
            return ''
        self.pos = m.end()
        return m.group(0)

    def value(self, depth: int = 0) -> Value:
        """The next value or operator, or UNDEF at the end."""
        if depth > _MAX_DEPTH:
            raise PdfError('PDF nesting too deep.')
        s = self.s
        m = _NEXT.match(s, self.pos)
        if m is None:
            return UNDEF
        token = m.group(1)
        if token is not None:
            self.pos = m.end()
            if token[0] in _NUMBER_START and _NUMBER.fullmatch(token):
                if token.isascii() and token.isdigit():
                    ref = _REF_TAIL.match(s, self.pos)
                    if ref:
                        # "12 0 R" is a reference.
                        self.pos = ref.end()
                        return Ref(int(token), int(ref.group(1)))
                return float(token)
            if token == 'true':
                return True
            if token == 'false':
                return False
            if token == 'null':
                return None
            return Op(token)
        c = m.group(2)
        if c is None:
            self.pos = m.end()
            return UNDEF
        self.pos = m.start(2)
        if c == '/':
            self.pos += 1
            return Name(_NAME_ESCAPE.sub(lambda m: chr(int(m.group(1), 16)), self._regular()))
        if c == '(':
            return self._literal()
        if c == '<':
            if s.startswith('<<', self.pos):
                self.pos += 2
                d: PdfDict = {}
                while True:
                    self.skip()
                    if self.pos >= len(s):
                        break
                    if s.startswith('>>', self.pos):
                        self.pos += 2
                        break
                    key = self.value(depth + 1)
                    if key is UNDEF:
                        break
                    if not isinstance(key, Name):
                        continue
                    val = self.value(depth + 1)
                    if val is UNDEF:
                        break
                    d[key.v] = val
                return d
            close = s.find('>', self.pos)
            hexdigits = _NOT_HEX.sub('', s[self.pos + 1 : len(s) if close < 0 else close])
            self.pos = len(s) if close < 0 else close + 1
            if len(hexdigits) % 2:
                hexdigits += '0'
            return Str(bytes.fromhex(hexdigits).decode('latin1'))
        if c == '[':
            self.pos += 1
            arr: list[Value] = []
            while True:
                self.skip()
                if self.pos >= len(s):
                    break
                if s[self.pos] == ']':
                    self.pos += 1
                    break
                v = self.value(depth + 1)
                if v is UNDEF:
                    break
                arr.append(v)
            return arr
        # A stray delimiter: ")", ">", "]", "{" or "}".
        self.pos += 1
        return Op(c)

    def _literal(self) -> Str:
        s = self.s
        n = len(s)
        depth = 1
        out: list[str] = []
        pos = self.pos + 1
        while pos < n:
            m = _LITERAL_SPECIAL.search(s, pos)
            if not m:
                out.append(s[pos:])
                pos = n
                break
            out.append(s[pos : m.start()])
            c = s[m.start()]
            pos = m.start() + 1
            if c == '\\':
                if pos >= n:
                    break
                e = s[pos]
                pos += 1
                if '0' <= e <= '7':
                    octal = e
                    while len(octal) < 3 and pos < n and '0' <= s[pos] <= '7':
                        octal += s[pos]
                        pos += 1
                    out.append(chr(int(octal, 8) & 0xFF))
                elif e == '\r':
                    if pos < n and s[pos] == '\n':
                        pos += 1
                elif e != '\n':
                    out.append(_ESCAPES.get(e, e))
            elif c == '(':
                depth += 1
                out.append(c)
            else:
                depth -= 1
                if depth == 0:
                    break
                out.append(c)
        self.pos = pos
        return Str(''.join(out))


# Decompressed streams above this are cut off: a few KB of Flate can expand to gigabytes.
_MAX_STREAM_BYTES = 64 * 1024 * 1024
_A85_START = rx(r'^\s*<~')


def _ascii85(data: str) -> bytes:
    out = bytearray()
    group: list[int] = []
    for ch in _A85_START.sub('', data, count=1):
        if ch == '~':
            break
        if ch == 'z' and not group:
            out += b'\x00\x00\x00\x00'
            continue
        code = ord(ch)
        if code < 33 or code > 117:
            continue
        group.append(code - 33)
        if len(group) == 5:
            n = 0
            for d in group:
                n = n * 85 + d
            out += (n & 0xFFFFFFFF).to_bytes(4, 'big')
            group = []
    if len(group) > 1:
        size = len(group)
        group += [84] * (5 - size)
        n = 0
        for d in group:
            n = n * 85 + d
        out += (n & 0xFFFFFFFF).to_bytes(4, 'big')[: size - 1]
    return bytes(out)


class _TooLarge(Exception):
    pass


def _decompress(data: bytes, wbits: int) -> bytes:
    d = zlib.decompressobj(wbits)
    out = d.decompress(data, _MAX_STREAM_BYTES)
    if d.unconsumed_tail:
        raise _TooLarge
    return out


def _inflate(data: bytes) -> bytes:
    # A truncated stream keeps what decompresses; some writers leave out the zlib header (raw deflate).
    try:
        return _decompress(data, 15)
    except _TooLarge:
        raise PdfError('A PDF stream is too large to decompress.') from None
    except zlib.error as first:
        try:
            return _decompress(data, -15)
        except _TooLarge:
            raise PdfError('A PDF stream is too large to decompress.') from None
        except zlib.error:
            raise PdfError(str(first)) from None


_OBJ = rx(r'(\d+)\s+(\d+)\s+obj\b')
_ENDSTREAM_AFTER = rx(r'^\s*endstream')
_TRAILER = rx(r'trailer\s*<<')


class _Pdf:
    def __init__(self, buf: bytes) -> None:
        self.objects: dict[int, tuple[Value, int]] = {}
        self._decoded: dict[int, str] = {}
        self._fonts: dict[int, _Font] = {}
        self.truncated: set[int] = set()
        self.trailers: list[PdfDict] = []
        s = buf.decode('latin1')
        pos = 0
        while True:
            m = _OBJ.search(s, pos)
            if not m:
                break
            lx = _Lexer(s)
            lx.pos = m.end()
            try:
                value = lx.value()
            except PdfError:
                pos = m.end()
                continue
            if value is UNDEF:
                break
            lx.skip()
            # The file ends inside this object: a page cut off here may have lost its /Contents.
            if lx.pos >= len(s) and isinstance(value, dict):
                self.truncated.add(id(value))
            if isinstance(value, dict) and s.startswith('stream', lx.pos):
                start = lx.pos + 6
                if s[start : start + 1] == '\r':
                    start += 1
                if s[start : start + 1] == '\n':
                    start += 1
                length = value.get('Length', UNDEF)
                end = -1
                if _is_num(length) and length.is_integer() and length >= 0 and start + length <= len(s):  # type: ignore[union-attr,operator]
                    n = int(length)  # type: ignore[arg-type]
                    if _ENDSTREAM_AFTER.match(s[start + n : start + n + 32]):
                        end = start + n
                truncated = False
                if end < 0:
                    # An indirect or wrong /Length: the data ends at "endstream".
                    end = s.find('endstream', start)
                    if end < 0:
                        end = len(s)
                        truncated = True
                    if end >= 1 and s[end - 1] == '\n':
                        end -= 1
                    if end >= 1 and s[end - 1] == '\r':
                        end -= 1
                value = Stream(value, buf[start : max(start, end)], truncated)
                pos = max(end, start)
            else:
                pos = max(m.end(), lx.pos)
            if isinstance(value, Stream) and self.name_of(value.dict.get('Type', UNDEF)) == 'XRef':
                self.trailers.append(value.dict)
            # A later definition replaces an earlier one, as in an incremental update.
            self.objects[int(m.group(1))] = (value, m.start())
        for m in _TRAILER.finditer(s):
            lx = _Lexer(s)
            lx.pos = m.start() + 7
            t = lx.value()
            if isinstance(t, dict):
                self.trailers.append(t)
        if any('Encrypt' in t for t in self.trailers):
            raise PdfError('The PDF is encrypted (password-protected).')
        self._expand_object_streams()

    def _expand_object_streams(self) -> None:
        for value, at in list(self.objects.values()):
            if not isinstance(value, Stream) or self.name_of(value.dict.get('Type', UNDEF)) != 'ObjStm':
                continue
            try:
                data = self.data(value)
            except PdfError:
                continue
            n = self.num(value.dict.get('N', UNDEF))
            first = self.num(value.dict.get('First', UNDEF))
            lx = _Lexer(data)
            header: list[float] = []
            i = 0
            while i < 2 * n:
                v = lx.value()
                if not _is_num(v):
                    break
                header.append(v)  # type: ignore[arg-type]
                i += 1
            for i in range(0, len(header) - 1, 2):
                num = header[i]
                pos = first + header[i + 1]
                if not num.is_integer() or not pos.is_integer() or pos < 0:
                    continue
                existing = self.objects.get(int(num))
                if existing and existing[1] > at:
                    continue
                ox = _Lexer(data)
                ox.pos = int(pos)
                try:
                    v = ox.value()
                except PdfError:
                    continue  # skip a damaged object
                if v is not UNDEF:
                    self.objects[int(num)] = (v, at)

    def resolve(self, v: Value) -> Value:
        for _ in range(32):
            if not isinstance(v, Ref):
                break
            entry = self.objects.get(v.num)
            v = entry[0] if entry else UNDEF
        return UNDEF if isinstance(v, Ref) else v

    def dict(self, v: Value) -> Optional[PdfDict]:
        r = self.resolve(v)
        if isinstance(r, Stream):
            return r.dict
        return r if isinstance(r, dict) else None

    def name_of(self, v: Value) -> Optional[str]:
        r = self.resolve(v)
        return r.v if isinstance(r, Name) else None

    def num(self, v: Value, fallback: float = 0.0) -> float:
        r = self.resolve(v)
        return r if _is_num(r) else fallback  # type: ignore[return-value]

    def data(self, stream: Stream) -> str:
        """A stream's decoded bytes, as a latin1 string."""
        cached = self._decoded.get(id(stream))
        if cached is not None:
            return cached
        filters = self.resolve(stream.dict.get('Filter', UNDEF))
        listed = filters if isinstance(filters, list) else [] if filters is UNDEF else [filters]
        names = [self.name_of(f) for f in listed]
        buf = stream.raw
        for f in names:
            if f in ('FlateDecode', 'Fl'):
                buf = _inflate(buf)
            elif f in ('ASCII85Decode', 'A85'):
                buf = _ascii85(buf.decode('latin1'))
            elif f in ('ASCIIHexDecode', 'AHx'):
                digits = _NOT_HEX.sub('', buf.decode('latin1').split('>', 1)[0])
                buf = bytes.fromhex(digits[: len(digits) // 2 * 2])
            else:
                raise PdfError(f'Unsupported PDF filter {"undefined" if f is None else f}.')
        out = buf.decode('latin1')
        self._decoded[id(stream)] = out
        return out

    def pages(self) -> list[tuple[PdfDict, Optional[PdfDict]]]:
        """Pages in reading order, each with the resources it inherits."""
        out: list[tuple[PdfDict, Optional[PdfDict]]] = []
        seen: set[int] = set()

        def walk(node: Optional[PdfDict], inherited: Optional[PdfDict], depth: int) -> None:
            if node is None or id(node) in seen or depth > 64 or len(out) >= 10000:
                return
            seen.add(id(node))
            own = self.dict(node.get('Resources', UNDEF))
            resources = own if own is not None else inherited
            kids = self.resolve(node.get('Kids', UNDEF))
            if isinstance(kids, list):
                for k in kids:
                    walk(self.dict(k), resources, depth + 1)
            else:
                out.append((node, resources))

        for t in reversed(self.trailers):
            catalog = self.dict(t.get('Root', UNDEF))
            if catalog is not None:
                walk(self.dict(catalog.get('Pages', UNDEF)), None, 0)
                if out:
                    return out
        # No usable trailer (a damaged file): every page object in number order.
        for num in sorted(self.objects):
            value = self.objects[num][0]
            if isinstance(value, dict) and self.name_of(value.get('Type', UNDEF)) == 'Page':
                out.append((value, self.dict(value.get('Resources', UNDEF))))
        return out

    def font(self, ref: Value) -> Optional[_Font]:
        d = self.dict(ref)
        if d is None:
            return None
        font = self._fonts.get(id(d))
        if font is None:
            font = _Font(self, d)
            self._fonts[id(d)] = font
        return font


# ------------------------------------------------------------------------------------------------ fonts


def _decode_table(codec: str) -> list[str]:
    out = []
    for i in range(256):
        try:
            out.append(bytes([i]).decode(codec))
        except UnicodeDecodeError:
            out.append(chr(i))
    return out


_WIN_ANSI: Final = _decode_table('cp1252')
_MAC_ROMAN: Final = _decode_table('mac_roman')
_STANDARD: Final = ['\u2019' if i == 39 else '\u2018' if i == 96 else c for i, c in enumerate(_WIN_ANSI)]

# Glyph names that /Differences arrays use, besides single letters and uniXXXX.
_GLYPHS: Final = {
    'space': ' ', 'exclam': '!', 'quotedbl': '"', 'numbersign': '#', 'dollar': '$', 'percent': '%', 'ampersand': '&',
    'quotesingle': "'", 'parenleft': '(', 'parenright': ')', 'asterisk': '*', 'plus': '+', 'comma': ',',
    'hyphen': '-', 'period': '.', 'slash': '/', 'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'colon': ':', 'semicolon': ';', 'less': '<',
    'equal': '=', 'greater': '>', 'question': '?', 'at': '@', 'bracketleft': '[', 'backslash': '\\',
    'bracketright': ']', 'asciicircum': '^', 'underscore': '_', 'grave': '`', 'braceleft': '{', 'bar': '|',
    'braceright': '}', 'asciitilde': '~', 'bullet': '\u2022', 'endash': '\u2013', 'emdash': '\u2014',
    'quoteleft': '\u2018', 'quoteright': '\u2019', 'quotedblleft': '\u201c', 'quotedblright': '\u201d',
    'quotesinglbase': '\u201a', 'quotedblbase': '\u201e', 'ellipsis': '\u2026', 'Euro': '\u20ac', 'minus': '\u2212',
    'nbspace': '\u00a0', 'fi': 'fi', 'fl': 'fl', 'ff': 'ff', 'ffi': 'ffi', 'ffl': 'ffl', 'f_i': 'fi', 'f_l': 'fl',
    'f_f': 'ff', 'degree': '\u00b0', 'copyright': '\u00a9', 'registered': '\u00ae', 'trademark': '\u2122',
    'section': '\u00a7', 'paragraph': '\u00b6', 'periodcentered': '\u00b7', 'multiply': '\u00d7',
    'divide': '\u00f7', 'plusminus': '\u00b1',
}
_ACCENTED = re.compile(r'([A-Za-z])(acute|grave|circumflex|dieresis|tilde|ring|cedilla|caron)')
_COMBINING: Final = {
    'acute': '\u0301', 'grave': '\u0300', 'circumflex': '\u0302', 'dieresis': '\u0308', 'tilde': '\u0303',
    'ring': '\u030a', 'cedilla': '\u0327', 'caron': '\u030c',
}
_ONE_LETTER = re.compile(r'[A-Za-z]')
_UNI = re.compile(r'uni(?:[0-9A-Fa-f]{4})+')
_U = re.compile(r'u([0-9A-Fa-f]{4,6})')


def _from_units(units: list[int]) -> str:
    """A string from UTF-16 code units, as JavaScript builds it: pairs join, lone surrogates stay."""
    return b''.join((u & 0xFFFF).to_bytes(2, 'big') for u in units).decode('utf-16-be', 'surrogatepass')


def _glyph_to_unicode(name: str) -> Optional[str]:
    if name in _GLYPHS:
        return _GLYPHS[name]
    if _ONE_LETTER.fullmatch(name):
        return name
    if _UNI.fullmatch(name):
        return _from_units([int(name[i : i + 4], 16) for i in range(3, len(name), 4)])
    m = _U.fullmatch(name)
    if m:
        cp = int(m.group(1), 16)
        return chr(cp) if cp <= 0x10FFFF else None
    m = _ACCENTED.fullmatch(name)
    if m:
        return unicodedata.normalize('NFC', m.group(1) + _COMBINING[m.group(2)])
    dot = name.find('.')
    if dot > 0:
        return _glyph_to_unicode(name[:dot])  # "a.sc", "one.oldstyle"
    return None


def _units(data: str) -> list[int]:
    return [(ord(data[i]) << 8) | ord(data[i + 1]) for i in range(0, len(data) - 1, 2)]


def _utf16be(data: str) -> str:
    return _from_units(_units(data))


def _bytes_to_int(data: str) -> int:
    n = 0
    for ch in data:
        n = n * 256 + ord(ch)
    return n


def _int_to_bytes(n: int, length: int) -> str:
    out = ''
    for _ in range(length):
        out = chr(n % 256) + out
        n //= 256
    return out


def _parse_cmap(text: str) -> tuple[dict[str, str], list[tuple[str, str]]]:
    """A ToUnicode CMap: code bytes to text, plus the code space that says how many bytes each code takes."""
    cmap: dict[str, str] = {}
    ranges: list[tuple[str, str]] = []
    lx = _Lexer(text)
    operands: list[Value] = []
    while True:
        v = lx.value()
        if v is UNDEF:
            break
        if not isinstance(v, Op):
            operands.append(v)
            continue
        if v.v == 'endcodespacerange':
            for i in range(0, len(operands) - 1, 2):
                lo, hi = operands[i], operands[i + 1]
                if isinstance(lo, Str) and isinstance(hi, Str) and len(lo.v) == len(hi.v):
                    ranges.append((lo.v, hi.v))
        elif v.v == 'endbfchar':
            for i in range(0, len(operands) - 1, 2):
                src, dst = operands[i], operands[i + 1]
                if isinstance(src, Str) and isinstance(dst, Str):
                    cmap[src.v] = _utf16be(dst.v)
                elif isinstance(src, Str) and isinstance(dst, Name):
                    cmap[src.v] = _glyph_to_unicode(dst.v) or ''
        elif v.v == 'endbfrange':
            for i in range(0, len(operands) - 2, 3):
                lo, hi, dst = operands[i], operands[i + 1], operands[i + 2]
                if not (isinstance(lo, Str) and isinstance(hi, Str)):
                    continue
                start = _bytes_to_int(lo.v)
                end = min(_bytes_to_int(hi.v), start + 0xFFFF)
                for code in range(start, end + 1):
                    key = _int_to_bytes(code, len(lo.v))
                    if isinstance(dst, list):
                        d = dst[code - start] if code - start < len(dst) else UNDEF
                        if isinstance(d, Str):
                            cmap[key] = _utf16be(d.v)
                    elif isinstance(dst, Str) and len(dst.v) >= 2:
                        # The last code unit counts up through the range.
                        units = _units(dst.v)
                        cmap[key] = _from_units([*units[:-1], units[-1] + code - start])
        if v.v.startswith(('end', 'begin')):
            operands.clear()
    return cmap, ranges


def _js_or(value: float, fallback: float) -> float:
    """``value || fallback``: 0 and NaN fall back."""
    return fallback if value == 0 or math.isnan(value) else value


def _js_min(a: float, b: float) -> float:
    return math.nan if math.isnan(a) or math.isnan(b) else min(a, b)


def _js_max(a: float, b: float) -> float:
    return math.nan if math.isnan(a) or math.isnan(b) else max(a, b)


def _get(seq: Value, i: int) -> Value:
    """``seq[i]``: UNDEF when it is not an array or out of range."""
    return seq[i] if isinstance(seq, list) and 0 <= i < len(seq) else UNDEF


def _lookup(d: Optional[PdfDict], key: str) -> Value:
    """``d?.get(key)``"""
    return d.get(key, UNDEF) if d is not None else UNDEF


class _Font:
    def __init__(self, pdf: _Pdf, d: PdfDict) -> None:
        self._to_unicode: Optional[dict[str, str]] = None
        self._ranges: list[tuple[str, str]] = []
        self._composite = pdf.name_of(d.get('Subtype', UNDEF)) == 'Type0'
        self._widths: dict[float, float] = {}
        self._glyphs: dict[str, tuple[str, float]] = {}
        tu = pdf.resolve(d.get('ToUnicode', UNDEF))
        if isinstance(tu, Stream):
            with contextlib.suppress(PdfError):  # fall back to the encoding
                self._to_unicode = _parse_cmap(pdf.data(tu))[0]
        encoding = _WIN_ANSI
        enc = pdf.resolve(d.get('Encoding', UNDEF))
        # How many bytes a code takes comes from the font's own CMap, not from ToUnicode: generators often declare a
        # two-byte code space there for one-byte fonts. Simple fonts use one byte; Identity-H and most CMaps two.
        if self._composite and isinstance(enc, Stream):
            with contextlib.suppress(PdfError):  # two-byte codes
                self._ranges = _parse_cmap(pdf.data(enc))[1]

        def named(n: Optional[str]) -> list[str]:
            return _MAC_ROMAN if n == 'MacRomanEncoding' else _STANDARD if n == 'StandardEncoding' else _WIN_ANSI

        if isinstance(enc, Name):
            encoding = named(enc.v)
        elif isinstance(enc, dict):
            encoding = list(named(pdf.name_of(enc.get('BaseEncoding', UNDEF))))
            diffs = pdf.resolve(enc.get('Differences', UNDEF))
            if isinstance(diffs, list):
                code = 0.0
                for item in diffs:
                    if _is_num(item):
                        code = item  # type: ignore[assignment]
                    elif isinstance(item, Name):
                        if 0 <= code < 256 and code.is_integer():
                            encoding[int(code)] = _glyph_to_unicode(item.v) or ''
                        code += 1
        self._encoding = encoding

        if self._composite:
            descendants = pdf.resolve(d.get('DescendantFonts', UNDEF))
            cid = pdf.dict(_get(descendants, 0))
            self._default_width = pdf.num(cid.get('DW', UNDEF) if cid is not None else UNDEF, 1000.0)
            w = pdf.resolve(cid.get('W', UNDEF) if cid is not None else UNDEF)
            if isinstance(w, list):
                i = 0
                while i < len(w):
                    first = pdf.num(w[i])
                    nxt = pdf.resolve(_get(w, i + 1))
                    if isinstance(nxt, list):
                        for j, width in enumerate(nxt):
                            self._widths[first + j] = pdf.num(width)
                        i += 2
                    else:
                        last = pdf.num(nxt)
                        width = pdf.num(_get(w, i + 2))
                        c = first
                        while c <= last and c - first < 0x10000:
                            self._widths[c] = width
                            c += 1
                        i += 3
        else:
            first = pdf.num(d.get('FirstChar', UNDEF))
            widths = pdf.resolve(d.get('Widths', UNDEF))
            if isinstance(widths, list):
                for i, width in enumerate(widths):
                    self._widths[first + i] = pdf.num(width)
            descriptor = pdf.dict(d.get('FontDescriptor', UNDEF))
            base = pdf.name_of(d.get('BaseFont', UNDEF)) or ''
            # The standard 14 fonts come without widths; an average glyph is about half an em, Courier 0.6.
            missing = pdf.num(descriptor.get('MissingWidth', UNDEF) if descriptor is not None else UNDEF, 0.0)
            self._default_width = _js_or(missing, 600.0 if 'Courier' in base else 500.0)

    def codes(self, data: str) -> list[str]:
        """Splits a string into character codes."""
        if not self._composite:
            return list(data)
        out = []
        i = 0
        while i < len(data):
            size = 0
            for n in range(1, 5):
                code = data[i : i + n]
                if len(code) == n and any(len(lo) == n and lo <= code <= hi for lo, hi in self._ranges):
                    size = n
                    break
            if not size:
                size = 2
            out.append(data[i : i + size])
            i += size
        return out

    def text(self, code: str) -> str:
        tu = self._to_unicode
        if tu is not None:
            if code in tu:
                return tu[code]
            # Some ToUnicode maps write one-byte codes with two bytes.
            if len(code) == 1 and '\x00' + code in tu:
                return tu['\x00' + code]
        if len(code) == 1:
            return self._encoding[ord(code)]
        return ''

    def width(self, code: str) -> float:
        return self._widths.get(_bytes_to_int(code), self._default_width)

    def glyph(self, code: str) -> tuple[str, float]:
        """``(text(code), width(code))``, cached: a page shows the same few codes thousands of times."""
        g = self._glyphs.get(code)
        if g is None:
            g = self._glyphs[code] = (self.text(code), self.width(code))
        return g


# ------------------------------------------------------------------------------------------------ text

Matrix = tuple[float, float, float, float, float, float]
_IDENTITY: Final[Matrix] = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def _mul(m: Matrix, n: Matrix) -> Matrix:
    return (
        m[0] * n[0] + m[1] * n[2],
        m[0] * n[1] + m[1] * n[3],
        m[2] * n[0] + m[3] * n[2],
        m[2] * n[1] + m[3] * n[3],
        m[4] * n[0] + m[5] * n[2] + n[4],
        m[4] * n[1] + m[5] * n[3] + n[5],
    )


class _TextWriter:
    def __init__(self) -> None:
        self._parts: list[str] = []
        self._end = ''  # the last character written
        # Text was shown in a font the file does not have (it was cut off or damaged).
        self.missing_font = False
        self._last: Optional[tuple[float, float, float]] = None

    @property
    def out(self) -> str:
        return ''.join(self._parts)

    def _write(self, text: str) -> None:
        if text:
            self._parts.append(text)
            self._end = text[-1]

    def add(self, text: str, x0: float, y0: float, x1: float, y1: float, size: float) -> None:
        """Text drawn from (x0, y0) to (x1, y1) in device space, at an effective font size."""
        if not text:
            return
        last = self._last
        if last is not None and self._end:
            tolerance = _js_max(size, last[2]) * 0.5
            if abs(y0 - last[1]) > tolerance:
                if self._end != '\n':
                    self._write('\n')
            else:
                gap = x0 - last[0]
                # Word gaps are about a quarter em (more in justified text); kerning and rounding are far smaller. A gap
                # of most of an em separates table columns, even tight ones with only their cell padding between them.
                if (gap > size * 0.15 or gap < -size) and self._end not in ' \t\n' and text[0] != ' ':
                    self._write('\t' if gap > size * 0.8 else ' ')
        self._write(text)
        self._last = (x1, y1, size)

    def break_line(self) -> None:
        if self._end and self._end != '\n':
            self._write('\n')
        self._last = None

    def line(self, text: str) -> None:
        """A line of its own, such as a form field."""
        if not text:
            return
        self.break_line()
        self._write(f'{text}\n')


def _text_string(data: str) -> str:
    """A PDF text string (names, form values, comments): UTF-16BE or UTF-8 with a byte order mark, else Latin-1."""
    if data.startswith('\xfe\xff'):
        return _utf16be(data[2:])
    if data.startswith('\xef\xbb\xbf'):
        return data[3:].encode('latin1').decode('utf-8', 'replace')
    return data


_LINE_BREAKS = rx(r'\s*[\r\n]+\s*')


def _field_line(pdf: _Pdf, widget: PdfDict) -> Optional[str]:
    """A filled-in form field as "name: value", with the name taken from the field and its parents."""
    names: list[str] = []
    value: Value = UNDEF
    node: Optional[PdfDict] = widget
    depth = 0
    while node is not None and depth < 32:
        t = pdf.resolve(node.get('T', UNDEF))
        if isinstance(t, Str):
            names.insert(0, _text_string(t.v))
        if value is UNDEF and 'V' in node:
            value = pdf.resolve(node['V'])
        node = pdf.dict(node.get('Parent', UNDEF))
        depth += 1

    def one(v: Value) -> str:
        if isinstance(v, Str):
            return _text_string(v.v)
        return v.v if isinstance(v, Name) and v.v != 'Off' else ''

    joined = ', '.join(t for t in (one(pdf.resolve(v)) for v in value) if t) if isinstance(value, list) else one(value)
    text = _js.trim(_LINE_BREAKS.sub(', ', joined))
    return f'{".".join(names) or "field"}: {text}' if text else None


def _annotations(pdf: _Pdf, page: PdfDict, writer: _TextWriter) -> None:
    """Text in annotations: filled-in form fields as "name: value", stamps and free text, and comments."""
    annots = pdf.resolve(page.get('Annots', UNDEF))
    if not isinstance(annots, list):
        return
    for ref in annots[:5000]:
        a = pdf.dict(ref)
        subtype = pdf.name_of(a.get('Subtype', UNDEF)) if a is not None else None
        if a is None or subtype in ('Popup', 'Link'):
            continue
        if subtype == 'Widget':
            field = _field_line(pdf, a)
            if field:
                writer.line(field)
            continue
        ap = pdf.dict(a.get('AP', UNDEF))
        appearance = pdf.resolve(ap.get('N', UNDEF) if ap is not None else UNDEF)
        if isinstance(appearance, dict):
            appearance = pdf.resolve(appearance.get(pdf.name_of(a.get('AS', UNDEF)) or '', UNDEF))
        if isinstance(appearance, Stream):
            rect = pdf.resolve(a.get('Rect', UNDEF))
            bbox = pdf.resolve(appearance.dict.get('BBox', UNDEF))

            def at(arr: Value, i: int) -> float:
                return pdf.num(_get(arr, i)) if isinstance(arr, list) else 0.0

            ctm: Matrix = (
                1.0, 0.0, 0.0, 1.0,
                _js_min(at(rect, 0), at(rect, 2)) - at(bbox, 0),
                _js_min(at(rect, 1), at(rect, 3)) - at(bbox, 1),
            )
            writer.break_line()
            resources = pdf.dict(appearance.dict.get('Resources', UNDEF))
            with contextlib.suppress(PdfError):  # skip a damaged appearance
                _run_content(pdf, pdf.data(appearance), resources, ctm, writer, 1)
            writer.break_line()
            continue
        contents = pdf.resolve(a.get('Contents', UNDEF))
        if isinstance(contents, Str):
            writer.line(_js.trim(_LINE_BREAKS.sub(' ', _text_string(contents.v))))


_INLINE_IMAGE_END = rx(r'\sEI(?=[\s]|$)')


def _run_content(
    pdf: _Pdf, content: str, resources: Optional[PdfDict], ctm: Matrix, writer: _TextWriter, depth: int
) -> None:
    lx = _Lexer(content)
    operands: list[Value] = []
    stack: list[Matrix] = []
    tm = lm = _IDENTITY
    font: Optional[_Font] = None
    size = 0.0
    char_spacing = 0.0
    word_spacing = 0.0
    scale = 1.0
    leading = 0.0
    rise = 0.0
    fonts = pdf.dict(resources.get('Font', UNDEF)) if resources is not None else None
    xobjects = pdf.dict(resources.get('XObject', UNDEF)) if resources is not None else None

    def n(i: int) -> float:
        v = operands[i] if i < len(operands) else UNDEF
        return v if _is_num(v) else 0.0  # type: ignore[return-value]

    def show(data: str) -> None:
        nonlocal tm
        if font is None:
            if data:
                writer.missing_font = True
            return
        start = _mul((1.0, 0.0, 0.0, 1.0, 0.0, rise), _mul(tm, ctm))
        text = []
        a, b, c, d, e, f = tm
        for code in font.codes(data):
            glyph, width = font.glyph(code)
            text.append(glyph)
            advance = ((width / 1000) * size + char_spacing + (word_spacing if code == ' ' else 0)) * scale
            # _mul((1, 0, 0, 1, advance, 0), tm), written out: the same operations, without a call per glyph.
            a, b, c, d, e, f = (
                1.0 * a + 0.0 * c,
                1.0 * b + 0.0 * d,
                0.0 * a + 1.0 * c,
                0.0 * b + 1.0 * d,
                advance * a + 0.0 * c + e,
                advance * b + 0.0 * d + f,
            )
        tm = (a, b, c, d, e, f)
        end = _mul(tm, ctm)
        effective = _js_or(abs(size) * math.sqrt(start[2] * start[2] + start[3] * start[3]), 1.0)
        writer.add(''.join(text), start[4], start[5], end[4], end[5], effective)

    while True:
        v = lx.value()
        if v is UNDEF:
            break
        if not isinstance(v, Op):
            if len(operands) < 64:
                operands.append(v)
            continue
        op = v.v
        if op == 'q':
            if len(stack) < 64:
                stack.append(ctm)
        elif op == 'Q':
            if stack:
                ctm = stack.pop()
        elif op == 'cm':
            ctm = _mul((n(0), n(1), n(2), n(3), n(4), n(5)), ctm)
        elif op == 'BT':
            tm = lm = _IDENTITY
        elif op == 'Tf':
            first = operands[0] if operands else UNDEF
            font = pdf.font(_lookup(fonts, first.v)) if isinstance(first, Name) else None
            size = n(1)
        elif op == 'Tc':
            char_spacing = n(0)
        elif op == 'Tw':
            word_spacing = n(0)
        elif op == 'Tz':
            scale = n(0) / 100
        elif op == 'TL':
            leading = n(0)
        elif op == 'Ts':
            rise = n(0)
        elif op in ('Td', 'TD'):
            if op == 'TD':
                leading = -n(1)
            lm = _mul((1.0, 0.0, 0.0, 1.0, n(0), n(1)), lm)
            tm = lm
        elif op == 'Tm':
            lm = tm = (n(0), n(1), n(2), n(3), n(4), n(5))
        elif op in ('T*', "'", '"'):
            if op == '"':
                word_spacing = n(0)
                char_spacing = n(1)
            lm = _mul((1.0, 0.0, 0.0, 1.0, 0.0, -leading), lm)
            tm = lm
            shown = _get(operands, 2 if op == '"' else 0)
            if op != 'T*' and isinstance(shown, Str):
                show(shown.v)
        elif op == 'Tj':
            shown = _get(operands, 0)
            if isinstance(shown, Str):
                show(shown.v)
        elif op == 'TJ':
            items = _get(operands, 0)
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, Str):
                        show(item.v)
                    elif _is_num(item):
                        tm = _mul((1.0, 0.0, 0.0, 1.0, (-item / 1000) * size * scale, 0.0), tm)  # type: ignore[operator]
        elif op == 'Do':
            first = _get(operands, 0)
            xobject = pdf.resolve(_lookup(xobjects, first.v)) if isinstance(first, Name) else UNDEF
            if isinstance(xobject, Stream) and pdf.name_of(xobject.dict.get('Subtype', UNDEF)) == 'Form' and depth < 8:
                matrix = pdf.resolve(xobject.dict.get('Matrix', UNDEF))
                m: Matrix = (
                    tuple(pdf.num(x) for x in matrix)  # type: ignore[assignment]
                    if isinstance(matrix, list) and len(matrix) == 6
                    else _IDENTITY
                )
                try:
                    data: Optional[str] = pdf.data(xobject)
                except PdfError:
                    data = None
                if data is not None:
                    own = pdf.dict(xobject.dict.get('Resources', UNDEF))
                    _run_content(pdf, data, own if own is not None else resources, _mul(m, ctm), writer, depth + 1)
        elif op == 'ID':
            # Inline image data is binary: skip to "EI".
            found = _INLINE_IMAGE_END.search(content, lx.pos)
            lx.pos = found.end() if found else len(content)
        operands.clear()


_NON_SPACE = rx(r'\S')


def _extract_pages(buf: bytes) -> list[tuple[str, bool, bool]]:
    """Each page's text; whether part of it could not be read; and whether it draws nothing at all."""
    if b'%PDF-' not in buf[:1024]:
        raise PdfError('Not a PDF file.')
    pdf = _Pdf(buf)
    pages = pdf.pages()
    if not pages:
        raise PdfError('No pages found.')
    out = []
    for page, resources in pages:
        damaged = id(page) in pdf.truncated
        contents = pdf.resolve(page.get('Contents', UNDEF))
        if isinstance(contents, list):
            listed = [pdf.resolve(c) for c in contents]
        else:
            listed = [contents] if 'Contents' in page else []
        parts: list[str] = []
        for s in listed:
            if not isinstance(s, Stream) or s.truncated:
                damaged = True
            if not isinstance(s, Stream):
                continue
            try:
                parts.append(pdf.data(s))
            except PdfError:
                damaged = True
        writer = _TextWriter()
        try:
            _run_content(pdf, '\n'.join(parts), resources, _IDENTITY, writer, 0)
        except PdfError:
            damaged = True  # keep the text before the damage
        _annotations(pdf, page, writer)
        if writer.missing_font:
            damaged = True
        text = _js.trim('\n'.join(line.rstrip(' \t') for line in writer.out.split('\n')))
        out.append((text, damaged, not damaged and not any(_NON_SPACE.search(p) for p in parts)))
    return out


def read_pdf_pages(data: bytes) -> list[str]:
    """The text of each page; a page without text (a scan) is an empty string. Raises PdfError."""
    return [text for text, _, _ in _extract_pages(data)]


def read_pdf(data: bytes) -> tuple[list[tuple[str, str]], list[int], list[int], int]:
    """Pages with text as ("Halaman 1", text) pairs; the numbers of scanned pages and of damaged ones; the page count.

    Blank pages are in none of the lists.
    """
    pages: list[tuple[str, str]] = []
    scanned: list[int] = []
    damaged: list[int] = []
    extracted = _extract_pages(data)
    for i, (text, broken, blank) in enumerate(extracted):
        if _NON_SPACE.search(text):
            pages.append((f'Halaman {i + 1}', text))
        elif broken:
            damaged.append(i + 1)
        elif not blank:
            scanned.append(i + 1)
    return pages, scanned, damaged, len(extracted)


__all__: list[str] = ['PdfError', 'read_pdf', 'read_pdf_pages']
