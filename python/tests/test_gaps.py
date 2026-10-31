"""Gaps an independent evaluation of 0.16.1 found, as in packages/core/test/gaps.test.ts. Every value is made up."""

from __future__ import annotations

import pytest

from lokal.samaran import Samaran, detect_pii


def found(text: str) -> list[str]:
    return [f'{m.type}:{m.value}' for m in detect_pii(text)]


@pytest.mark.parametrize(
    ('text', 'want'),
    [
        ('pemohon (NIK 3175.0912.0390.0002) sudah datang', ['NIK:3175.0912.0390.0002']),
        ('No. KTP 3175.0912.0390.0002', ['NIK:3175.0912.0390.0002']),
        ('tolong cek 3175.0912.0390.0002 ya', ['NIK:3175.0912.0390.0002']),
        ('KK 32.01.01.150895.0001', ['KK:32.01.01.150895.0001']),
        ('transfer Rp 12.500.000.000 ke kas', []),
        ('build 2026.10.31.1200 rilis', []),
        ('{"ship_to": "Komp. Griya Kenanga 6"}', ['ADDRESS:Komp. Griya Kenanga 6']),
        ('kirim ke Komp. Griya Kenanga 6 ya kak', ['ADDRESS:Komp. Griya Kenanga 6']),
        ('Kenanga Residence Blok C2 No. 5, Bekasi', ['ADDRESS:Blok C2 No. 5']),
        ('Perum Bulog 2 gudang penuh', []),
        ('perumahan 45 rumah', []),
        ('2026-10-31 10:00:01 INFO payment-svc transfer trace_id=7340958123094857', []),
        ('tf berhasil, ref 7340958123094857', []),
        ('waktu proses 0812345678 ms', []),
        ('duration=0856123456', []),
        ('transfer ke rek 7340958123094857', ['BANK_ACCOUNT:7340958123094857']),
        ('hp 0812345678 ms dulu', ['PHONE:0812345678']),
    ],
)
def test_found(text: str, want: list[str]) -> None:
    assert found(text) == want


def test_name_columns_without_a_meaningful_header() -> None:
    csv = 'c1,c2,c3\nBudi Santoso,Bogor,120000\nKaleandra Wirasena,Depok,50000\nSiti Aminah,Bekasi,75000\nYohanes Tumbelaka,Bandung,9000\n'
    for text in (csv, csv.replace('\n', '\r\n')):
        names = [m for m in detect_pii(text) if m.type == 'NAME']
        assert [m.value for m in names] == ['Budi Santoso', 'Kaleandra Wirasena', 'Siti Aminah', 'Yohanes Tumbelaka']
        assert all(text[m.start : m.end] == m.value for m in names)
    assert found('c1,c2\nIndomie Goreng,3500\nAqua Botol,4000\nTeh Pucuk,3000\nKopi Kapal Api,2000\n') == []


def test_lower_case_name_restored_in_the_case_around_it() -> None:
    s = Samaran()
    s.mask('nama: Paijo')
    text = s.mask('aku paijo yg td chat').text
    assert text == 'aku [NAME_1] yg td chat'
    assert s.unmask(text) == 'aku paijo yg td chat'
    assert s.unmask('Halo [NAME_1], pesanan dikirim') == 'Halo Paijo, pesanan dikirim'


@pytest.mark.parametrize(
    ('text', 'want'),
    [
        ('name: Budi_Santoso', ['NAME:Budi_Santoso']),
        ('name: build_and_test', []),
        ('Kemudian Fatimah binti Abdullah datang', ['NAME:Fatimah binti Abdullah']),
        ('yang hadir R. Ayu Kusumawardhani dan Budi', ['NAME:R. Ayu Kusumawardhani']),
        ('Saksi melihat SUPRIYADI ALIAS UDIN TELAH MENGAMBIL motor', ['NAME:SUPRIYADI ALIAS UDIN']),
        ('IMEI: 356938035643809', []),
        ('kirim ke Kp. Rawa Bebek RT 04/09, Bekasi', ['ADDRESS:Kp. Rawa Bebek RT 04/09']),
    ],
)
def test_round_two(text: str, want: list[str]) -> None:
    assert found(text) == want


def test_kembaran_replaces_a_nik_the_detector_misses() -> None:
    from lokal.kembaran import Kembaran

    sql = "INSERT INTO t VALUES ('3276-0101.0180 0001', 'x');\nINSERT INTO t VALUES ('32760101.01800002', 'y');"
    assert detect_pii(sql) == []
    r = Kembaran(secret='s').texts([sql])
    digits = ''.join(c for c in r.files[0].text if c.isdigit())
    assert '3276010101800001' not in digits and '3276010101800002' not in digits
    assert r.files[0].crossed == {'NIK': 2}
