"""Scanning files and folders for personal data, as the MCP server's ``scan_pii`` does, for Python backends.

Findings never contain the values themselves, only partially masked previews, so a report can be logged or shown in
an admin page.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Optional

from .._result import Result
from ..samaran import UU_PDP_CATEGORY, Confidence, PiiType, detect_pii, partial_mask
from ..samaran.custom import RuleLike, to_rules
from ..samaran.detectors import check_types
from ._load import Document, StrPath, load_config, load_document, load_ignore, walk_files


@dataclass(slots=True, frozen=True)
class Finding(Result):
    #: Path relative to the scanned folder, with "/" separators.
    file: str
    #: Sheet, table, or page ("Halaman 2"); None for a plain text file.
    part: Optional[str]
    #: 1-based line within the part.
    line: int
    type: PiiType
    confidence: Confidence
    #: "umum" or "spesifik" (UU PDP Article 4).
    uu_pdp: Literal['umum', 'spesifik']
    #: The value partially masked, such as "3201********0001".
    preview: str
    #: For CUSTOM: the label of the rule that found it.
    label: Optional[str] = None


@dataclass(slots=True, frozen=True)
class NotScanned(Result):
    file: str
    reason: str


@dataclass(slots=True)
class ScanReport(Result):
    files_scanned: int = 0
    files_with_pii: int = 0
    #: Files matched by .samaranignore.
    files_ignored: int = 0
    #: Matches per PII type.
    totals: dict[str, int] = field(default_factory=dict)
    findings: list[Finding] = field(default_factory=list)
    #: Files, and pages of PDFs, that may hold personal data but could not be read. Never treat them as clean.
    not_scanned: list[NotScanned] = field(default_factory=list)
    #: The folder had more files than ``file_limit``; the rest were not looked at.
    file_limit_reached: bool = False

    @property
    def clean(self) -> bool:
        """No personal data found, and nothing that could hold any left unread."""
        return not self.files_with_pii and not self.not_scanned and not self.file_limit_reached


def scan_path(
    path: StrPath,
    *,
    types: Optional[Iterable[PiiType]] = None,
    exclude: Optional[Iterable[PiiType]] = None,
    min_confidence: Confidence = 'high',
    ignore_file: bool = True,
    file_limit: int = 5000,
    custom: Optional[Iterable[RuleLike]] = None,
) -> ScanReport:
    """Scans a file or a folder (text, CSV, JSON, logs, SQL, .xlsx, .docx, text-based PDF) for personal data.

    Folders skip dependency, build, and VCS directories, and files listed in ``.samaranignore`` at the folder root
    (``ignore_file=False`` scans them too). The rules and allowed values in ``.samaran.json`` there apply too, unless
    ``custom`` gives the rules instead. Files that may hold personal data but cannot be read, such as images,
    scanned or encrypted PDFs, and archives, are listed in ``not_scanned``.

    >>> report = scan_path('var/media')                                      # doctest: +SKIP
    >>> report.totals, [n.file for n in report.not_scanned]                  # doctest: +SKIP
    """
    target = Path(path)
    is_dir = target.is_dir()
    root = target if is_dir else target.parent
    ignored = load_ignore(root) if ignore_file else None
    rules, allow = (list(to_rules(custom)), []) if custom is not None else load_config(root)
    report = ScanReport()
    files = list(walk_files(target, file_limit + 1)) if is_dir else [target]
    if len(files) > file_limit:
        files = files[:file_limit]
        report.file_limit_reached = True
    # Unknown type names fail before any file is read.
    types_list = check_types(types) if types is not None else None
    exclude_list = check_types(exclude) if exclude is not None else None

    for file in files:
        if ignored is not None and ignored(file):
            report.files_ignored += 1
            continue
        rel = Path(os.path.relpath(file, root)).as_posix() if is_dir else file.name
        try:
            doc: Document = load_document(file)
        except OSError:
            continue  # removed or unreadable while scanning
        if doc.kind == 'skipped':
            if doc.data_bearing:
                report.not_scanned.append(NotScanned(rel, doc.reason or ''))
            continue
        report.files_scanned += 1
        if doc.unscanned:
            report.not_scanned.append(NotScanned(rel, f'partly scanned: {doc.unscanned}'))
        has_pii = False
        for part in doc.parts:
            matches = detect_pii(
                part.text, types=types_list, exclude=exclude_list, min_confidence=min_confidence, custom=rules
            )
            for m in matches:
                if m.value in allow:
                    continue
                has_pii = True
                name = m.label or m.type
                report.totals[name] = report.totals.get(name, 0) + 1
                report.findings.append(Finding(
                    file=rel,
                    part=part.name,
                    line=part.text.count('\n', 0, m.start) + 1,
                    type=m.type,
                    confidence=m.confidence,
                    uu_pdp=UU_PDP_CATEGORY[m.type],
                    preview=partial_mask(m.type, m.value),
                    label=m.label,
                ))
        if has_pii:
            report.files_with_pii += 1
    return report
