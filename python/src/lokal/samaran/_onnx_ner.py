"""Lokal's own NER model in ONNX (``lokal-ner-base-v1``): download, checks, and inference with onnxruntime.

The same model and the same steps as ``@lokal-id/ner`` in Node: the files come from the GitHub release ``ner-base-v1``
and are checked against their SHA-256; the text is cut into tokens by ``WordPiece``, read in windows of at most 512
tokens, and the tokens are grouped into names by word (``aggregate_words``). Needs only onnxruntime
(``pip install "lokal-id[ner-lokal]"``).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import urllib.request
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from ._wordpiece import Token, WordPiece

NAME = 'lokal-ner-base-v1'
URL = 'https://github.com/lokal-id/lokal/releases/download/ner-base-v1/'
#: Each file of the model with its SHA-256 and size: the same values as ``MODEL`` in ``@lokal-id/ner``.
FILES: dict[str, tuple[str, int]] = {
    'model.onnx': ('88eda9302acae1ca4bf3f0261673713af467179fe0de730a8c25dcb2444cd254', 124610019),
    'tokenizer.json': ('da8791ba8d7a1459108876b0a0e105c5df39929cc8e7826499f63e74239b0181', 709027),
    'config.json': ('a8e49fbae72931c14fb26322aa9cfe5388ab29a9e208589e06d63739e1681d69', 1291),
}
_MAX_TOKENS = 512
_STRIDE = 64


def model_dir() -> Path:
    """The folder the model is cached in, shared with ``@lokal-id/ner``: ``LOKAL_NER_DIR``, or the user's cache."""
    base = os.environ.get('LOKAL_NER_DIR')
    if not base:
        if sys.platform == 'win32':
            root = os.environ.get('LOCALAPPDATA') or str(Path.home() / 'AppData' / 'Local')
        else:
            root = os.environ.get('XDG_CACHE_HOME') or str(Path.home() / '.cache')
        base = str(Path(root) / 'lokal-id' / 'ner')
    return Path(base) / NAME


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def read_verified(folder: Path) -> dict[str, bytes] | None:
    """The model's files from ``folder``, read once and checked in memory, or None when one is missing or does not
    match: what is used is exactly what was hashed, so a file replaced after the check is never loaded."""
    out: dict[str, bytes] = {}
    for name, (want, _) in FILES.items():
        try:
            data = (folder / name).read_bytes()
        except OSError:
            return None
        if hashlib.sha256(data).hexdigest() != want:
            return None
        out[name] = data
    return out


def verified(folder: Path) -> bool:
    """Whether every file of the model is in ``folder`` with its SHA-256."""
    return read_verified(folder) is not None


def load_files(folder: Path, check: bool) -> dict[str, bytes]:
    """The model's files, checked when ``check`` (the cache: downloaded first if needed), or as they are (a folder the
    caller chose)."""
    if not check:
        return {name: (folder / name).read_bytes() for name in FILES}
    files = read_verified(folder)
    if files is None:
        download_model(folder)
        files = read_verified(folder)
        if files is None:
            raise ValueError(f'The NER model in {folder} changed after it was downloaded and checked')
    return files


def download_model(folder: Path | None = None) -> Path:
    """Downloads the model into ``folder`` (default: the cache folder) unless it is there already, and checks every file
    against its SHA-256. A file that does not match is deleted and the call fails. Returns the folder."""
    folder = Path(folder) if folder is not None else model_dir()
    folder.mkdir(parents=True, exist_ok=True)
    for name, (want, _) in FILES.items():
        target = folder / name
        if target.is_file() and _sha256(target) == want:
            continue
        fd, tmp = tempfile.mkstemp(prefix=f'{name}.', suffix='.part', dir=folder)
        try:
            # A fixed https URL in this repository's releases.
            with os.fdopen(fd, 'wb') as out, urllib.request.urlopen(URL + name, timeout=60) as res:  # noqa: S310
                while block := res.read(1 << 20):
                    out.write(block)
            got = _sha256(Path(tmp))
            if got != want:
                raise ValueError(f'{name} from {URL} does not match its SHA-256 (got {got})')
            os.replace(tmp, target)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    return folder


