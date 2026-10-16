"""Things only the Python package has: dataclass results, logging, typing, and package data."""

import dataclasses
import io
import json
import logging

import pytest

import lokal
from lokal import parse_nik, parse_phone
from lokal.samaran.logging import SamaranFilter
from lokal.wilayah import get_wilayah


def test_results_are_dataclasses_with_to_dict() -> None:
    info = parse_phone('0812-3456-7890')
    assert dataclasses.is_dataclass(info)
    assert info.to_dict()['e164'] == '+6281234567890'
    nik = parse_nik('3201011508950001').to_dict()
    assert 'birth_date' in nik and 'regency' not in nik  # None fields are left out
    assert parse_nik('3201011508950001').to_dict(camel=True)['birthDate'] == '1995-08-15'
    w = get_wilayah('32.76.01.1006')
    assert w is not None and w.to_dict(camel=True)['postalCode'] == '16431'
    json.dumps(lokal.parse_npwp('3201011508950001').to_dict())  # nested results serialize


def test_frozen_results_cannot_be_changed() -> None:
    match = lokal.detect_pii('NIK 3201011508950001')[0]
    with pytest.raises(dataclasses.FrozenInstanceError):
        match.value = 'x'  # type: ignore[misc]


def test_logging_filter_masks_messages_args_and_tracebacks() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(SamaranFilter())
    handler.setFormatter(logging.Formatter('%(levelname)s %(message)s'))
    log = logging.getLogger('lokal-test')
    log.addHandler(handler)
    log.propagate = False
    try:
        log.warning('refund ke rek BCA %s, HP %s', '1234567890', '0812-3456-7890')
        try:
            raise ValueError('NIK 3201011508950001 tidak cocok')
        except ValueError:
            log.exception('gagal')
    finally:
        log.removeHandler(handler)
    out = stream.getvalue()
    assert 'WARNING refund ke rek BCA ******7890, HP 0812****7890' in out
    assert '3201011508950001' not in out and '3201********0001' in out
    assert 'ValueError' in out


def test_logging_filter_placeholder_mode() -> None:
    record = logging.LogRecord('x', logging.INFO, __file__, 1, 'NIK %s', ('3201011508950001',), None)
    assert SamaranFilter(mode='placeholder').filter(record)
    assert record.getMessage() == 'NIK [NIK_1]'


def test_invalid_options_fail_early() -> None:
    with pytest.raises(ValueError):
        lokal.Samaran(mode='redact')  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        lokal.terbilang('100')  # type: ignore[arg-type]


def test_version_and_package_data() -> None:
    assert lokal.__version__ == '0.2.3'
    from importlib import resources

    names = {p.name for p in resources.files('lokal').joinpath('data').iterdir()}
    assert {'wilayah.json.gz', 'desa.json.gz', 'kodepos.json.gz', 'LICENSE-wilayah.txt', 'LICENSE-kodepos.txt'} <= names
    assert resources.files('lokal').joinpath('py.typed').is_file()
