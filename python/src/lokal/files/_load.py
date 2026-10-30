"""Loading files for scanning: as text, as parts (sheets, tables, pages), or as an explicit skip with a reason.

Port of packages/mcp/src/files.ts, which the MCP server's ``scan_pii`` and ``read_file_masked`` and the Claude Code
guard use. Results equal the TypeScript ones; the parity vectors check it.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NoReturn, Optional, Union

from .. import _js
from .._result import Result
from ..samaran.custom import CustomRule, check_custom_rules
from ..samaran.types import PII_TYPES, ScanStatus
from ._docx import read_docx
from ._pdf import read_pdf
from ._xlsx import read_xlsx

#: Files above this are reported instead of read; detection is linear, about 0.15 s per MB in TypeScript.
MAX_FILE_BYTES = 100 * 1024 * 1024

DocumentKind = Literal['text', 'spreadsheet', 'word', 'pdf', 'skipped']
StrPath = Union[str, 'os.PathLike[str]']


@dataclass(slots=True, frozen=True)
class Part(Result):
    #: A sheet name, "Dokumen" and "Tabel 1" in a Word file, "Halaman 2" in a PDF; None for a plain text file.
    name: Optional[str]
    #: The text, with spreadsheet sheets and tables as CSV.
    text: str


@dataclass(slots=True, frozen=True)
class Document(Result):
    """A file ready to scan or mask, one part per sheet, table, or page; or why it was skipped."""

    kind: DocumentKind
    parts: tuple[Part, ...] = ()
    #: Only the first ``sample_bytes`` of a large text file were read, cut at a line break.
    sampled: Optional[bool] = None
    #: What was read only in part: scanned or damaged pages of a PDF. They may hold personal data.
    unscanned: Optional[str] = None
    #: Why a skipped file was not read.
    reason: Optional[str] = None
    #: Whether a skipped file may hold personal data (images, PDFs, archives) or not (other binary files).
    data_bearing: Optional[bool] = None
    #: For a skipped file: ``unsupported`` (a kind Lokal does not read) or ``failed`` (a kind it reads, but this one
    #: would not). Read :attr:`scan_status` for any document.
    skip_status: Optional[Literal['unsupported', 'failed']] = None

    @property
    def scan_status(self) -> ScanStatus:
        """How much of the file a check saw."""
        if self.kind == 'skipped':
            return self.skip_status or 'unsupported'
        return 'partial' if self.sampled or self.unscanned else 'scanned'

    @property
    def text(self) -> str:
        """All parts joined by blank lines, for a quick look; scan parts one by one to keep tables apart."""
        return '\n\n'.join(p.text for p in self.parts)


def _mb(size: int) -> str:
    return f'{_js.round_half_up(size / 1024 / 1024)} MB'


def _page_list(pages: list[int]) -> str:
    """'2, 4-6, 9'"""
    out = []
    i = 0
    while i < len(pages):
        j = i
        while j + 1 < len(pages) and pages[j + 1] == pages[j] + 1:
            j += 1
        out.append(f'{pages[i]}-{pages[j]}' if j > i else f'{pages[i]}')
        i = j + 1
    return ', '.join(out)


# Formats that commonly hold personal data but cannot be read yet: they must be reported, not ignored.
_UNSUPPORTED_DATA = {
    '.xls': 'Excel 97-2003 (.xls) is not supported; save it as .xlsx or .csv',
    '.doc': 'Word 97-2003 (.doc) is not supported; save it as .docx',
    '.ods': 'OpenDocument spreadsheets are not supported yet',
    '.db': 'database file',
    '.sqlite': 'database file',
    '.sqlite3': 'database file',
    '.zip': 'archive',
    '.gz': 'archive',
    '.rar': 'archive',
    '.7z': 'archive',
    '.jpg': 'image (may be a KTP or selfie photo)',
    '.jpeg': 'image (may be a KTP or selfie photo)',
    '.png': 'image (may be a KTP or selfie photo)',
    '.heic': 'image (may be a KTP or selfie photo)',
    '.webp': 'image (may be a KTP or selfie photo)',
}


def _skipped(reason: str, data_bearing: bool = True) -> Document:
    return Document('skipped', reason=reason, data_bearing=data_bearing, skip_status='unsupported')


def _failed(reason: str) -> Document:
    return Document('skipped', reason=reason, data_bearing=True, skip_status='failed')


def is_text_file(file: StrPath) -> bool:
    """Binary files have NUL bytes early on; text files do not."""
    with open(file, 'rb') as f:
        return b'\x00' not in f.read(8000)


def _read_head(file: StrPath, size: int) -> str:
    with open(file, 'rb') as f:
        text = f.read(size).decode('utf-8', 'replace')
    last_break = text.rfind('\n')
    return text[:last_break] if last_break > 0 else text


def _error(e: Exception) -> str:
    return str(e) if str(e) else type(e).__name__


def load_document(
    file: StrPath, *, sample_bytes: Optional[int] = None, max_parsed_bytes: Optional[int] = None
) -> Document:
    """Loads a file for scanning: as text, as parts (sheets, Word text and tables, PDF pages), or a reasoned skip.

    ``sample_bytes`` reads only the start of a larger text file; ``max_parsed_bytes`` skips spreadsheets, Word files,
    and PDFs above that size instead of parsing them. Both exist for callers with a time budget.
    """
    ext = os.path.splitext(os.fspath(file))[1].lower()
    size = os.stat(file).st_size
    if size > MAX_FILE_BYTES:
        return _skipped(f'larger than {_mb(MAX_FILE_BYTES)}')
    if ext in ('.xlsx', '.xlsm', '.docx', '.pdf') and max_parsed_bytes is not None and size > max_parsed_bytes:
        return _skipped(f'larger than {_mb(max_parsed_bytes)}')
    if ext in ('.xlsx', '.xlsm'):
        try:
            sheets = read_xlsx(Path(file).read_bytes())
        except Exception as e:  # a damaged file is reported, never raised
            return _failed(f'unreadable spreadsheet: {_error(e)}')
        return Document('spreadsheet', tuple(Part(name, text) for name, text in sheets))
    if ext == '.docx':
        try:
            parts = read_docx(Path(file).read_bytes())
        except Exception as e:
            return _failed(f'unreadable Word document: {_error(e)}')
        return Document('word', tuple(Part(name, text) for name, text in parts))
    if ext == '.pdf':
        try:
            pages, scanned, damaged, total = read_pdf(Path(file).read_bytes())
        except Exception as e:
            message = _error(e)
            if re.search('encrypted', message):
                return _failed('encrypted PDF (password-protected)')
            return _failed(f'unreadable PDF: {re.sub(r"[.]$", "", message)}')
        if not pages and (scanned or damaged):
            if damaged:
                return _failed('damaged PDF: no readable text')
            return _skipped('PDF without a text layer (scanned); needs OCR')
        notes = []
        if scanned:
            one = len(scanned) == 1
            notes.append(
                f'{"page" if one else "pages"} {_page_list(scanned)} of {total} {"has" if one else "have"} '
                f'no text layer (scanned) and need{"s" if one else ""} OCR'
            )
        if damaged:
            one = len(damaged) == 1
            notes.append(
                f'{"page" if one else "pages"} {_page_list(damaged)} of {total} {"is" if one else "are"} '
                'damaged and could not be read'
            )
        return Document('pdf', tuple(Part(name, text) for name, text in pages), unscanned='; '.join(notes) or None)
    unsupported = _UNSUPPORTED_DATA.get(ext)
    if unsupported:
        return _skipped(unsupported)
    if not is_text_file(file):
        return _skipped('binary file', data_bearing=False)
    if sample_bytes is not None and size > sample_bytes:
        return Document('text', (Part(None, _read_head(file, sample_bytes)),), sampled=True)
    return Document('text', (Part(None, Path(file).read_bytes().decode('utf-8', 'replace')),))


# ------------------------------------------------------------------------------------------------ folders

SKIP_DIRS = frozenset({
    'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage', 'vendor',
    '__pycache__', '.venv', 'venv', '.turbo', '.cache', 'target',
})


def walk_files(directory: StrPath, limit: int = 5000) -> Iterator[Path]:
    """Files under ``directory``, skipping dependency, build, and VCS folders; at most ``limit`` of them."""
    stack = [Path(directory)]
    count = 0
    while stack:
        current = stack.pop()
        try:
            entries = sorted(os.scandir(current), key=lambda e: e.name)
        except OSError:
            continue
        for e in entries:
            if e.is_dir(follow_symlinks=False):
                if e.name not in SKIP_DIRS:
                    stack.append(Path(e.path))
            elif e.is_file(follow_symlinks=False):
                count += 1
                if count > limit:
                    return
                yield Path(e.path)


def glob_to_regexp(glob: str) -> re.Pattern[str]:
    out = ''
    i = 0
    while i < len(glob):
        c = glob[i]
        if c == '*' and glob[i + 1 : i + 2] == '*':
            slash = glob[i + 2 : i + 3] == '/'
            out += '(?:.*/)?' if slash else '.*'
            i += 3 if slash else 2
            continue
        if c == '*':
            out += '[^/]*'
        elif c == '?':
            out += '[^/]'
        elif c == '{' and glob.find('}', i) > i:
            # "*.{csv,json}"
            close = glob.find('}', i)
            out += '(?:' + '|'.join(glob_to_regexp(alt).pattern[1:-1] for alt in glob[i + 1 : close].split(',')) + ')'
            i = close
        else:
            out += re.escape(c)
        i += 1
    return re.compile(f'^{out}$')


def load_config(root: StrPath) -> tuple[list[CustomRule], list[str]]:
    r"""``.samaran.json`` at the project root: a team's own rules and the values it never wants masked, as
    ``(custom, allow)``; empty when there is none. The MCP server, the guard, and ``lokal-mcp scan`` read the same
    file::

        {"custom": [{"label": "EMPLOYEE_ID", "pattern": "\\bEMP-\\d{6}\\b"},
                    {"label": "MEMBER", "fields": ["no_member"]}],
         "allow": ["0800-1-500-500"]}

    A file that is there but wrong raises ValueError: a rule that silently did nothing would mask less than expected.
    """
    file = Path(root) / '.samaran.json'
    if not file.is_file():
        return [], []
    try:
        raw = json.loads(file.read_text(encoding='utf-8'))
    except ValueError as e:
        raise ValueError(f'.samaran.json is not valid JSON: {e}') from None

    def fail(why: str) -> NoReturn:
        raise ValueError(f'.samaran.json: {why}')

    if not isinstance(raw, dict):
        fail('expected an object with "custom" and "allow"')
    known = ('custom', 'allow', 'policy', 'route', 'audit', 'vaultTtlMinutes', 'guard')
    unknown = [k for k in raw if k not in known and not k.startswith('$')]
    if unknown:
        fail(
            f'unknown key {", ".join(chr(34) + k + chr(34) for k in unknown)} '
            '(expected "custom", "allow", "policy", "route", "audit", "vaultTtlMinutes", or "guard")'
        )
    custom = raw.get('custom', [])
    allow = raw.get('allow', [])
    if not isinstance(custom, list):
        fail('"custom" must be a list of rules')
    if not isinstance(allow, list) or not all(isinstance(a, str) for a in allow):
        fail('"allow" must be a list of strings')
    rules: list[CustomRule] = []
    for i, r in enumerate(custom):
        if not isinstance(r, dict):
            fail(f'custom[{i}] must be an object')
        extra = [k for k in r if k not in ('label', 'pattern', 'fields')]
        if extra:
            fail(f'custom[{i}]: unknown key {", ".join(chr(34) + k + chr(34) for k in extra)}')
        if not isinstance(r.get('label'), str):
            fail(f'custom[{i}] needs a "label"')
        if r.get('pattern') is not None and not isinstance(r['pattern'], str):
            fail(f'custom[{i}].pattern must be a string')
        fields = r.get('fields')
        names_ok = isinstance(fields, list) and all(isinstance(f, str) and f.strip() for f in fields)
        if fields is not None and not names_ok:
            fail(f'custom[{i}].fields must be a list of field names')
        rules.append(CustomRule(r['label'], r.get('pattern'), tuple(fields or ())))
    try:
        check_custom_rules(rules)
    except ValueError as e:
        fail(str(e))
    _check_policy(raw, {r.label for r in rules}, fail)
    return rules, list(allow)


_POLICY_ACTIONS = ('mask', 'allow', 'block', 'route')


def _check_policy(raw: dict[str, object], labels: set[str], fail: Callable[[str], NoReturn]) -> None:
    """The keys the proxy, the MCP server, and the guard use, checked as they check them, so a file that works there
    also loads here. This library masks by its own options; the policy is theirs."""
    policy = raw.get('policy')
    if policy is not None:
        if not isinstance(policy, dict):
            fail('"policy" must be an object such as { "HEALTH": "block" }')
        for key, action in policy.items():
            if key not in PII_TYPES and key not in labels:
                fail(f'policy: "{key}" is neither a type ({", ".join(PII_TYPES)}) nor a label in "custom"')
            if action not in _POLICY_ACTIONS:
                fail(f'policy.{key} must be one of {", ".join(chr(34) + a + chr(34) for a in _POLICY_ACTIONS)}')
            if action == 'allow' and key in labels:
                fail(f'policy.{key}: "allow" for a custom rule; remove the rule from "custom" instead')
    route = raw.get('route')
    if route is not None:
        if not isinstance(route, dict):
            fail('"route" must be an object such as { "openai": "http://127.0.0.1:11434/v1" }')
        extra = [k for k in route if k not in ('openai', 'anthropic', 'model')]
        if extra:
            fail(f'route: unknown key {", ".join(chr(34) + k + chr(34) for k in extra)}')
        for k in ('openai', 'anthropic'):
            v = route.get(k)
            if v is not None and (not isinstance(v, str) or not re.match(r'https?://', v)):
                fail(f'route.{k} must be an http(s) URL')
        if route.get('model') is not None and not isinstance(route['model'], str):
            fail('route.model must be a string')
    routes = isinstance(route, dict) and (route.get('openai') or route.get('anthropic'))
    if isinstance(policy, dict) and 'route' in policy.values() and not routes:
        fail('"route" in policy needs a local endpoint: add "route": { "openai": "http://127.0.0.1:11434/v1" }')
    audit = raw.get('audit')
    if not isinstance(audit, (bool, type(None))) and (not isinstance(audit, str) or not audit.strip()):
        fail('"audit" must be true or a file path')
    ttl = raw.get('vaultTtlMinutes')
    if ttl is not None and (isinstance(ttl, bool) or not isinstance(ttl, (int, float)) or not ttl > 0):
        fail('"vaultTtlMinutes" must be a positive number')
    if raw.get('guard', 'strict') != 'strict':
        fail('"guard" can only be "strict" (SAMARAN_GUARD=off on your own machine turns the guard off)')


def load_ignore(root: StrPath) -> IgnoreRule:
    """``.samaranignore`` at the project root: gitignore-like patterns for files known to hold only fake data."""
    return IgnoreRule(Path(root))


class IgnoreRule:
    """Patterns without "/" match the file name anywhere; a trailing "/" matches a directory and everything in it."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self._rules: list[tuple[re.Pattern[str], bool, bool]] = []
        file = self.root / '.samaranignore'
        if not file.is_file():
            return
        for raw in file.read_text(encoding='utf-8').splitlines():
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            dir_only = line.endswith('/')
            clean = re.sub(r'^/|/$', '', line)
            self._rules.append((glob_to_regexp(clean), dir_only, '/' in re.sub(r'/$', '', line)))

    def __call__(self, path: StrPath) -> bool:
        try:
            rel = Path(path).resolve().relative_to(self.root).as_posix()
        except ValueError:
            return False
        segments = rel.split('/')
        for regexp, dir_only, anchored in self._rules:
            if anchored:
                # Match the path itself or any of its parent directories.
                for i in range(len(segments), 0, -1):
                    if dir_only and i == len(segments):
                        continue
                    if regexp.match('/'.join(segments[:i])):
                        return True
                continue
            candidates = segments[:-1] if dir_only else segments
            if any(regexp.match(s) for s in candidates):
                return True
        return False
