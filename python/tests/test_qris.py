"""QRIS: parse_qris and set_qris_amount must match packages/core/src/qris.ts (vectors from gen_vectors.mjs)."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from lokal import parse_qris, qris_crc, set_qris_amount

VECTORS = Path(__file__).parent / 'vectors'


def load(name: str) -> Any:
    return json.loads((VECTORS / name).read_text(encoding='utf-8'))


def test_crc_check_value() -> None:
    assert qris_crc('123456789') == '29B1'
    assert qris_crc('') == 'FFFF'


def test_parse_matches_typescript() -> None:
    for case in load('qris_parse.json'):
        assert parse_qris(case['input']).to_dict(camel=True) == case['out'], case['input']


def test_set_amount_matches_typescript() -> None:
    for case in load('qris_set_amount.json'):
        tip = case['tip'] or {}
        try:
            got: dict[str, Any] = {'ok': set_qris_amount(
                case['input'], case['amount'], tip_fixed=tip.get('fixed'), tip_percent=tip.get('percent')
            )}
        except ValueError as e:
            got = {'error': str(e)}
        want = {'error': case['out']['message']} if 'error' in case['out'] else case['out']
        assert got == want, (case['input'], case['amount'], tip)


def test_python_extras() -> None:
    static = load('qris_parse.json')[0]['input']
    # Decimal amounts are taken as written; two fees at once are refused.
    assert parse_qris(set_qris_amount(static, Decimal('15000.50'))).amount == '15000.50'
    with pytest.raises(ValueError, match='salah satu'):
        set_qris_amount(static, 1000, tip_fixed=500, tip_percent=1)
    with pytest.raises(TypeError):
        set_qris_amount(static, True)
    info = parse_qris(static)
    assert (info.type, info.merchant_name, info.nmid, info.criteria_label) == ('static', 'KOPI CONTOH', 'ID1026000000001', 'Usaha Mikro')
