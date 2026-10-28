// Reading attached files for masking: text files as they are, spreadsheets as CSV per sheet, Word documents and PDFs
// as text. No DOM or extension APIs, so node:test can cover it. In the extension, `Buffer` and node:zlib are the shims
// in ./shims, so the readers from packages/mcp run unchanged in the browser.
import { readDocx } from '../../mcp/src/docx.ts';
import { readPdf } from '../../mcp/src/pdf.ts';
import { readXlsx, type Sheet } from '../../mcp/src/xlsx.ts';

/** Files above this are not read, since masking them would hang the tab; the user decides whether to send them. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set(
  (
    'txt text csv tsv tab psv json jsonl ndjson geojson md markdown log out xml yaml yml toml ini cfg conf env properties ' +
    'sql html htm vcf ics eml mbox srt vtt rtf tex ' +
    'js mjs cjs jsx ts tsx py rb php go java kt kts swift cs c h cc cpp hpp rs dart scala lua r pl sh bash zsh ps1 bat ' +
    'vue svelte astro css scss less graphql gql proto prisma ipynb'
  ).split(' '),
);
const DOCUMENTS = { xlsx: 'sheets', xlsm: 'sheets', docx: 'docx', pdf: 'pdf' } as const;

export type AttachmentKind = 'text' | 'sheets' | 'docx' | 'pdf';

const extensionOf = (name: string) => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
const baseOf = (name: string) => name.replace(/\.[^./\\]+$/, '') || name;

/** What Lokal can read in a file, from its name and type; undefined for images, archives, and other binaries. */
export function attachmentKind(name: string, type = ''): AttachmentKind | undefined {
  const ext = extensionOf(name);
  if (ext in DOCUMENTS) return DOCUMENTS[ext as keyof typeof DOCUMENTS];
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (/^text\//.test(type) || /^application\/(?:json|xml|x-ndjson|sql|x-yaml|yaml|javascript)$/.test(type)) return 'text';
  return undefined;
}

const IMAGE_FILE = /\.(?:jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i;
// Words in a file name that point at a photo or scan of someone's document. The guard uses a longer list that also
// names whose files they are; in a chat, "pelanggan.png" is as likely a chart as a KTP.
const ID_DOCUMENT =
  /(?:^|[^a-z])(?:e?ktp|kk|kartu[ _-]?keluarga|npwp|sim|paspor|passport|selfie|swafoto|identitas|id[ _-]?card|akta|ijazah|slip[ _-]?gaji|rekening|tabungan|bpjs|kyc)(?:[^a-z]|$)/i;

/** An image whose name says it is a photo of an ID document, a selfie for verification, or a bank book. */
export function looksLikeIdPhoto(name: string, type = ''): boolean {
  return (IMAGE_FILE.test(name) || type.startsWith('image/')) && ID_DOCUMENT.test(name.replace(/\.[^.]+$/, ''));
}

/** A readable file, split into the parts that are masked one by one. */
export interface Readable {
  kind: AttachmentKind;
  parts: Sheet[];
  /** Pages with no text layer, which a masked copy leaves out. */
  scannedPages?: number[];
}

/** Why a file could not be read; it is sent as it is only if the user says so. */
export interface Unreadable {
  kind: AttachmentKind;
  reason: 'too-large' | 'scanned' | 'encrypted' | 'damaged';
}

export function readAttachment(name: string, bytes: Uint8Array, type = ''): Readable | Unreadable | undefined {
  const kind = attachmentKind(name, type);
  if (!kind) return undefined;
  if (bytes.length > MAX_ATTACHMENT_BYTES) return { kind, reason: 'too-large' };
  const buf = Buffer.from(bytes);
  if (kind === 'text') {
    // A file that holds NUL bytes is not text, whatever its name says.
    if (buf.subarray(0, 8000).includes(0)) return undefined;
    return { kind, parts: [{ name, csv: buf.toString('utf8') }] };
  }
  try {
    if (kind === 'sheets') return { kind, parts: readXlsx(buf) };
    if (kind === 'docx') return { kind, parts: readDocx(buf) };
    const { pages, scanned, damaged } = readPdf(buf);
    if (!pages.length) return { kind, reason: damaged.length ? 'damaged' : 'scanned' };
    return { kind, parts: pages, scannedPages: scanned.length ? scanned : undefined };
  } catch (e) {
    return { kind, reason: /encrypted/i.test((e as Error).message) ? 'encrypted' : 'damaged' };
  }
}

export interface MaskedFile {
  name: string;
  type: string;
  text: string;
}

const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'Sheet';

/**
 * The files to upload in place of the original, from its masked parts. A text file keeps its name and type. A
 * spreadsheet becomes one CSV per sheet, and a Word document or PDF one text file: the chat reads them the same way,
 * and Lokal cannot write .xlsx, .docx, or PDF.
 */
export function maskedFiles(name: string, type: string, readable: Readable, masked: string[]): MaskedFile[] {
  const base = baseOf(name);
  if (readable.kind === 'text') return [{ name, type: type || 'text/plain', text: masked[0] ?? '' }];
  if (readable.kind === 'sheets') {
    const sheets = readable.parts.map((p, i) => ({ sheet: p.name, csv: masked[i] ?? '' })).filter((s) => s.csv.trim());
    return sheets.map(({ sheet, csv }) => ({
      name: sheets.length === 1 ? `${base}.csv` : `${base} - ${safeFileName(sheet)}.csv`,
      type: 'text/csv',
      text: csv,
    }));
  }
  const sections = readable.parts.map((p, i) => {
    const body = masked[i] ?? '';
    // The document text comes first, as it is; tables and pages get a heading.
    return readable.kind === 'docx' && i === 0 ? body : `--- ${p.name} ---\n${body}`;
  });
  return [{ name: `${base}.txt`, type: 'text/plain', text: `${sections.filter((s) => s.trim()).join('\n\n')}\n` }];
}
