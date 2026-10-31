"""lokal.samaran._onnx_ner: where Lokal's model is cached, and that a download is checked before it is used.

No network: urlopen is replaced by a stand-in that serves bytes. The model itself is tested in test_ner.py, with
LOKAL_TEST_NER=1.
"""

from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
from typing import Any

import pytest

from lokal.samaran import _onnx_ner
from lokal.samaran._wordpiece import WordPiece


def serve(monkeypatch: pytest.MonkeyPatch, files: dict[str, bytes]) -> list[str]:
    asked: list[str] = []

    def urlopen(url: str, timeout: float = 0) -> Any:
        asked.append(url)
        return io.BytesIO(files[url.rsplit('/', 1)[1]])

    monkeypatch.setattr(_onnx_ner.urllib.request, 'urlopen', urlopen)
    return asked


def test_download_checks_every_file_and_keeps_what_is_already_there(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    files = {'model.onnx': b'model', 'tokenizer.json': b'{}', 'config.json': b'{"id2label": {}}'}
    monkeypatch.setattr(_onnx_ner, 'FILES', {n: (hashlib.sha256(b).hexdigest(), len(b)) for n, b in files.items()})
    asked = serve(monkeypatch, files)
    assert _onnx_ner.download_model(tmp_path) == tmp_path
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(files)
    assert _onnx_ner.verified(tmp_path)
    assert all(url.startswith('https://github.com/lokal-id/lokal/releases/download/ner-base-v1/') for url in asked)
    asked.clear()
    _onnx_ner.download_model(tmp_path)
    assert asked == []


def test_a_file_that_does_not_match_its_hash_is_not_kept(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_onnx_ner, 'FILES', {'model.onnx': (hashlib.sha256(b'the real model').hexdigest(), 14)})
    serve(monkeypatch, {'model.onnx': b'something else'})
    with pytest.raises(ValueError, match='does not match its SHA-256'):
        _onnx_ner.download_model(tmp_path)
    assert list(tmp_path.iterdir()) == []
    assert not _onnx_ner.verified(tmp_path)


def test_the_cache_folder_is_shared_with_the_node_package(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv('LOKAL_NER_DIR', str(tmp_path))
    assert _onnx_ner.model_dir() == tmp_path / 'lokal-ner-base-v1'
    monkeypatch.delenv('LOKAL_NER_DIR')
    assert _onnx_ner.model_dir().parts[-3:] == ('lokal-id', 'ner', 'lokal-ner-base-v1')


def test_the_files_are_the_ones_the_node_package_checks() -> None:
    index = Path(__file__).resolve().parents[2] / 'packages' / 'ner' / 'src' / 'index.ts'
    if not index.is_file():  # pragma: no cover - only in a checkout with the Node packages
        pytest.skip('packages/ner is not here')
    source = index.read_text(encoding='utf-8')
    for name, (sha256, size) in _onnx_ner.FILES.items():
        assert f"'{name}'" in source and sha256 in source and str(size) in source, name
    assert _onnx_ner.URL in source


def test_wordpiece_needs_its_special_tokens() -> None:
    with pytest.raises(ValueError, match=r'\[CLS\]'):
        WordPiece({'[UNK]': 0, '[SEP]': 1})
    with pytest.raises(ValueError, match='WordPiece'):
        WordPiece.from_tokenizer_json('{"model": {"type": "BPE", "vocab": {}}}')


@pytest.mark.skipif(not os.environ.get('LOKAL_NER_DIR'), reason='set LOKAL_NER_DIR to a folder that holds the model')
def test_the_pipeline_reads_like_the_transformers_one() -> None:  # pragma: no cover - needs the model
    pipe = _onnx_ner.OnnxPipeline(_onnx_ner.load_files(_onnx_ner.model_dir(), check=True))
    [person] = pipe('saya di chat sama rianto surya tadi pagi')
    assert person['entity_group'] == 'PER'
    assert (person['start'], person['end']) == (18, 30)
    assert 0.7 < person['score'] <= 1
