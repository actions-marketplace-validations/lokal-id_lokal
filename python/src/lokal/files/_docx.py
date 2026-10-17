"""Minimal .docx reader: the text of a Word document, plus each table as CSV (port of packages/mcp/src/docx.ts).

A .docx file is a ZIP of XML parts. The body, headers, footers, footnotes, endnotes, and comments are read in order
with paragraphs as lines. Tables become their own parts, so a "Nama" column is masked like an Excel column instead of
being one more line of prose. Formatting is ignored.
"""

from __future__ import annotations

import re

from .. import _js
from .._js import rx
from ._xlsx import csv_cell, decode_xml, unzip

_PARTS = rx(r'^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$')
_ORDER = ('document', 'header', 'footer', 'footnotes', 'endnotes', 'comments')
_TOKEN = rx(r'<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<\/w:p>', 'g')
_BLANK_LINES = rx(r'\n{3,}', 'g')
_ROW = rx(r'<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>', 'g')
_CELL = rx(r'<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>', 'g')
_CELL_BREAKS = rx(r'\s*\n\s*', 'g')
_TABLE = rx(r'<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>', 'g')
_NUMBERS = re.compile(r'(\d+)', re.ASCII)


def _paragraphs(xml: str) -> str:
    out: list[str] = []
    for m in _TOKEN.finditer(xml):
        if m.group(1) is not None:
            out.append(decode_xml(m.group(1)))
        elif m.group(2) == 'tab':
            out.append('\t')
        else:
            out.append('\n')
    return _js.trim(_BLANK_LINES.sub('\n\n', ''.join(out)))


def _table_csv(xml: str) -> str:
    rows = [
        [_CELL_BREAKS.sub(' ', _paragraphs(c.group(1))) for c in _CELL.finditer(r.group(1))] for r in _ROW.finditer(xml)
    ]
    width = max((len(r) for r in rows), default=0)
    return '\n'.join(','.join(csv_cell(c) for c in [*r, *[''] * (width - len(r))]) for r in rows)


def _natural(name: str) -> list[object]:
    """``localeCompare(…, { numeric: true })`` for part names: header2.xml before header10.xml."""
    return [int(p) if p.isdigit() else p.lower() for p in _NUMBERS.split(name)]


def read_docx(buf: bytes) -> list[tuple[str, str]]:
    """"Dokumen" holds the text, with "[Tabel 1]" where each table was; "Tabel 1", "Tabel 2" … hold the tables."""
    files = unzip(buf)
    if 'word/document.xml' not in files:
        raise ValueError('Not a Word document (word/document.xml is missing).')
    names = [n for n in files if _PARTS.search(n)]

    def rank(n: str) -> int:
        return next((i for i, o in enumerate(_ORDER) if n.startswith(f'word/{o}')), -1)

    names.sort(key=lambda n: (rank(n), _natural(n)))

    tables: list[tuple[str, str]] = []

    def table(m: re.Match[str]) -> str:
        name = f'Tabel {len(tables) + 1}'
        tables.append((name, _table_csv(m.group(0))))
        return f'<w:p><w:r><w:t>[{name}]</w:t></w:r></w:p>'

    texts = [_paragraphs(_TABLE.sub(table, files[n].decode('utf-8', 'replace'))) for n in names]
    return [('Dokumen', '\n\n'.join(t for t in texts if t)), *tables]
