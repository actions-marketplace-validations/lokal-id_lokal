"""Replays the vectors generated from the TypeScript package (scripts/gen_vectors.mjs) and requires identical results.

Regenerate after changing packages/core: ``npm run build && node python/scripts/gen_vectors.mjs``.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest

import lokal
from lokal import wilayah

VECTORS = Path(__file__).parent / 'vectors'
REF = dt.date(2026, 10, 15)


def load(name: str) -> Any:
    return json.loads((VECTORS / name).read_text(encoding='utf-8'))


def outcome(fn: Any) -> dict[str, Any]:
    try:
        value = fn()
    except ValueError as e:
        return {'error': str(e)}
    if isinstance(value, lokal.Holiday.__mro__[1]):  # Result
        value = value.to_dict(camel=True)
    return {'ok': value}


def ts_outcome(v: dict[str, Any]) -> dict[str, Any]:
    return {'error': v['message']} if 'error' in v else {'ok': v['ok']}


def test_nik() -> None:
    for case in load('nik.json'):
        got = lokal.parse_nik(case['input'], reference_date=REF).to_dict(camel=True)
        assert got == case['plain'], case['input']
        got = lokal.parse_nik(case['input'], reference_date=REF, lookup_wilayah=wilayah.wilayah_name).to_dict(camel=True)
        assert got == case['withWilayah'], case['input']


def test_npwp() -> None:
    for case in load('npwp.json'):
        assert lokal.parse_npwp(case['input']).to_dict(camel=True) == case['out'], case['input']


def test_phone() -> None:
    for case in load('phone.json'):
        assert lokal.parse_phone(case['input']).to_dict(camel=True) == case['out'], case['input']
        assert lokal.normalize_phone(case['input']) == case['e164'], case['input']


def test_format_rupiah() -> None:
    for case in load('rupiah_format.json'):
        a = case['amount']
        assert lokal.format_rupiah(a) == case['plain'], a
        assert lokal.format_rupiah(a, decimals=True) == case['decimals'], a
        assert lokal.format_rupiah(a, symbol=False) == case['noSymbol'], a
        assert lokal.format_rupiah_short(a) == case['short'], a


def test_parse_rupiah() -> None:
    for case in load('rupiah_parse.json'):
        got = lokal.parse_rupiah(case['text'])
        assert (got.to_dict() if got else None) == case['out'], case['text']


def _terbilang_outcome(fn: Any) -> dict[str, Any]:
    try:
        return {'ok': fn()}
    except ValueError:
        return {'error': True}


def _ts_terbilang(v: dict[str, Any]) -> dict[str, Any]:
    return {'error': True} if 'error' in v else {'ok': v['ok']}


def test_terbilang() -> None:
    for case in load('terbilang.json'):
        n = int(case['big']) if 'big' in case else case['n']
        # A Python int is arbitrary-precision, so it behaves like a TypeScript bigint.
        expected = case.get('asBigint', case) if isinstance(n, int) else case
        assert _terbilang_outcome(lambda: lokal.terbilang(n)) == _ts_terbilang(expected['lower']), n
        if 'title' in expected:
            got = _terbilang_outcome(lambda: lokal.terbilang(n, currency=True, case='title'))
            assert got == _ts_terbilang(expected['title']), n
            got = _terbilang_outcome(lambda: lokal.terbilang(n, case='sentence'))
            assert got == _ts_terbilang(expected['sentence']), n
        if isinstance(n, int) and 'n' in case:
            # The same value as a float follows the number rules.
            assert _terbilang_outcome(lambda: lokal.terbilang(float(n))) == _ts_terbilang(case['lower']), n


def _opts(o: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if 'cutiBersama' in o:
        out['cuti_bersama'] = o['cutiBersama']
    if 'weekend' in o:
        out['weekend'] = o['weekend']
    return out


def test_holidays() -> None:
    v = load('holidays.json')
    for year in v['years']:
        assert lokal.get_holidays(year['year']).to_dict(camel=True) == year
    for iso, working, no_cuti, sunday_only, count in v['days']:
        assert lokal.is_working_day(iso) == working, iso
        assert lokal.is_working_day(iso, cuti_bersama=False) == no_cuti, iso
        assert lokal.is_working_day(iso, weekend=[0]) == sunday_only, iso
        assert len(lokal.holidays_on(iso)) == count, iso
        # A date object gives the same answers as its ISO string.
        assert lokal.is_working_day(dt.date.fromisoformat(iso)) == working, iso
    for case in v['add']:
        got = outcome(lambda: lokal.add_working_days(case['from'], case['n'], **_opts(case['opts'])))
        assert got == ts_outcome(case['out']), case
    for case in v['count']:
        assert lokal.count_working_days(case['from'], case['to']) == case['out'], case
        assert lokal.count_working_days(case['from'], case['to'], cuti_bersama=False) == case['noCuti'], case
    for case in v['errors']:
        assert outcome(lambda: lokal.is_working_day(case['iso'])) == ts_outcome(case['out']), case


def _walk(parent: str | None = None) -> list[wilayah.Wilayah]:
    out: list[wilayah.Wilayah] = []
    for w in wilayah.list_wilayah(parent):
        out.append(w)
        if w.level < 4:
            out.extend(_walk(w.code))
    return out


def test_wilayah_every_region_matches() -> None:
    v = load('wilayah.json')
    regions = _walk()
    assert len(regions) == v['count']
    lines = '\n'.join(
        '|'.join([w.code, w.name, str(w.level), w.type, w.path, w.postal_code or '']) for w in regions
    )
    assert hashlib.sha256(lines.encode('utf-8')).hexdigest() == v['listingSha256']
    for sample in v['samples']:
        got = wilayah.get_wilayah(sample['code'])
        assert got is not None and got.to_dict(camel=True) == sample


def test_wilayah_lookups() -> None:
    v = load('wilayah.json')
    for case in v['get']:
        assert wilayah.normalize_wilayah_code(case['code']) == case['norm'], case['code']
        assert wilayah.wilayah_name(case['code']) == case['name'], case['code']
        got = wilayah.get_wilayah(case['code'])
        assert (got.to_dict(camel=True) if got else None) == case['out'], case['code']
    for case in v['postal']:
        assert wilayah.postal_codes_in(case['code']) == case['out'], case['code']
    for case in v['byPostal']:
        assert [w.to_dict(camel=True) for w in wilayah.find_by_postal_code(case['pos'])] == case['out'], case['pos']
    for case in v['search']:
        got = wilayah.search_wilayah(case['q'], **case['o'])
        assert [w.to_dict(camel=True) for w in got] == case['out'], case


DETECT = load('samaran_detect.json')
PLACEHOLDER_LIKE = re.compile(r'\[[A-Z_]+_\d+\]')


@pytest.mark.parametrize('index', range(0, len(DETECT), 100))
def test_detect_pii(index: int) -> None:
    for case in DETECT[index : index + 100]:
        got = [[m.type, m.start, m.end, m.value, m.confidence] for m in lokal.detect_pii(case['text'])]
        assert got == case['matches'], case['text'][:200]
        for m in lokal.detect_pii(case['text']):
            assert case['text'][m.start : m.end] == m.value


def test_mask_and_vault() -> None:
    for case in load('samaran_mask.json'):
        s = lokal.Samaran()
        assert s.mask(case['text']).text == case['placeholder'], case['text'][:200]
        assert [list(e) for e in s.export_vault()] == case['vault']
        # Every placeholder comes back as the value stored for it ("Rina" and "rina" share one, in the form seen first).
        for placeholder, value in s.export_vault():
            assert s.unmask(placeholder) == value
        if not PLACEHOLDER_LIKE.search(case['text']):
            assert not any(p in s.unmask(case['placeholder']) for p, _ in s.export_vault())
        assert lokal.mask_pii(case['text'], mode='partial').text == case['partial'], case['text'][:200]
        assert lokal.mask_pii(case['text'], exclude=['FINANCIAL', 'NAME']).text == case['noFinanceNoName']
        assert [m.value for m in lokal.detect_pii(case['text'], min_confidence='high')] == case['high']


def test_field_type_and_partial_mask() -> None:
    for case in load('samaran_fields.json'):
        assert lokal.field_type(case['key']) == case['out'], case['key']
    for case in load('samaran_partial.json'):
        assert lokal.partial_mask(case['type'], case['value']) == case['out'], case


_CAMEL_LEVEL = {'kabupaten_kota': 'kabupatenKota', 'kelurahan_desa': 'kelurahanDesa'}


def test_parse_alamat_matches() -> None:
    for case in load('alamat.json'):
        got = wilayah.parse_alamat(case['input']).to_dict(camel=True)
        got['inferred'] = [_CAMEL_LEVEL.get(level, level) for level in got['inferred']]
        assert got == case['out'], case['input']
