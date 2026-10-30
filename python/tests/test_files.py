"""lokal.files: the document readers must load every file exactly as the TypeScript MCP server does.

The vectors in vectors/documents.json hold each file's bytes and what ``loadDocument`` returned for it: the fixtures
of packages/mcp/test (a Chrome invoice, a ReportLab letter and form, an Excel export, a Word letter), the hand-built
PDFs of pdf-builder.ts, damaged copies of them, and text files with a BOM, broken UTF-8, and unsupported formats.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import pytest

from lokal.files import Document, load_document, read_pdf_pages, scan_path

VECTORS = Path(__file__).parent / 'vectors'
DOCUMENTS = json.loads((VECTORS / 'documents.json').read_text(encoding='utf-8'))
UNITS = {'spreadsheet': None, 'word': 'part', 'pdf': 'page'}


def ts_shape(doc: Document) -> dict[str, Any]:
    """A Document in the shape of the TypeScript loadDocument result."""
    if doc.kind == 'skipped':
        return {'kind': 'skipped', 'status': doc.scan_status, 'reason': doc.reason, 'dataBearing': doc.data_bearing}
    if doc.kind == 'text':
        out: dict[str, Any] = {'kind': 'text', 'text': doc.parts[0].text}
        if doc.sampled:
            out['sampled'] = True
        return out
    out = {'kind': 'sheets', 'sheets': [{'name': p.name, 'csv': p.text} for p in doc.parts]}
    if UNITS[doc.kind]:
        out['unit'] = UNITS[doc.kind]
    if doc.unscanned:
        out['unscanned'] = doc.unscanned
    return out


@pytest.mark.parametrize('case', DOCUMENTS, ids=[c['name'] for c in DOCUMENTS])
def test_documents_load_like_typescript(case: dict[str, Any], tmp_path: Path) -> None:
    file = tmp_path / case['name']
    file.write_bytes(base64.b64decode(case['data']))
    assert ts_shape(load_document(file)) == case['out']


def write(tmp_path: Path, name: str) -> Path:
    case = next(c for c in DOCUMENTS if c['name'] == name)
    file = tmp_path / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(base64.b64decode(case['data']))
    return file


def test_pdf_pages_and_parts(tmp_path: Path) -> None:
    doc = load_document(write(tmp_path, 'surat-keterangan.pdf'))
    assert doc.kind == 'pdf'
    assert [p.name for p in doc.parts] == ['Halaman 1', 'Halaman 3']
    assert doc.unscanned == 'page 2 of 3 has no text layer (scanned) and needs OCR'
    assert doc.parts[0].text.startswith('SURAT KETERANGAN\nNama: Budi Santoso\nNIK: 3201011508950001\n')
    form = read_pdf_pages(write(tmp_path, 'formulir.pdf').read_bytes())
    assert form == ['FORMULIR PENDAFTARAN\nNama lengkap\nNIK\nnama_lengkap: Siti Aminah\nnik: 3276015508030002\nsetuju: Yes']


def test_scan_path_reports_findings_without_values(tmp_path: Path) -> None:
    media = tmp_path / 'media'
    for name in ['invoice.pdf', 'surat-keterangan.pdf', 'formulir.pdf', 'pelanggan.xlsx', 'surat.docx', 'ktp.jpg', 'encrypted.pdf']:
        write(media, name)
    (media / 'node_modules').mkdir()
    (media / 'node_modules' / 'x.csv').write_text('nama,nik\nBudi,3201011508950001\n')
    (media / 'contoh').mkdir()
    (media / 'contoh' / 'seed.csv').write_text('nama,nik\nBudi,3201011508950001\n')
    (media / '.samaranignore').write_text('contoh/\n')

    report = scan_path(media)
    assert report.files_scanned == 6, 'five documents and .samaranignore itself'
    assert report.files_with_pii == 5
    assert report.files_ignored == 1
    assert report.totals['NIK'] >= 9
    assert not report.clean
    assert sorted((n.file, n.status, n.reason) for n in report.not_scanned) == [
        ('encrypted.pdf', 'failed', 'encrypted PDF (password-protected)'),
        ('ktp.jpg', 'unsupported', 'image (may be a KTP or selfie photo)'),
        ('surat-keterangan.pdf', 'partial', 'page 2 of 3 has no text layer (scanned) and needs OCR'),
    ]
    invoice = [f for f in report.findings if f.file == 'invoice.pdf']
    assert {f.part for f in invoice} == {'Halaman 1'}
    assert any(f.type == 'NAME' and f.uu_pdp == 'umum' for f in invoice)
    assert any(f.type == 'HEALTH' and f.uu_pdp == 'spesifik' for f in invoice)
    dump = json.dumps(report.to_dict())
    for secret in ['3201011508950001', 'Budi Santoso', 'Rina Wati', '0812-3456-7890', 'diabetes']:
        assert secret not in dump, secret

    # The dealer's credit simulation reads income and names; the rest stays masked.
    excluded = scan_path(media, exclude=['FINANCIAL', 'NAME'])
    assert 'FINANCIAL' not in excluded.totals and 'NAME' not in excluded.totals
    assert excluded.totals['NIK'] == report.totals['NIK']
    with pytest.raises(ValueError, match='Unknown PII type'):
        scan_path(media, types=['NAMA'])  # type: ignore[list-item]


def test_scan_single_file_and_clean_folder(tmp_path: Path) -> None:
    report = scan_path(write(tmp_path, 'formulir.pdf'))
    assert report.files_with_pii == 1
    assert {f.file for f in report.findings} == {'formulir.pdf'}
    clean = tmp_path / 'bersih'
    clean.mkdir()
    (clean / 'catatan.txt').write_text('Rapat besok jam 9, bahas target Q4.\n')
    assert scan_path(clean).clean


def test_samaran_json_rules_apply_to_scan_path(tmp_path: Path) -> None:
    import json

    from lokal.files import load_config

    (tmp_path / 'absen.csv').write_text('no_member,karyawan\nM-0042,EMP-004211\nM-0043,EMP-000001\n', encoding='utf-8')
    config = {
        'custom': [{'label': 'EMPLOYEE_ID', 'pattern': r'\bEMP-\d{6}\b'}, {'label': 'MEMBER', 'fields': ['no_member']}],
        'allow': ['EMP-000001'],
    }
    (tmp_path / '.samaran.json').write_text(json.dumps(config), encoding='utf-8')
    rules, allow = load_config(tmp_path)
    assert [r.label for r in rules] == ['EMPLOYEE_ID', 'MEMBER'] and allow == ['EMP-000001']
    report = scan_path(tmp_path)
    assert report.totals == {'MEMBER': 2, 'EMPLOYEE_ID': 1}
    assert [(f.type, f.label) for f in report.findings][0] == ('CUSTOM', 'MEMBER')
    assert scan_path(tmp_path, custom=[]).totals == {}, 'custom= replaces the file'

    (tmp_path / '.samaran.json').write_text('{"custom": [{"label": "NIK", "pattern": "x"}]}', encoding='utf-8')
    with pytest.raises(ValueError, match='built-in type'):
        load_config(tmp_path)
    with pytest.raises(ValueError, match='built-in type'):
        scan_path(tmp_path)


def test_samaran_json_policy_keys_load_as_the_mcp_server_checks_them(tmp_path: Path) -> None:
    from lokal.files import load_config

    config = {
        'custom': [{'label': 'MEMBER', 'fields': ['no_member']}],
        'policy': {'HEALTH': 'block', 'FINANCIAL': 'allow', 'PASSPORT': 'route', 'MEMBER': 'block'},
        'route': {'openai': 'http://127.0.0.1:11434/v1', 'model': 'llama3.2'},
        'audit': True,
        'vaultTtlMinutes': 30,
        'guard': 'strict',
    }
    (tmp_path / '.samaran.json').write_text(json.dumps(config), encoding='utf-8')
    rules, _ = load_config(tmp_path)
    assert [r.label for r in rules] == ['MEMBER']
    # The policy is for the model: scanning the repository is not changed by it.
    (tmp_path / 'gaji.csv').write_text('nama,gaji\nKenanga Purbasari,8500000\n', encoding='utf-8')
    assert scan_path(tmp_path).totals.get('FINANCIAL') == 1
    for bad, message in [
        ({'policy': {'NOPE': 'mask'}}, 'neither a type'),
        ({'policy': {'HEALTH': 'hide'}}, 'must be one of'),
        ({'custom': [{'label': 'MEMBER', 'fields': ['m']}], 'policy': {'MEMBER': 'allow'}}, 'remove the rule'),
        ({'policy': {'HEALTH': 'route'}}, 'needs a local endpoint'),
        ({'route': {'openai': 'ftp://x'}}, 'http\\(s\\) URL'),
        ({'audit': 3}, '"audit" must be'),
        ({'vaultTtlMinutes': 0}, 'positive number'),
        ({'guard': 'off'}, 'can only be "strict"'),
    ]:
        (tmp_path / '.samaran.json').write_text(json.dumps(bad), encoding='utf-8')
        with pytest.raises(ValueError, match=message):
            load_config(tmp_path)
