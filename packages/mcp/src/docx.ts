// Minimal .docx reader: the text of a Word document, plus each table as CSV, for scanning and masking.
// A .docx file is a ZIP of XML parts (see xlsx.ts). The body, headers, footers, footnotes, endnotes, and comments are
// read in order with paragraphs as lines. Tables become their own parts, so a "Nama" column is masked like an Excel
// column instead of being one more line of prose. Formatting is ignored.
import { csvCell, decodeXml, unzip, type Sheet } from './xlsx.ts';

const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
const ORDER = ['document', 'header', 'footer', 'footnotes', 'endnotes', 'comments'];
const TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<\/w:p>/g;

function paragraphs(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(TOKEN)) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[2] === 'tab') out += '\t';
    else out += '\n';
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function tableCsv(xml: string): string {
  const rows = [...xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((r) =>
    [...r[1]!.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) => paragraphs(c[1]!).replace(/\s*\n\s*/g, ' ')),
  );
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')].map(csvCell).join(',')).join('\n');
}

/** "Dokumen" holds the text, with "[Tabel 1]" where each table was; "Tabel 1", "Tabel 2" … hold the tables. */
export function readDocx(buf: Buffer): Sheet[] {
  const files = unzip(buf);
  if (!files.has('word/document.xml')) throw new Error('Not a Word document (word/document.xml is missing).');
  const names = [...files.keys()].filter((n) => PARTS.test(n));
  const rank = (n: string) => ORDER.findIndex((o) => n.startsWith(`word/${o}`));
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true }));

  const tables: Sheet[] = [];
  const texts = names.map((n) =>
    paragraphs(
      files.get(n)!.toString('utf8').replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, (tbl) => {
        const name = `Tabel ${tables.length + 1}`;
        tables.push({ name, csv: tableCsv(tbl) });
        return `<w:p><w:r><w:t>[${name}]</w:t></w:r></w:p>`;
      }),
    ),
  );
  return [{ name: 'Dokumen', csv: texts.filter(Boolean).join('\n\n') }, ...tables];
}
