"""Masks personal data in Python logs before they reach a file, stdout, or a log service.

    import logging
    from lokal.samaran.logging import SamaranFilter

    handler = logging.StreamHandler()
    handler.addFilter(SamaranFilter())
    logging.getLogger().addHandler(handler)

    log.info('refund ke %s, HP %s', '1234567890', '0812-3456-7890')
    # refund ke ******7890, HP 0812****7890

Attach it to handlers (not loggers) so records from every logger pass through it.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Optional

from .core import Allow, Mode, Samaran
from .detectors import check_types
from .types import Confidence, PiiType


class SamaranFilter(logging.Filter):
    """A ``logging.Filter`` that masks the formatted message, exception text, and stack info of each record.

    ``mode="partial"`` (default) keeps logs readable: 3201********0001, 0812****7890. ``mode="placeholder"`` gives
    [NIK_1]-style tokens with a fresh vault per record. The record is changed in place and always let through.
    """

    def __init__(
        self,
        name: str = '',
        *,
        mode: Mode = 'partial',
        allow: Iterable[Allow] = (),
        types: Optional[Iterable[PiiType]] = None,
        exclude: Optional[Iterable[PiiType]] = None,
        min_confidence: Optional[Confidence] = None,
    ) -> None:
        super().__init__(name)
        self.mode: Mode = mode
        self.allow = tuple(allow)
        self.types = check_types(types) if types is not None else None
        self.exclude = check_types(exclude or ())
        self.min_confidence = min_confidence
        self._formatter = logging.Formatter()

    def _mask(self, text: str) -> str:
        samaran = Samaran(
            mode=self.mode, allow=self.allow, types=self.types, exclude=self.exclude, min_confidence=self.min_confidence
        )
        return samaran.mask(text).text

    def filter(self, record: logging.LogRecord) -> bool:
        if not super().filter(record):
            return False
        record.msg = self._mask(record.getMessage())
        record.args = None
        if record.exc_info and not record.exc_text:
            record.exc_text = self._formatter.formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = self._mask(record.exc_text)
        if record.stack_info:
            record.stack_info = self._mask(record.stack_info)
        return True
