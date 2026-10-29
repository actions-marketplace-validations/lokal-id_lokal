"""Leak tests for the Python package: the canary person in packages/core/test/canary.json, the same one the TypeScript
leak tests use, in every format, through every way the package hands text on. None of their values may come out."""

from __future__ import annotations

import io
import json
import logging
import re
from pathlib import Path

import pytest

from lokal import Samaran, mask_pii
from lokal.files import scan_path
from lokal.kembaran import KEEP_BY_DEFAULT, Kembaran
from lokal.samaran.logging import SamaranFilter

CANARY = Path(__file__).resolve().parents[2] / 'packages' / 'core' / 'test' / 'canary.json'
pytestmark = pytest.mark.skipif(not CANARY.exists(), reason='runs in the repository, next to the TypeScript tests')

FIELDS: list[list[str]] = json.loads(CANARY.read_text('utf-8'))['fields'] if CANARY.exists() else []

# The same four formats as packages/core/test/canary.ts.
FORMATS = {
    'text': '\n'.join(f'{label}: {value}' for _, label, _, value in FIELDS),
    'json': json.dumps({'customer': {key: value for key, _, _, value in FIELDS}}, separators=(',', ':')),
    'log': '2026-10-29 10:00:00 INFO checkout ' + ' '.join(f'{key}="{value}"' for key, _, _, value in FIELDS),
    'csv': ','.join(key for key, *_ in FIELDS) + '\n' + ','.join(f'"{value}"' for *_, value in FIELDS) + '\n',
}


def needles() -> list[str]:
    out: list[str] = []
    for _, _, pii_type, value in FIELDS:
        digits = re.sub(r'\D', '', value)
        out.append(value)
        if len(digits) >= 8 and digits != value:
            out.append(digits)
        if pii_type == 'NAME':
            out.extend(value.split(' '))
        if pii_type == 'ADDRESS':
            out.append('Kanari Raya')
    return list(dict.fromkeys(out))


def assert_no_canary(output: str, where: str) -> None:
    leaked = [n for n in needles() if n in output]
    assert leaked == [], f'{where} leaked {", ".join(leaked)}'


@pytest.mark.parametrize('fmt', list(FORMATS))
def test_samaran_and_mask_pii_leave_no_value(fmt: str) -> None:
    doc = FORMATS[fmt]
    samaran = Samaran()
    masked = samaran.mask(doc).text
    assert_no_canary(masked, f'Samaran.mask ({fmt})')
    assert samaran.unmask(masked) == doc
    assert_no_canary(mask_pii(doc).text, f'mask_pii ({fmt})')
    assert_no_canary(Samaran(mode='partial').mask(doc).text, f'partial mode ({fmt})')
    # Inside another JSON string, as a tool call's arguments carry it.
    assert_no_canary(Samaran().mask(json.dumps({'data': doc})).text, f'JSON in JSON ({fmt})')


@pytest.mark.parametrize('fmt', list(FORMATS))
def test_kembaran_replaces_every_value_it_does_not_keep(fmt: str) -> None:
    kept = {value for _, _, pii_type, value in FIELDS if pii_type in KEEP_BY_DEFAULT}
    out = Kembaran(secret='canary').text(FORMATS[fmt]).text
    leaked = [value for *_, value in FIELDS if value not in kept and value in out]
    assert leaked == [], f'Kembaran ({fmt}) kept {", ".join(leaked)}'


def test_logging_filter_leaves_no_value() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(SamaranFilter())
    log = logging.getLogger('lokal-leaks')
    log.addHandler(handler)
    log.propagate = False
    try:
        for fmt, doc in FORMATS.items():
            log.warning('checkout %s: %s', fmt, doc)
            log.warning(doc)
    finally:
        log.removeHandler(handler)
    assert_no_canary(stream.getvalue(), 'SamaranFilter')


def test_scan_path_report_leaves_no_value(tmp_path: Path) -> None:
    for name, fmt in [('pelanggan.txt', 'text'), ('pelanggan.json', 'json'), ('checkout.log', 'log'), ('pelanggan.csv', 'csv')]:
        (tmp_path / name).write_text(FORMATS[fmt], encoding='utf-8')
    report = scan_path(tmp_path)
    assert report.files_with_pii == 4
    assert_no_canary(json.dumps(report.to_dict(), ensure_ascii=False), 'scan_path report')
