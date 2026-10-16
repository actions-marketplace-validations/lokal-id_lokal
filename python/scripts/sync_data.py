"""Copies the region data from packages/core/data into the Python package, gzip-compressed.

packages/core/data is the single source of truth. Run this after regenerating it; CI runs it with --check.

    python scripts/sync_data.py          # write src/lokal/data/*.json.gz
    python scripts/sync_data.py --check  # fail if the copies are out of date
"""

from __future__ import annotations

import gzip
import hashlib
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'packages' / 'core' / 'data'
TARGET = ROOT / 'python' / 'src' / 'lokal' / 'data'
JSON_FILES = ['wilayah.json', 'desa.json', 'kodepos.json']
LICENSES = ['LICENSE-wilayah.txt', 'LICENSE-kodepos.txt']


def main() -> int:
    check = '--check' in sys.argv
    TARGET.mkdir(parents=True, exist_ok=True)
    stale: list[str] = []
    for name in JSON_FILES:
        raw = (SOURCE / name).read_bytes()
        out = TARGET / f'{name}.gz'
        current = gzip.decompress(out.read_bytes()) if out.exists() else None
        if current == raw:
            continue
        stale.append(out.name)
        if not check:
            # mtime=0 keeps the archive byte-identical across runs.
            out.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    for name in LICENSES:
        src, dst = SOURCE / name, TARGET / name
        if not dst.exists() or dst.read_bytes() != src.read_bytes():
            stale.append(name)
            if not check:
                shutil.copyfile(src, dst)
    if check and stale:
        print(f'Out of date: {", ".join(stale)}. Run python scripts/sync_data.py', file=sys.stderr)
        return 1
    for name in JSON_FILES:
        digest = hashlib.sha256((SOURCE / name).read_bytes()).hexdigest()[:12]
        print(f'{name}: {digest}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
