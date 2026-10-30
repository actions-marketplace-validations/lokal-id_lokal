"""lokal.samaran.ner: the filters on the model's names, and how its matches join Samaran's.

The model itself is tested only where the ``ner`` extra is installed (LOKAL_TEST_NER=1); the rest uses a stand-in that
returns what the transformers pipeline returns. Every name here is made up.
"""

from __future__ import annotations

import os
from typing import Any

import pytest

from lokal.samaran import Samaran, detect_pii
from lokal.samaran.ner import NerNames, keep_name


def fake(spans: dict[str, float]) -> NerNames:
    """A model that calls each listed word a person, with the given score."""

    def pipeline(text: str) -> list[dict[str, Any]]:
        out = []
        for value, score in spans.items():
            i = text.find(value)
            if i >= 0:
                out.append({'entity_group': 'PER', 'start': i, 'end': i + len(value), 'score': score, 'word': value})
        out.append({'entity_group': 'LOC', 'start': 0, 'end': 1, 'score': 0.99, 'word': text[:1]})
        return out

    return NerNames._with_pipeline(pipeline)


def test_filters_drop_labels_chat_words_places_and_low_scores() -> None:
    assert keep_name('Raditya Wiraguna', 0.95)
    assert keep_name('Kirana', 0.9)
    assert not keep_name('Raditya Wiraguna', 0.6), 'below min_score'
    for value in ['kak', 'Hi', 'NIK', 'SD', 'nopol', 'Pati', 'Kota Bogor', 'Sleman', 'Ny', 'raditya']:
        assert not keep_name(value, 0.99), value


def test_ner_matches_join_samaran_and_rules_win_where_they_overlap() -> None:
    ner = fake({'Raditya Wiraguna': 0.97, 'Budi Santoso': 0.99, 'kak': 0.95})
    text = 'kak, tolong kabari Raditya Wiraguna. Nama: Budi Santoso, NIK 3201011508950001'
    assert [m.value for m in detect_pii(text, types=['NAME'])] == ['Budi Santoso']
    found = detect_pii(text, ner=ner)
    assert [(m.type, m.value) for m in found] == [
        ('NAME', 'Raditya Wiraguna'), ('NAME', 'Budi Santoso'), ('NIK', '3201011508950001'),
    ]
    assert next(m for m in found if m.value == 'Budi Santoso').confidence == 'high', "the rules' match"
    s = Samaran(ner=ner)
    masked = s.mask(text).text
    assert masked == 'kak, tolong kabari [NAME_1]. Nama: [NAME_2], NIK [NIK_1]'
    assert s.unmask(masked) == text
    assert detect_pii(text, ner=ner, exclude=['NAME'])[0].type == 'NIK'


def test_offsets_after_an_emoji_stay_on_the_name() -> None:
    ner = fake({'Raditya Wiraguna': 0.97})
    text = '🙏🙏 makasih Raditya Wiraguna'
    [m] = detect_pii(text, ner=ner)
    assert text[m.start : m.end] == m.value == 'Raditya Wiraguna'


@pytest.mark.skipif(os.environ.get('LOKAL_TEST_NER') != '1', reason='set LOKAL_TEST_NER=1 with the ner extra installed')
def test_the_model_finds_a_name_the_rules_miss() -> None:  # pragma: no cover - needs the model
    ner = NerNames()
    text = 'Tadi sore Raditya Wiraguna datang ke kantor cabang untuk mengurus klaim.'
    assert detect_pii(text, types=['NAME']) == []
    assert [m.value for m in detect_pii(text, ner=ner)] == ['Raditya Wiraguna']


@pytest.mark.skipif(os.environ.get('LOKAL_TEST_NER') != '1', reason='set LOKAL_TEST_NER=1 with the ner extra installed')
def test_the_model_reads_text_longer_than_its_window() -> None:  # pragma: no cover - needs the model
    ner = NerNames()
    filler = 'Rapat koordinasi membahas anggaran daerah dan program kerja tahun depan. ' * 80
    text = filler + 'Usai rapat, Raditya Wiraguna menjawab pertanyaan wartawan.'
    assert [m.value for m in ner(text)] == ['Raditya Wiraguna']


def test_the_model_reads_lines_and_short_passages_and_offsets_stay_in_the_whole_text() -> None:
    seen: list[str] = []

    def pipeline(text: str) -> list[dict[str, Any]]:
        seen.append(text)
        i = text.find('Raditya Wiraguna')
        return [] if i < 0 else [{'entity_group': 'PER', 'start': i, 'end': i + 16, 'score': 0.99, 'word': ''}]

    ner = NerNames._with_pipeline(pipeline)
    long_line = 'Rapat koordinasi membahas anggaran daerah dan program kerja tahun depan. ' * 30
    text = 'tiket 12\n\n' + long_line + 'Usai rapat, Raditya Wiraguna menjawab pertanyaan wartawan.\nselesai'
    found = ner(text)
    assert [(m.value, text[m.start:m.end]) for m in found] == [('Raditya Wiraguna', 'Raditya Wiraguna')]
    assert all(len(s) <= 700 for s in seen) and len(seen) > 4
    assert ''.join(seen).replace(' ', '') == text.replace('\n', '').replace(' ', '')


def test_a_name_cut_inside_a_word_is_masked_whole_and_ranks_in_front_stay() -> None:
    def pipeline(text: str) -> list[dict[str, Any]]:
        # The model's word pieces: "Gib" of "Gibran", and a rank swept into the name.
        i = text.find('Gibran')
        j = text.find('Kombes')
        return [
            {'entity_group': 'PER', 'start': i, 'end': i + 3, 'score': 0.95, 'word': 'Gib'},
            {'entity_group': 'PER', 'start': j, 'end': j + len('Kombes Pol. Raditya Wiraguna'), 'score': 0.9, 'word': ''},
        ]

    ner = NerNames._with_pipeline(pipeline)
    text = 'Syarat pendidikan Gibran dipersoalkan, ujar Kombes Pol. Raditya Wiraguna.'
    assert [m.value for m in ner(text)] == ['Gibran', 'Raditya Wiraguna']
