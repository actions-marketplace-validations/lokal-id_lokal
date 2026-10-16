import threading
from collections import Counter

from lokal import wilayah
from lokal.wilayah import (
    find_by_postal_code,
    get_wilayah,
    list_wilayah,
    normalize_wilayah_code,
    postal_codes_in,
    search_wilayah,
    wilayah_name,
)


def test_38_provinces() -> None:
    provinces = list_wilayah()
    assert len(provinces) == 38
    assert all(p.type == 'provinsi' for p in provinces)


def test_codes_with_or_without_dots() -> None:
    assert normalize_wilayah_code('3276') == '32.76'
    assert normalize_wilayah_code('3276011001') == '32.76.01.1001'
    assert wilayah_name('3276') == 'Kota Depok'


def test_get_wilayah_type_and_path() -> None:
    depok = get_wilayah('32.76')
    assert depok is not None
    assert depok.type == 'kota'
    assert depok.path == 'Kota Depok, Jawa Barat'
    assert get_wilayah('32.01').type == 'kabupaten'  # type: ignore[union-attr]
    assert get_wilayah('91.03.01').type == 'distrik'  # type: ignore[union-attr]  # Sentani, Kabupaten Jayapura
    assert get_wilayah('91.03.01.3007').type == 'desa_adat'  # type: ignore[union-attr]  # Desa Adat Yoboi
    desa = list_wilayah('32.01.01')[0]
    assert desa.level == 4
    assert desa.path.endswith('Cibinong, Kabupaten Bogor, Jawa Barat')


def test_postal_codes_per_village() -> None:
    depok = next(w for w in list_wilayah('32.76.01') if w.name == 'Depok')
    assert depok.postal_code == '16431'
    assert postal_codes_in('32.76.01') == ['16431', '16432', '16433', '16434', '16435', '16436']
    assert any(w.code == depok.code for w in find_by_postal_code('16431'))
    assert find_by_postal_code('abc') == []
    assert get_wilayah('32.76').postal_code is None  # type: ignore[union-attr]


def test_cascading_dropdown() -> None:
    kab_kota = list_wilayah('32')
    assert len(kab_kota) >= 27
    assert all(w.code.startswith('32.') and w.level == 2 for w in kab_kota)


def test_search_tolerates_prefixes() -> None:
    assert search_wilayah('depok')[0].name == 'Kota Depok'
    assert search_wilayah('Kab. Bogor')[0].code == '32.01'
    assert search_wilayah('jakarta selatan')[0].name == 'Kota Administrasi Jakarta Selatan'
    assert search_wilayah('kec. cibinong', level=3)[0].name == 'Cibinong'
    assert all(w.code.startswith('32') for w in search_wilayah('a', within='32', limit=5))


def test_totals_match_kepmendagri_2138_2025() -> None:
    count: Counter[str] = Counter()

    def walk(parent: str | None = None) -> None:
        for w in list_wilayah(parent):
            # Desa adat and Papua distrik/kampung count as desa/kecamatan in the official recap.
            count[{'desa_adat': 'desa', 'distrik': 'kecamatan'}.get(w.type, w.type)] += 1
            if w.level < 4:
                walk(w.code)

    walk()
    assert count == {'provinsi': 38, 'kabupaten': 416, 'kota': 98, 'kecamatan': 7285, 'kelurahan': 8496, 'desa': 75266}


def test_postal_codes_checked_against_independent_sources() -> None:
    # en.wikipedia.org/wiki/Cinere and /wiki/Tapos; id.wikipedia's Depok list has wrong 165xx codes here.
    expected = {('Cinere', 'Cinere'): '16514', ('Cinere', 'Gandul'): '16512', ('Tapos', 'Tapos'): '16457',
                ('Tapos', 'Jatijajar'): '16451'}
    for (kec, kel), kode_pos in expected.items():
        district = search_wilayah(kec, within='32.76', level=3)[0]
        village = next(w for w in list_wilayah(district.code) if w.name == kel)
        assert village.postal_code == kode_pos, kel


def test_concurrent_first_use_loads_once() -> None:
    wilayah._cache.clear()
    results: list[int] = []

    def worker() -> None:
        results.append(len(list_wilayah('32.76')))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == [11] * 8
