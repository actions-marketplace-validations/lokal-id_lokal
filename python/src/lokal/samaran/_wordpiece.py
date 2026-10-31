"""BERT's WordPiece tokenizer, as Hugging Face's ``tokenizers`` runs it for IndoBERT (BertNormalizer with lower case,
BertPreTokenizer, WordPiece), with each token's (start, end) offsets into the original text. The same algorithm as
``WordPiece`` in ``@lokal-id/ner``; the parity vectors check that both cut text the same way.
"""

from __future__ import annotations

import json
import unicodedata
from typing import NamedTuple


class Token(NamedTuple):
    id: int
    start: int
    end: int
    #: A "##" piece: it continues the word of the token before it.
    sub: bool = False


# What ``tokenizers`` drops as a control character: every "Other" category, but not a tab or a line break.
_CONTROL = frozenset(('Cc', 'Cf', 'Co', 'Cn', 'Cs'))


def _is_chinese(cp: int) -> bool:
    """The CJK ideograph blocks BERT puts spaces around, so each is a word of its own."""
    return (
        0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF or 0x20000 <= cp <= 0x2A6DF or 0x2A700 <= cp <= 0x2B73F
        or 0x2B740 <= cp <= 0x2B81F or 0x2B820 <= cp <= 0x2CEAF or 0xF900 <= cp <= 0xFAFF or 0x2F800 <= cp <= 0x2FA1F
    )


def _is_punctuation(c: str) -> bool:
    """BERT counts ASCII symbols such as "$", "+", "^", and "`" as punctuation too."""
    cp = ord(c)
    ascii_symbol = 33 <= cp <= 47 or 58 <= cp <= 64 or 91 <= cp <= 96 or 123 <= cp <= 126
    return ascii_symbol or unicodedata.category(c).startswith('P')


def _is_whitespace(c: str) -> bool:
    # JavaScript's \s, which the TypeScript tokenizer uses: what Rust's char::is_whitespace() and Python agree on, plus
    # U+FEFF. Control characters are dropped before this is asked, so U+001C-U+001F and U+0085 never get here.
    return c.isspace() or c == '﻿'


class WordPiece:
    __slots__ = ('cls', 'max_chars_per_word', 'sep', 'unk', 'vocab')

    def __init__(self, vocab: dict[str, int], max_chars_per_word: int = 100) -> None:
        self.vocab = vocab
        self.max_chars_per_word = max_chars_per_word
        for name in ('[UNK]', '[CLS]', '[SEP]'):
            if name not in vocab:
                raise ValueError(f'The vocabulary has no {name} token')
        self.unk, self.cls, self.sep = vocab['[UNK]'], vocab['[CLS]'], vocab['[SEP]']

    @classmethod
    def from_tokenizer_json(cls, text: str) -> WordPiece:
        """From a ``tokenizer.json`` (Hugging Face ``tokenizers``) with a WordPiece model."""
        model = json.loads(text).get('model') or {}
        if model.get('type') != 'WordPiece' or not model.get('vocab'):
            raise ValueError('tokenizer.json does not hold a WordPiece model')
        return cls(dict(model['vocab']), int(model.get('max_input_chars_per_word', 100)))

    def encode(self, text: str) -> list[Token]:
        """The tokens of ``text``, without [CLS] and [SEP]."""
        out: list[Token] = []
        for word in self._words(text):
            self._word_pieces(word, out)
        return out

    def _words(self, text: str) -> list[list[tuple[str, int, int]]]:
        # Normalizes as BertNormalizer does (drop control characters, spaces for whitespace, spaces around CJK, lower
        # case, no accents), then splits into words at whitespace and around each punctuation mark.
        words: list[list[tuple[str, int, int]]] = []
        word: list[tuple[str, int, int]] = []
        for i, ch in enumerate(text):
            cp = ord(ch)
            break_char = ch in '\t\n\r'
            if not break_char and (cp == 0 or cp == 0xFFFD or unicodedata.category(ch) in _CONTROL):
                continue
            if break_char or _is_whitespace(ch):
                if word:
                    words.append(word)
                    word = []
                continue
            if _is_chinese(cp):
                if word:
                    words.append(word)
                    word = []
                words.append([(ch, i, i + 1)])
                continue
            for c in unicodedata.normalize('NFD', ch.lower()):
                if unicodedata.category(c) == 'Mn':
                    continue
                if _is_punctuation(c):
                    if word:
                        words.append(word)
                        word = []
                    words.append([(c, i, i + 1)])
                else:
                    word.append((c, i, i + 1))
        if word:
            words.append(word)
        return words

    def _word_pieces(self, word: list[tuple[str, int, int]], out: list[Token]) -> None:
        # Greedy longest match first; a word with a piece the vocabulary lacks is one [UNK].
        if len(word) > self.max_chars_per_word:
            out.append(Token(self.unk, word[0][1], word[-1][2]))
            return
        pieces: list[Token] = []
        start = 0
        while start < len(word):
            end = len(word)
            found = None
            while start < end:
                piece = ''.join(c for c, _, _ in word[start:end])
                found = self.vocab.get(piece if start == 0 else '##' + piece)
                if found is not None:
                    break
                end -= 1
            if found is None:
                out.append(Token(self.unk, word[0][1], word[-1][2]))
                return
            pieces.append(Token(found, word[start][1], word[end - 1][2], start > 0))
            start = end
        out.extend(pieces)
