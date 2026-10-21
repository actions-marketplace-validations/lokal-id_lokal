"""Kembaran must give exactly the TypeScript stand-ins for the same secret (vectors from gen_vectors.mjs)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from lokal import parse_nik
from lokal.kembaran import Kembaran

VECTORS = Path(__file__).parent / 'vectors'


def load(name: str) -> Any:
    return json.loads((VECTORS / name).read_text(encoding='utf-8'))


@pytest.mark.parametrize('variant', load('kembaran.json'), ids=lambda v: v['options']['secret'])
def test_matches_typescript(variant: dict[str, Any]) -> None:
    options = variant['options']
    k = Kembaran(
        secret=options['secret'],
        keep=options.get('keep'),
        keep_birth_date=options.get('keepBirthDate', False),
        min_confidence=options.get('minConfidence', 'medium'),
    )
    texts = [d['text'] for d in load('samaran_detect.json')][: len(variant['results'])]
    for text, want in zip(texts, variant['results'], strict=True):
        assert k.text(text).to_dict() == want, text


def test_default_mysqldump_and_pg_dump() -> None:
    k = Kembaran(secret='uji')
    my = k.text(
        'CREATE TABLE `pelanggan` (\n  `id` int,\n  `nama` varchar(100),\n  `nik` char(16)\n);\n'
        "INSERT INTO `pelanggan` VALUES (1,'Budi Santoso','3201011508950001'),(2,'Siti Aminah','3201014408960002');\n"
    )
    pg = k.text('COPY public.pelanggan (id, nama, nik) FROM stdin;\n1\tBudi Santoso\t3201011508950001\n\\.\n')
    for out in (my, pg):
        assert 'Budi' not in out.text and 'Siti' not in out.text and '3201011508950001' not in out.text
        assert out.replaced['NAME'] >= 1 and out.replaced['NIK'] >= 1
    # The same customer gets the same stand-in in both dumps.
    name = my.text.split("VALUES (1,'")[1].split("'")[0]
    assert pg.text.split('\n')[1].split('\t')[1] == name
    assert pg.text.endswith('\n\\.\n')


def test_stand_ins_are_valid_and_consistent() -> None:
    k = Kembaran(secret='uji')
    out = k.text('nama,nik,hp\nBudi Santoso,3201011508950001,0812-3456-7890\nBudi Santoso,3201011508950001,081234567890')
    rows = [line.split(',') for line in out.text.split('\n')[1:]]
    assert rows[0][:2] == rows[1][:2]
    assert 'Budi' not in out.text and '3201011508950001' not in out.text
    info = parse_nik(rows[0][1])
    assert info.valid and info.gender == 'L' and info.birth_date is not None and info.birth_date.startswith('1995')
    assert rows[0][2].startswith('0812-') and rows[1][2].startswith('0812')
    assert out.replaced == {'NAME': 2, 'NIK': 2, 'PHONE': 2}
    with pytest.raises(ValueError, match='Unknown PII type'):
        Kembaran(keep=['NAMA'])


def test_command_line(tmp_path: Path) -> None:
    src = tmp_path / 'prod.csv'
    src.write_text('nama,nik\nBudi Santoso,3201011508950001\n', encoding='utf-8')
    out = tmp_path / 'staging.csv'
    run = subprocess.run(
        [sys.executable, '-m', 'lokal.kembaran', str(src), '-o', str(out), '--secret', 'uji'],
        capture_output=True, text=True, check=True,
    )
    assert 'NAME=1' in run.stderr and 'NIK=1' in run.stderr
    assert '3201011508950001' not in out.read_text(encoding='utf-8')
    again = tmp_path / 'again.csv'
    subprocess.run([sys.executable, '-m', 'lokal.kembaran', str(src), '-o', str(again), '--secret', 'uji'], check=True)
    assert again.read_text(encoding='utf-8') == out.read_text(encoding='utf-8')
    refused = subprocess.run([sys.executable, '-m', 'lokal.kembaran', str(src), '-o', str(out)], capture_output=True, text=True)
    assert refused.returncode != 0 and 'exists' in refused.stderr
