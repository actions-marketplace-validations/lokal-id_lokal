"""The package makes no network calls: every public area runs with sockets and name lookups replaced by ones that
raise and record."""

from __future__ import annotations

import socket
from pathlib import Path

import pytest

import lokal
from lokal import wilayah
from lokal.files import load_document, scan_path
from lokal.kembaran import Kembaran


def test_no_network_calls(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[str] = []

    def refuse(name: str):  # type: ignore[no-untyped-def]
        def blocked(*args: object, **kwargs: object) -> None:
            attempts.append(f'{name} {args[:1]}')
            raise OSError(f'network access blocked in this test: {name}')

        return blocked

    monkeypatch.setattr(socket.socket, 'connect', refuse('socket.connect'))
    monkeypatch.setattr(socket.socket, 'connect_ex', refuse('socket.connect_ex'))
    monkeypatch.setattr(socket.socket, 'sendto', refuse('socket.sendto'))
    monkeypatch.setattr(socket, 'create_connection', refuse('create_connection'))
    monkeypatch.setattr(socket, 'getaddrinfo', refuse('getaddrinfo'))
    monkeypatch.setattr(socket, 'gethostbyname', refuse('gethostbyname'))

    (tmp_path / 'pelanggan.csv').write_text('nama,nik,hp\nBudi Santoso,3201011508950001,0812-3456-7890\n', encoding='utf-8')
    text = 'Nama: Budi Santoso, NIK 3201011508950001, HP 0812-3456-7890'
    s = lokal.Samaran(custom=[{'label': 'EMPLOYEE_ID', 'pattern': r'\bEMP-\d{6}\b'}])
    assert s.unmask(s.mask(f'{text} EMP-004211').text) == f'{text} EMP-004211'
    lokal.detect_pii(text)
    lokal.parse_nik('3201011508950001')
    lokal.parse_npwp('01.234.567.8-901.000')
    lokal.parse_phone('0812-3456-7890')
    lokal.format_rupiah(1500000)
    lokal.parse_rupiah('Rp1,5 jt')
    lokal.terbilang(1500000)
    lokal.get_holidays(2026)
    wilayah.search_wilayah('Kemiri Muka')
    wilayah.parse_alamat('Jl. Margonda Raya No. 1, Kemiri Muka, Beji, Depok 16423')
    Kembaran(secret='uji').text(text)
    load_document(tmp_path / 'pelanggan.csv')
    assert scan_path(tmp_path).files_with_pii == 1

    assert attempts == []
