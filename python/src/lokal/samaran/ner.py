"""Optional NER for names that Samaran's rules do not know: ``pip install "lokal-id[ner-lokal]"``.

Samaran finds a name from its label ("Nama:"), its place in a CSV or a form, a cue ("Pelanggan …", "a.n. …"), or a
known given or family name. A name with none of these, in a sentence, is missed: in news, and most of all in chat
("saya di chat sama rianto surya tadi pagi"). ``NerNames`` adds a model that reads the sentence, of which only the
person spans are kept, and only those that pass the filters below. Three models, all MIT, all IndoBERT fine-tuned for
Indonesian NER:

- ``'lokal'`` (the default): Lokal's own model, ``lokal-ner-base-v1``, IndoBERT-base fine-tuned for person names (see
  packages/ner/MODEL.md). 125 MB in ONNX, about 20 ms per short document on a laptop CPU, and only onnxruntime to
  install (``lokal-id[ner-lokal]``). On the held-out chat corpus it protects 98.9% of the names; on Samaran's held-out
  benchmark, 98.8%; in the idner-news-2k test set it finds 93.4% of the people at 98.6% precision.
- ``'gold'``: ``treamyracle/indobert-ner-gold``, IndoBERT-large. 1.3 GB, about 100 ms per short document. On the same
  data, 89.3% and 99.6%, and 96.1% of the people in news: the best on news, the weakest in chat.
- ``'fast'``: ``cahya/bert-base-indonesian-NER``, IndoBERT-base. 440 MB, about 30 ms per short document. 62.2% and
  98.1%, and 91.5% in news.

``'gold'`` and ``'fast'`` need transformers and PyTorch (``lokal-id[ner]``). Settings were chosen on development data
only, and none of the three added a false positive in the benchmarks' trap documents. On real news the rules alone find
21.6% of the people, and 19.4% of the names in chat. The rules take 0.2 ms per document. NER is off unless you pass it:

    >>> from lokal.samaran import Samaran                                   # doctest: +SKIP
    >>> from lokal.samaran.ner import NerNames                              # doctest: +SKIP
    >>> samaran = Samaran(ner=NerNames())                                   # doctest: +SKIP

``'lokal'`` is downloaded from the GitHub release ``ner-base-v1`` and checked against its SHA-256; the other two are
read from their safetensors file at a pinned revision, never from a pickle file. The text never leaves the machine: the
models run locally. All three need Python 3.11 or later, as onnxruntime and PyTorch do.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, Optional

from ..wilayah import _base
from . import _onnx_ner
from .detectors import _NOT_NAME, _TITLE_WORDS
from .fields import field_type
from .types import PiiMatch

#: The models ``NerNames(model=…)`` can load: where from (a Hugging Face id, or this repository's releases), the pinned
#: revision (a commit, or the release tag), and the files read from it.
MODELS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    'lokal': ('lokal-id/lokal', 'ner-base-v1', tuple(_onnx_ner.FILES)),
    'gold': (
        'treamyracle/indobert-ner-gold',
        '014ef5da775cdc6ffea1bdcce8f5db2557791d99',
        ('config.json', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt',
         'model.safetensors'),
    ),
    'fast': (
        'cahya/bert-base-indonesian-NER',
        # Hugging Face's safetensors conversion of the model (pull request 5): the same weights, without a pickle file.
        '195cbbd70fa6b64c0965c5f7d3cb8758c93171ff',
        ('config.json', 'special_tokens_map.json', 'tokenizer_config.json', 'vocab.txt', 'model.safetensors'),
    ),
}
DEFAULT_MODEL = 'lokal'
MODEL, REVISION, _ = MODELS[DEFAULT_MODEL]

# Chat words, slang, and forms of address the model takes for names, most of all in lower-case chat.
_CHAT = frozenset((
    'kak', 'bu', 'pak', 'gan', 'sis', 'bro', 'min', 'mas', 'mbak', 'bang', 'dek', 'om', 'tante', 'hi', 'halo', 'hai',
    'sih', 'maka', 'ret',
    # greetings, calls, and fillers
    'woy', 'woi', 'oi', 'oy', 'hei', 'hey', 'hallo', 'helo', 'cuy', 'coy', 'bestie', 'beb', 'say', 'sayang', 'bos',
    'boss', 'bund', 'bunda', 'ayah', 'mama', 'papa', 'mamah', 'papah', 'nak', 'dik', 'kang', 'teh', 'neng', 'akang',
    'uda', 'uni', 'abang', 'kakak', 'adek', 'mba', 'mbok', 'pakde', 'bude', 'paklik', 'bulik', 'cak', 'ko',
    'cik', 'ci', 'koh', 'ncek', 'engkoh', 'gais', 'guys', 'gaes', 'gengs', 'bray', 'brader', 'bruh', 'sob',
    'wkwk', 'wkwkwk', 'haha', 'hahaha', 'hehe', 'hihi', 'xixi', 'awokwok', 'anjir', 'anjay', 'anjim', 'buset',
    'astaga', 'astagfirullah', 'alhamdulillah', 'insyaallah', 'masyaallah', 'aamiin', 'amin', 'yaudah', 'yaudahlah',
    'mantap', 'mantul', 'sip', 'siap', 'oke', 'okey', 'okay', 'ok', 'gas', 'gaskeun', 'santuy', 'santai', 'mager',
    # abbreviations
    'otw', 'btw', 'gpp', 'gapapa', 'gak', 'ga', 'nggak', 'enggak', 'kagak', 'gk', 'tdk', 'blm', 'udh', 'udah', 'sdh',
    'yg', 'dgn', 'utk', 'krn', 'tp', 'tpi', 'sm', 'td', 'tadi', 'skrg', 'gmn', 'gimana', 'knp', 'kenapa', 'emg',
    'emang', 'bgt', 'banget', 'aja', 'doang', 'kuy', 'yuk', 'cmiiw', 'imho', 'fyi', 'asap', 'thx', 'tq', 'makasih',
    'trims', 'mksh', 'pls', 'plis', 'tolong', 'maaf', 'sorry', 'sori', 'dong', 'deh', 'kok', 'kan', 'lho', 'loh',
    'nih', 'tuh', 'gitu', 'gini', 'gue', 'gua', 'gw', 'lu', 'lo', 'elu', 'elo', 'aku', 'kamu', 'kau', 'dia', 'ane',
    'ente', 'saya', 'kita', 'kami', 'mereka', 'anda', 'admin', 'kurir', 'driver', 'cs', 'ka', 'kk',
))
# Everyday verbs of chat, informal and plain, that the model takes for names in lower case ("nelpon", "nungguin").
_INFORMAL = frozenset((
    'nelpon', 'nelfon', 'telpon', 'telepon', 'telponan', 'nanya', 'nanyain', 'nyari', 'nyariin', 'nyampe', 'nyusul',
    'nyuruh', 'nyetir', 'nunggu', 'nungguin', 'nemenin', 'nganter', 'nganterin', 'ngabarin', 'ngajak', 'ngasih',
    'ngirim', 'ngomong', 'ngobrol', 'ngopi', 'ngantor', 'ngecek', 'nitip', 'titip', 'balikin', 'kabarin', 'beliin',
    'bilangin', 'jemput', 'jemputin', 'nebeng', 'mampir', 'nongkrong', 'bales', 'balas', 'bilang', 'dateng', 'datang',
    'pulang', 'pergi', 'makan', 'minum', 'tidur', 'mandi', 'kerja', 'belajar', 'main', 'liat', 'lihat', 'denger',
    'ketemu', 'ketemuan', 'chat', 'chatting', 'japri', 'dm', 'wa', 'transfer', 'tf', 'bayar', 'kirim', 'kasih',
    'tanya', 'hubungi', 'telat', 'izin', 'cuti', 'sakit', 'resign', 'lembur', 'piket', 'rapat', 'meeting',
))
# Common English words, which mixed Indonesian and English text puts next to names ("Rina Pratama, born 9 Agustus").
# A name written in lower case must not be one; a capitalized one ("Grace", "Joy") may.
_ENGLISH = frozenset('''
a about above after again against age all also am an and any are as at be because been before being below between
both but by can could did do does doing down during each few for from further had has have having he her here hers
herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once
only or other our ours out over own same she should so some such than that the their theirs them then there these
they this those through to too under until up very was we were what when where which while who whom why will with
would you your yours yourself born died dead age aged birth birthday married single divorced widow widowed male female
gender sex religion occupation job status account user customer client patient guest member employee staff manager
admin owner holder name names full first last middle nickname address phone email mobile number id card passport
date day today tomorrow yesterday later soon now morning night please thanks thank sorry hello hi hey dear regards
sir madam mr mrs ms miss check call send sent reply replied ask asked told tell said say says meeting report invoice
order payment refund ticket issue problem help support team project task update done pending approved rejected
new old good great nice okay fine yes yeah nope maybe sure ready free busy online offline home office work
suffer suffers suffering suffered diagnosed treated admitted discharged visited lives lived living works worked
working stays stayed moved arrived left needs needed wants wanted
'''.split())
# Informal verbs by their form: "nge-" ("ngeliat", "ngerjain") and the passive "di-…-in" ("dibeliin"). Not "ng-" or
# "ny-" alone, nor "-in" alone: Ngurah, Nyoman, Ngadiman, Arifin, and Syamsudin are names.
_INFORMAL_VERB = re.compile(r'^nge[a-z]{3,}$|^di[a-z]{3,}in$')
# A letter repeated at the end of a chat word ("kakk", "makasihh").
_STRETCHED = re.compile(r'([a-z])\1+$')
#: The score a name written without capitals needs: the model reads lower case, but a capital letter is evidence too.
LOWER_MIN_SCORE = 0.7
# Police and military ranks, which news puts before a name ("Kombes Pol. …", "AKBP …").
_RANKS = frozenset((
    'kombes', 'pol', 'akbp', 'akp', 'kompol', 'iptu', 'ipda', 'aipda', 'aiptu', 'bripka', 'brigadir', 'briptu',
    'bripda',
    'brigjen', 'irjen', 'komjen', 'jenderal', 'mayjen', 'letjen', 'marsekal', 'laksamana', 'kolonel', 'letkol', 'mayor',
    'kapten', 'lettu', 'letda', 'serma', 'serka', 'kopda', 'prada', 'tni', 'polri',
))
# Log levels: "[10:02] WARN login check …" opens a log line, not a name.
_LOG_LEVELS = frozenset(('warn', 'warning', 'error', 'err', 'info', 'debug', 'trace', 'fatal', 'notice', 'critical'))
# Words in front of a name that are left out of it: ranks, titles, and forms of address ("mama rina", "ci lina").
_LEADING = _RANKS | _TITLE_WORDS | _CHAT
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


def keep_name(value: str, score: float, min_score: float = 0.7, min_lower_score: float = LOWER_MIN_SCORE) -> bool:
    """Whether a person span from the model is kept: what the filters, tuned on the dev split, let through.

    The model reads lower case (its tokenizer lowercases everything), so a name in chat ("sama rianto surya") gets the
    same score as a capitalized one. A name not written with capitals must score ``min_lower_score``, as it has no
    capital letter to back it, and must not be a chat word or an informal verb.
    """
    value = value.strip(' .,:;\'"()')
    words = value.split()
    if score < min_score or not words or len(re.sub(r'[^A-Za-z]', '', value)) < 3:
        return False
    if not _cased(value) and score < min_lower_score:
        return False
    # "NIK", "SD"; but a name the model is sure of may be initials, as news writes public figures ("SBY").
    if len(words) == 1 and value.isupper() and len(value) <= 4 and score < 0.9:
        return False
    low = [w.lower().strip('.,') for w in words]
    # A chat word or verb is not a name in any case: at the start of a sentence ("Nitip ya") or in capitals too.
    plain = [_STRETCHED.sub(r'\1', w) for w in low]
    if any(w in _INFORMAL for w in low + plain):
        return False
    # By form only in lower case: "Ngesti" is a name.
    if not _cased(value) and any(_INFORMAL_VERB.match(w) or w in _ENGLISH for w in low):
        return False
    if any(w in _NOT_NAME or w in _TITLE_WORDS or w in _CHAT or w in _RANKS or w in _LOG_LEVELS for w in low + plain):
        return False
    if field_type('_'.join(low)) is not None:
        return False  # a column name
    places = _place_names()
    return ' '.join(low) not in places


def _cased(value: str) -> bool:
    """Whether the value is written as a name: every word capitalized (in capitals too, as on an ID card)."""
    words = [w for w in value.split() if w[0].isalpha()]
    return bool(words) and all(w[0].isupper() for w in words)


def _in_prose(text: str, start: int, end: int) -> bool:
    """Whether a lower-case word sits in a sentence, not in a CSV header, a ``key=value``, or a JSON key, where a
    lower-case word is a field name ("nopol,pemilik", "retry=1")."""
    line_start = text.rfind('\n', 0, start) + 1
    line_end = text.find('\n', end)
    line = text[line_start : line_end if line_end >= 0 else len(text)]
    after = text[end : end + 2].lstrip(' ')
    before = text[max(0, start - 2) : start].rstrip(' ')
    if after[:1] in ('=', '"', '_', '@') or before[-1:] in ('=', '"', '_', '.', '/', '@'):
        return False
    if after[:1] == '.' and after[1:2].isalnum():
        return False  # "budi.susanto@…"
    return len(re.findall(r'[^\W\d_]{2,}', line)) >= 3 and ' ' in line.strip()


def ner_chunks(text: str) -> list[tuple[int, int]]:
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

    ``model`` is ``'lokal'`` (the default: Lokal's own model, best in chat), ``'gold'`` (best in news), or ``'fast'``;
    see ``MODELS``. ``model_path`` loads the model from a folder instead (offline, or an approved copy): one with
    ``model.onnx`` is read as Lokal's model. Otherwise the model is downloaded once and checked: ``'lokal'`` from the
    GitHub release (cached where ``@lokal-id/ner`` caches it), the others from Hugging Face at their pinned revision,
    without pickle files. ``min_score`` is the model's confidence below which a name is dropped. ``'lokal'`` needs
    ``pip install "lokal-id[ner-lokal]"`` (onnxruntime); the others ``pip install "lokal-id[ner]"`` (also PyTorch).
    """

    __slots__ = ('_pipeline', 'min_score')

    def __init__(self, *, model: str = DEFAULT_MODEL, model_path: Optional[str] = None, min_score: float = 0.7) -> None:
        if model not in MODELS:
            raise ValueError(f'model must be one of {", ".join(map(repr, MODELS))}, not {model!r}')
        self.min_score = min_score
        if (model == 'lokal' and model_path is None) or (model_path is not None and _is_onnx(model_path)):
            folder = Path(model_path) if model_path is not None else _onnx_ner.model_dir()
            files = _onnx_ner.load_files(folder, check=model_path is None)
            self._pipeline: Callable[..., Any] = _onnx_ner.OnnxPipeline(files)
            return
        try:
            from huggingface_hub import snapshot_download  # type: ignore[import-not-found,unused-ignore]
            from transformers import (  # type: ignore[import-not-found,unused-ignore]
                AutoModelForTokenClassification,
                AutoTokenizer,
                pipeline,
            )
        except ImportError as e:  # pragma: no cover - depends on the extra
            raise ImportError('NerNames needs the NER extra: pip install "lokal-id[ner]" (Python 3.11 or later)') from e
        repo, revision, wanted = MODELS[model]
        path = model_path or snapshot_download(repo, revision=revision, allow_patterns=list(wanted))
        tokenizer = AutoTokenizer.from_pretrained(path)
        weights = AutoModelForTokenClassification.from_pretrained(path, use_safetensors=True)
        # These tokenizers' configs leave the maximum length unset, so long text would reach the model in one piece and
        # fail past 512 tokens; with the limit set, the pipeline reads it in overlapping windows (stride).
        limit = int(getattr(weights.config, 'max_position_embeddings', 512))
        if not tokenizer.model_max_length or tokenizer.model_max_length > limit:
            tokenizer.model_max_length = limit
        self._pipeline = pipeline(
            'token-classification', model=weights, tokenizer=tokenizer, aggregation_strategy='simple', stride=64,
            device=-1,
        )

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
        spans = []
        for offset, end in ner_chunks(text):
            for r in self._pipeline(text[offset:end]):
                if r.get('entity_group') in ('PER', 'PERSON'):
                    spans.append((offset + int(r['start']), offset + int(r['end']), float(r['score'])))
        return names_from_spans(text, spans, self.min_score)


