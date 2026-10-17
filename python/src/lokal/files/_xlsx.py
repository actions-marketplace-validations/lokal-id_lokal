"""Minimal .xlsx reader: each sheet as CSV text for scanning and masking (port of packages/mcp/src/xlsx.ts).

An .xlsx file is a ZIP of XML parts; this reads the ZIP central directory, then the shared strings and the cell values.
Formatting, formulas, and dates as serials are ignored. Patterns use JavaScript semantics (``rx``) so the output equals
the TypeScript reader's.
"""

from __future__ import annotations

import re
import struct
import zlib

from .. import _js
from .._js import rx

# A file inside the ZIP may not decompress to more than this: a small .xlsx can hide gigabytes.
_MAX_ENTRY_BYTES = 256 * 1024 * 1024


class ZipError(ValueError):
    """Not a ZIP file, or a damaged one."""


def unzip(buf: bytes) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    eocd = -1
    for i in range(len(buf) - 22, max(0, len(buf) - 65557) - 1, -1):
        if buf[i : i + 4] == b'PK\x05\x06':
            eocd = i
            break
    if eocd < 0:
        raise ZipError('Not a ZIP/xlsx file.')

    # Offsets come from the file; one that points outside it means the ZIP is damaged.
    def u16(at: int) -> int:
        if at < 0 or at + 2 > len(buf):
            raise ZipError('Corrupt ZIP central directory.')
        return int(struct.unpack_from('<H', buf, at)[0])

    def u32(at: int) -> int:
        if at < 0 or at + 4 > len(buf):
            raise ZipError('Corrupt ZIP central directory.')
        return int(struct.unpack_from('<I', buf, at)[0])

    entries = u16(eocd + 10)
    p = u32(eocd + 16)
    for _ in range(entries):
        if u32(p) != 0x02014B50:
            raise ZipError('Corrupt ZIP central directory.')
        method = u16(p + 10)
        compressed = u32(p + 20)
        name_len = u16(p + 28)
        extra_len = u16(p + 30)
        comment_len = u16(p + 32)
        local = u32(p + 42)
        name = buf[p + 46 : p + 46 + name_len].decode('utf-8', 'replace')
        p += 46 + name_len + extra_len + comment_len

        data_start = local + 30 + u16(local + 26) + u16(local + 28)
        data = buf[data_start : data_start + compressed]
        if method == 0:
            files[name] = data
        elif method == 8:
            d = zlib.decompressobj(-15)
            try:
                out = d.decompress(data, _MAX_ENTRY_BYTES)
            except zlib.error:
                raise ZipError('Corrupt ZIP data.') from None
            if d.unconsumed_tail:
                raise ZipError('A file in the ZIP is too large to decompress.')
            if not d.eof:
                raise ZipError('Corrupt ZIP data.')  # cut off
            files[name] = out
    return files


_ENTITY = rx(r'&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));', 'gi')
_NAMED = {'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'"}


def decode_xml(s: str) -> str:
    def entity(m: re.Match[str]) -> str:
        dec, hexa = m.group(2), m.group(3)
        if dec or hexa:
            cp = int(dec) if dec else int(hexa, 16)
            return chr(cp) if cp <= 0x10FFFF else m.group(0)
        return _NAMED.get(m.group(1).lower(), m.group(0))

    return _ENTITY.sub(entity, s)


_TEXT = rx(r'<t(?:\s[^>]*)?>([\s\S]*?)<\/t>', 'g')
_TRAILING_DIGITS = rx(r'\d+$')


def _text_of(xml: str) -> str:
    return ''.join(decode_xml(m.group(1)) for m in _TEXT.finditer(xml))


def _column_index(ref: str) -> int:
    n = 0
    for ch in _TRAILING_DIGITS.sub('', ref):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


_NEEDS_QUOTES = rx(r'[",\n\r]')


def csv_cell(value: str) -> str:
    return '"' + value.replace('"', '""') + '"' if _NEEDS_QUOTES.search(value) else value


_SI = rx(r'<si>([\s\S]*?)<\/si>', 'g')
_RELATIONSHIP = rx(r'<Relationship\b[^>]*>', 'g')
_ID = rx(r'\bId="([^"]+)"')
_TARGET = rx(r'\bTarget="([^"]+)"')
_XL_PREFIX = rx(r'^\/?(xl\/)?')
_SHEET = rx(r'<sheet\b[^>]*>', 'g')
_NAME = rx(r'\bname="([^"]*)"')
_RID = rx(r'\br:id="([^"]+)"')
_ROW = rx(r'<row\b[^>]*>([\s\S]*?)<\/row>', 'g')
_CELL = rx(r'<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)', 'g')
_REF = rx(r'\br="([A-Z]+\d+)"')
_TYPE = rx(r'\bt="([^"]+)"')
_V = rx(r'<v>([\s\S]*?)<\/v>')


def read_xlsx(buf: bytes) -> list[tuple[str, str]]:
    """Each sheet as (name, CSV text)."""
    files = unzip(buf)

    def read(name: str) -> str:
        data = files.get(name)
        return data.decode('utf-8', 'replace') if data is not None else ''

    shared = [_text_of(m.group(1)) for m in _SI.finditer(read('xl/sharedStrings.xml'))]

    rels: dict[str, str] = {}
    for m in _RELATIONSHIP.finditer(read('xl/_rels/workbook.xml.rels')):
        rid = _ID.search(m.group(0))
        target = _TARGET.search(m.group(0))
        if rid and target:
            rels[rid.group(1)] = _XL_PREFIX.sub('xl/', target.group(1), count=1)

    sheets: list[tuple[str, str]] = []
    for m in _SHEET.finditer(read('xl/workbook.xml')):
        name_match = _NAME.search(m.group(0))
        name = decode_xml(name_match.group(1) if name_match else 'Sheet')
        rid_match = _RID.search(m.group(0))
        xml = read(rels.get(rid_match.group(1), '')) if rid_match else ''
        if not xml:
            continue

        rows: list[list[str]] = []
        for row in _ROW.finditer(xml):
            cells: list[str] = []
            for c in _CELL.finditer(row.group(1)):
                attrs = c.group(1)
                body = c.group(2) or ''
                ref = _REF.search(attrs)
                kind = _TYPE.search(attrs)
                v = _V.search(body)
                value = ''
                if kind and kind.group(1) == 's' and v is not None:
                    # shared[Number(v)]: an index only if it is a whole number in range.
                    index = _js.number(v.group(1))
                    value = shared[int(index)] if index.is_integer() and 0 <= index < len(shared) else ''
                elif kind and kind.group(1) == 'inlineStr':
                    value = _text_of(body)
                elif v is not None:
                    value = decode_xml(v.group(1))
                idx = _column_index(ref.group(1)) if ref else len(cells)
                while len(cells) < idx:
                    cells.append('')
                if idx < len(cells):
                    cells[idx] = value
                else:
                    cells.append(value)
            rows.append(cells)
        # Excel omits trailing empty cells; pad so every row has as many fields as the widest one.
        width = max((len(r) for r in rows), default=0)
        csv = '\n'.join(','.join(csv_cell(c) for c in [*r, *[''] * (width - len(r))]) for r in rows)
        sheets.append((name, csv))
    return sheets
