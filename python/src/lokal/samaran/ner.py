"""Optional NER for names that Samaran's rules do not know: ``pip install "lokal-id[ner]"``.

Samaran finds a name from its label ("Nama:"), its place in a CSV or a form, a cue ("Pelanggan …", "a.n. …"), or a
known given or family name. A name with none of these, in a sentence, is missed. ``NerNames`` adds a model that reads
the sentence: ``cahya/bert-base-indonesian-NER`` (MIT), an IndoBERT fine-tuned for Indonesian NER, of which only the
person spans are kept, and only those that pass the filters below.

Settings were chosen on development data only. On Samaran's held-out benchmark it raised names protected from 93.6% to
98.1%, with no new false positive in 2,800 documents. On real news, where the rules alone find few names, it found 91.3%
of the people in the idner-news-2k test set (rules alone: 21.6%), at 98.3% precision.
The cost is the model: 440 MB, downloaded once from Hugging Face (or loaded from a folder), and about 20 ms per short
document on a laptop CPU instead of 0.2 ms. It is off unless you pass it:

    >>> from lokal.samaran import Samaran                                   # doctest: +SKIP
    >>> from lokal.samaran.ner import NerNames                              # doctest: +SKIP
    >>> samaran = Samaran(ner=NerNames())                                   # doctest: +SKIP

The weights are read from the model's safetensors file at a pinned revision, never from a pickle file, and the text
never leaves the machine: the model runs locally.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, Optional

from ..wilayah import _base
from .detectors import _NOT_NAME, _TITLE_WORDS
from .fields import field_type
from .types import PiiMatch

MODEL = 'cahya/bert-base-indonesian-NER'
#: Hugging Face's safetensors conversion of the model (pull request 5): the same weights, without a pickle file.
REVISION = '195cbbd70fa6b64c0965c5f7d3cb8758c93171ff'
_FILES = ['config.json', 'special_tokens_map.json', 'tokenizer_config.json', 'vocab.txt', 'model.safetensors']

# Chat words and forms of address the model takes for names.
_CHAT = frozenset((
    'kak', 'bu', 'pak', 'gan', 'sis', 'bro', 'min', 'mas', 'mbak', 'bang', 'dek', 'om', 'tante', 'hi', 'halo', 'hai',
    'sih', 'maka', 'ret',
))
# Police and military ranks, which news puts before a name ("Kombes Pol. …", "AKBP …").
_RANKS = frozenset((
    'kombes', 'pol', 'akbp', 'akp', 'kompol', 'iptu', 'ipda', 'aipda', 'aiptu', 'bripka', 'brigadir', 'briptu',
    'bripda',
    'brigjen', 'irjen', 'komjen', 'jenderal', 'mayjen', 'letjen', 'marsekal', 'laksamana', 'kolonel', 'letkol', 'mayor',
    'kapten', 'lettu', 'letda', 'serma', 'serka', 'kopda', 'prada', 'tni', 'polri',
))
_REGION_PREFIX = re.compile(r'^(?:kabupaten|kota|kab\.?|provinsi)\s+')
_CHUNK = 600
_SENTENCE_START = re.compile(r'(?<=[.!?])\s+(?=["“A-Z])')
_places: Optional[frozenset[str]] = None


def _place_names() -> frozenset[str]:
    """Names of provinces, regencies, cities, and districts: "Pati" in a sentence is a place, not a person."""
    global _places
    if _places is None:
        _places = frozenset(_REGION_PREFIX.sub('', n.lower()).strip() for n in _base().values())
    return _places


def keep_name(value: str, score: float, min_score: float = 0.7) -> bool:
    """Whether a person span from the model is kept: what the filters, tuned on the dev split, let through."""
    value = value.strip(' .,:;\'"()')
    words = value.split()
    if score < min_score or not words or len(re.sub(r'[^A-Za-z]', '', value)) < 3:
        return False
    # A name is written with capitals; lower-case names are the rules' job, where a cue says they are names.
    if not all(w[0].isupper() for w in words if w[0].isalpha()):
        return False
    # "NIK", "SD"; but a name the model is sure of may be initials, as news writes public figures ("SBY").
    if len(words) == 1 and value.isupper() and len(value) <= 4 and score < 0.9:
        return False
    low = [w.lower().strip('.,') for w in words]
    if any(w in _NOT_NAME or w in _TITLE_WORDS or w in _CHAT or w in _RANKS for w in low):
        return False
    if field_type('_'.join(low)) is not None:
        return False  # a column name
    places = _place_names()
    return ' '.join(low) not in places


def _chunks(text: str) -> list[tuple[int, int]]:
    """Where the model reads: each line, and a long line in pieces of about ``_CHUNK`` characters cut at sentence ends.

    The model finds names best in a short passage: in a long one it starts to miss names it finds when they stand alone.
    """
    out = []
    for line in re.finditer(r'[^\n]+', text):
        if not line.group().strip():
            continue
        start, end = line.start(), line.end()
        prev = start
        for m in _SENTENCE_START.finditer(text, start, end):
            if m.start() - start > _CHUNK and prev > start:
                out.append((start, prev))
                start = prev
            prev = m.end()
        if end - start > _CHUNK and prev > start:
            out.append((start, prev))
            start = prev
        out.append((start, end))
    return out


class NerNames:
    """Finds people's names with a local NER model, for ``Samaran(ner=…)`` and ``detect_pii(…, ner=…)``.

    ``model_path`` loads the model from a folder (offline, or an approved copy); otherwise it is downloaded once from
    Hugging Face at the pinned ``REVISION``, without pickle files. ``min_score`` is the model's confidence below which
    a name is dropped. Needs ``pip install "lokal-id[ner]"`` (transformers and PyTorch).
    """

    __slots__ = ('_pipeline', 'min_score')

    def __init__(self, *, model_path: Optional[str] = None, min_score: float = 0.7) -> None:
        try:
            from huggingface_hub import snapshot_download  # type: ignore[import-not-found,unused-ignore]
            from transformers import (  # type: ignore[import-not-found,unused-ignore]
                AutoModelForTokenClassification,
                AutoTokenizer,
                pipeline,
            )
        except ImportError as e:  # pragma: no cover - depends on the extra
            raise ImportError('NerNames needs the NER extra: pip install "lokal-id[ner]"') from e
        path = model_path or snapshot_download(MODEL, revision=REVISION, allow_patterns=_FILES)
        tokenizer = AutoTokenizer.from_pretrained(path)
        model = AutoModelForTokenClassification.from_pretrained(path, use_safetensors=True)
        # This tokenizer's config leaves its maximum length unset, so long text would reach the model in one piece and
        # fail past 512 tokens; with the limit set, the pipeline reads it in overlapping windows (stride).
        limit = int(getattr(model.config, 'max_position_embeddings', 512))
        if not tokenizer.model_max_length or tokenizer.model_max_length > limit:
            tokenizer.model_max_length = limit
        self._pipeline: Callable[..., Any] = pipeline(
            'token-classification', model=model, tokenizer=tokenizer, aggregation_strategy='simple', stride=64,
            device=-1,
        )
        self.min_score = min_score

    @classmethod
    def _with_pipeline(cls, fn: Callable[..., Any], min_score: float = 0.7) -> NerNames:
        """For tests: a stand-in for the model that returns what the transformers pipeline would."""
        self = cls.__new__(cls)
        self._pipeline = fn
        self.min_score = min_score
        return self

    def __call__(self, text: str) -> list[PiiMatch]:
        if not text.strip():
            return []
        out: list[PiiMatch] = []
        spans = [(r, offset) for offset, end in _chunks(text) for r in self._pipeline(text[offset:end])]
        for r, offset in spans:
            if r.get('entity_group') not in ('PER', 'PERSON'):
                continue
            start, end = offset + int(r['start']), offset + int(r['end'])
            # The model's span can carry spaces or punctuation at its edges.
            while start < end and not text[start].isalnum():
                start += 1
            while end > start and not text[end - 1].isalnum() and text[end - 1] != '.':
                end -= 1
            # It works on word pieces and can stop inside a word ("Gib" of a name): the whole word is the name.
            while start > 0 and text[start - 1].isalpha():
                start -= 1
            while end < len(text) and (
                text[end].isalpha() or (text[end] in "'’" and end + 1 < len(text) and text[end + 1].isalpha())
            ):
                end += 1
            # A rank or title in front stays: "Kombes Pol. Ronni" masks the name, not the rank.
            while True:
                head = re.match(r"[A-Za-z]+\.?\s+", text[start:end])
                if not head or head.group(0).strip().rstrip('.').lower() not in _RANKS | _TITLE_WORDS:
                    break
                start += head.end()
            value = text[start:end]
            if keep_name(value, float(r['score']), self.min_score):
                out.append(PiiMatch('NAME', start, end, value, 'medium'))
        return out


__all__ = ['MODEL', 'REVISION', 'NerNames', 'keep_name']