class OnnxPipeline:
    """Works like the transformers token-classification pipeline: text in, entity groups with offsets and scores out."""

    __slots__ = ('_labels', '_session', '_tokenizer')

    def __init__(self, files: dict[str, bytes], threads: int | None = None) -> None:
        try:
            import onnxruntime as ort  # type: ignore[import-not-found,unused-ignore]
        except ImportError as e:  # pragma: no cover - depends on the extra
            raise ImportError(
                'The lokal model needs onnxruntime: pip install "lokal-id[ner-lokal]" (Python 3.11 or later)'
            ) from e
        config = json.loads(files['config.json'].decode('utf-8'))
        self._labels = [label for _, label in sorted(config['id2label'].items(), key=lambda kv: int(kv[0]))]
        self._tokenizer = WordPiece.from_tokenizer_json(files['tokenizer.json'].decode('utf-8'))
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads or max(1, min(4, (os.cpu_count() or 2) // 2))
        # From the bytes that were checked, not from the file again.
        self._session = ort.InferenceSession(files['model.onnx'], options, providers=['CPUExecutionProvider'])

    def _probabilities(self, ids: list[int]) -> list[Any]:
        # Text longer than the model reads at once goes in overlapping windows; a token takes its probabilities from
        # the window where it has the most context before it.
        import numpy as np  # type: ignore[import-not-found,unused-ignore]  # onnxruntime's own dependency

        n = _MAX_TOKENS - 2
        best: dict[int, Any] = {}
        start = 0
        while True:
            piece = [self._tokenizer.cls, *ids[start : start + n], self._tokenizer.sep]
            x = np.array([piece], dtype=np.int64)
            logits = self._session.run(
                ['logits'], {'input_ids': x, 'attention_mask': np.ones_like(x), 'token_type_ids': np.zeros_like(x)}
            )[0][0][1:-1]
            e = np.exp(logits - logits.max(-1, keepdims=True))
            p = e / e.sum(-1, keepdims=True)
            for i, row in enumerate(p):
                if start + i not in best or i >= _STRIDE:
                    best[start + i] = row
            if start + n >= len(ids):
                break
            start += n - _STRIDE
        return [best[i] for i in range(len(ids))]

    def __call__(self, text: str) -> list[dict[str, Any]]:
        tokens = self._tokenizer.encode(text)
        if not tokens:
            return []
        spans = aggregate_words(tokens, self._probabilities([t.id for t in tokens]), self._labels)
        return [{'entity_group': 'PER', 'start': s, 'end': e, 'score': score} for s, e, score in spans]


#: The person probability a word needs: chosen on the development sets (0.3 found no more names there).
WORD_THRESHOLD = 0.5


def aggregate_words(
    tokens: Sequence[Token], probs: Sequence[Sequence[float]], labels: Sequence[str], threshold: float = WORD_THRESHOLD
) -> list[tuple[int, int, float]]:
    """Person spans (start, end, score) from the model's token probabilities, by word.

    The model labels word pieces; a name can come out split when one piece of a word leans the other way ("kira" of
    "kirapuspa" at 0.01, "##pus" at 0.53, "##pa" at 0.86), and the word, or the rest of the name after it, is lost.
    Here each word takes the highest person probability of its pieces, and consecutive person words are one name
    unless a word leans to B- (a new name starts). The score is the mean of the words'. ``aggregateWords`` in
    ``@lokal-id/ner`` does the same, checked by parity vectors.
    """
    b = labels.index('B-PER') if 'B-PER' in labels else -1
    i = labels.index('I-PER') if 'I-PER' in labels else -1
    words: list[list[Any]] = []  # [start, end, person probability, begins a name]
    for t, p in zip(tokens, probs, strict=True):
        per = (float(p[b]) if b >= 0 else 0.0) + (float(p[i]) if i >= 0 else 0.0)
        if t.sub and words:
            words[-1][1] = t.end
            words[-1][2] = max(words[-1][2], per)
        else:
            words.append([t.start, t.end, per, b >= 0 and i >= 0 and float(p[b]) > float(p[i])])
    out: list[list[Any]] = []
    current: list[Any] | None = None
    for start, end, per, begins in words:
        if per < threshold:
            current = None
        elif current is not None and not begins:
            current[1] = end
            current[2].append(per)
        else:
            current = [start, end, [per]]
            out.append(current)
    return [(s, e, sum(scores) / len(scores)) for s, e, scores in out]
