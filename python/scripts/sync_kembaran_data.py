"""Writes src/lokal/_kembaran_data.py from packages/core/src/kembaran-data.ts, so both ports pick from the same lists.

    uv run python scripts/sync_kembaran_data.py           # rewrite
    uv run python scripts/sync_kembaran_data.py --check   # CI: fail if out of date
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'packages' / 'core' / 'src' / 'kembaran-data.ts'
TARGET = ROOT / 'python' / 'src' / 'lokal' / '_kembaran_data.py'
LISTS = ['MALE_FIRST', 'FEMALE_FIRST', 'MALE_LAST', 'FEMALE_LAST', 'STREETS', 'HEALTH', 'RELIGIONS', 'MARITAL']


def wrap(items: list[str], opener: str, closer: str) -> list[str]:
    out = [opener]
    line = '   '
    for item in items:
        piece = f' {item!r},'
        if len(line) + len(piece) > 116:
            out.append(line)
            line = '   '
        line += piece
    return [*out, line, closer, '']


def render() -> str:
    src = SOURCE.read_text(encoding='utf-8')
    out = [
        '"""Word lists for Kembaran\'s stand-in values.',
        '',
        'Generated from packages/core/src/kembaran-data.ts; do not edit by hand.',
        'Regenerate with: python scripts/sync_kembaran_data.py',
        '"""',
        '',
        'from __future__ import annotations',
        '',
        'from typing import Final',
        '',
    ]
    for name in LISTS:
        body = re.search(rf'export const {name}: readonly string\[\] = \[(.*?)\];', src, re.S)
        assert body, name
        out += wrap(re.findall(r"'([^']*)'", body.group(1)), f'{name}: Final = (', ')')
    keep = re.search(r'export const NAME_KEEP: ReadonlySet<string> = new Set\(\[(.*?)\]\);', src, re.S)
    assert keep
    out += wrap(re.findall(r"'([^']*)'", keep.group(1)), 'NAME_KEEP: Final = frozenset((', '))')
    return '\n'.join(out)


def main() -> int:
    text = render()
    current = TARGET.read_text(encoding='utf-8') if TARGET.exists() else ''
    if current == text:
        return 0
    if '--check' in sys.argv:
        print(f'{TARGET.relative_to(ROOT)} is out of date: run python scripts/sync_kembaran_data.py', file=sys.stderr)
        return 1
    TARGET.write_text(text, encoding='utf-8', newline='\n')
    print(f'wrote {TARGET.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