def _is_onnx(model_path: str) -> bool:
    """Whether a model folder holds Lokal's ONNX model rather than a transformers one."""
    return (Path(model_path) / 'model.onnx').is_file()


def download_model(folder: Optional[str] = None) -> str:
    """Downloads Lokal's model (``'lokal'``, 125 MB) ahead of time, for a container image or a machine that will be
    offline later, and checks it. Returns the folder; ``NerNames()`` reads it from there."""
    return str(_onnx_ner.download_model(Path(folder) if folder else None))


def names_from_spans(text: str, spans: Iterable[tuple[int, int, float]], min_score: float = 0.7) -> list[PiiMatch]:
    """The model's person spans (start, end, score; offsets into ``text``) as NAME matches: widened to whole words,
    without a leading title, and filtered. ``@lokal-id/ner`` in Node does the same, with the same test vectors."""
    out: list[PiiMatch] = []
    for start, end, score in spans:
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
        # A rank, title, or form of address in front stays: "Kombes Pol. Ronni" masks the name, not the rank.
        while True:
            head = re.match(r"[A-Za-z]+\.?\s+", text[start:end])
            if not head or head.group(0).strip().rstrip('.').lower() not in _LEADING:
                break
            start += head.end()
        value = text[start:end]
        # A lower-case name counts in a sentence only: in a CSV header or a key=value it is a field name.
        in_place = _cased(value) or _in_prose(text, start, end)
        if in_place and keep_name(value, score, min_score):
            out.append(PiiMatch('NAME', start, end, value, 'medium'))
    return out


__all__ = [
    'DEFAULT_MODEL', 'MODEL', 'MODELS', 'REVISION', 'NerNames', 'download_model', 'keep_name', 'names_from_spans',
    'ner_chunks',
]
