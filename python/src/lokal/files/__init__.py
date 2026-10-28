"""Reading and scanning files for personal data: text, CSV, JSON, logs, SQL, .xlsx, .docx, and text-based PDF.

The same readers the MCP server and the Claude Code guard use (``@lokal-id/mcp``), for Python backends: scan an upload
folder, or turn a document into text to mask before it goes to an LLM.

>>> from lokal.files import load_document, scan_path
>>> report = scan_path('var/media', exclude=['FINANCIAL'])       # doctest: +SKIP
>>> report.totals, [(n.file, n.reason) for n in report.not_scanned]  # doctest: +SKIP

>>> from lokal import Samaran
>>> doc = load_document('var/media/formulir.pdf')                # doctest: +SKIP
>>> masked = [Samaran().mask(part.text).text for part in doc.parts]  # doctest: +SKIP

Scanned PDFs and photos need OCR and are reported as not scanned, never as clean.
"""

from ._docx import read_docx
from ._load import MAX_FILE_BYTES, Document, DocumentKind, Part, is_text_file, load_config, load_document, walk_files
from ._pdf import PdfError, read_pdf_pages
from ._scan import Finding, NotScanned, ScanReport, scan_path
from ._xlsx import ZipError, read_xlsx

__all__ = [
    'MAX_FILE_BYTES',
    'Document',
    'DocumentKind',
    'Finding',
    'NotScanned',
    'Part',
    'PdfError',
    'ScanReport',
    'ZipError',
    'is_text_file',
    'load_config',
    'load_document',
    'read_docx',
    'read_pdf_pages',
    'read_xlsx',
    'scan_path',
    'walk_files',
]
