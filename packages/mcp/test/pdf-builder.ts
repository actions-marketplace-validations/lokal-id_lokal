// Hand-built PDFs for the structures real generators use. pdf.test.ts checks what Lokal reads from them, and
// python/scripts/gen_vectors.mjs turns them into parity vectors for the Python port. All personal data is made up.
import { deflateSync } from 'node:zlib';

export const latin1 = (s: string) => Buffer.from(s, 'latin1');
const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

/** A PDF with a classic xref table; object i + 1 is objects[i]. */
export function pdf(objects: Array<string | Buffer>, trailer = '/Root 1 0 R', version = '1.7'): Buffer {
  const parts: Buffer[] = [latin1(`%PDF-${version}\n%\xe2\xe3\xcf\xd3\n`)];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([latin1(`${i + 1} 0 obj\n`), typeof body === 'string' ? latin1(body) : body, latin1('\nendobj\n')]);
    parts.push(chunk);
    length += chunk.length;
  });
  const table = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(latin1(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}

export function stream(data: string | Buffer, dict = ''): Buffer {
  const bytes = typeof data === 'string' ? latin1(data) : data;
  return Buffer.concat([latin1(`<< /Length ${bytes.length} ${dict} >>\nstream\n`), bytes, latin1('\nendstream')]);
}
export const flate = (data: string, dict = '') => stream(deflateSync(latin1(data)), `/Filter /FlateDecode ${dict}`);

/** Catalog (1), page tree (2), font F1 (3), then a page and its content per entry, then `extra` objects. */
export function document(contents: string[], options: { font?: string; resources?: string; extra?: Array<string | Buffer> } = {}): Buffer {
  const kids = contents.map((_, i) => `${4 + 2 * i} 0 R`).join(' ');
  const objects: Array<string | Buffer> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${contents.length} >>`,
    options.font ?? HELVETICA,
  ];
  contents.forEach((content, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> ${options.resources ?? ''} >> /Contents ${5 + 2 * i} 0 R >>`);
    objects.push(flate(content));
  });
  return pdf([...objects, ...(options.extra ?? [])]);
}

export function ascii85(bytes: Buffer): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = [...bytes.subarray(i, i + 4)];
    const size = chunk.length;
    while (chunk.length < 4) chunk.push(0);
    let n = ((chunk[0]! << 24) | (chunk[1]! << 16) | (chunk[2]! << 8) | chunk[3]!) >>> 0;
    if (n === 0 && size === 4) {
      out += 'z';
      continue;
    }
    const digits: string[] = [];
    for (let d = 0; d < 5; d++) {
      digits.unshift(String.fromCharCode((n % 85) + 33));
      n = Math.floor(n / 85);
    }
    out += digits.slice(0, size + 1).join('');
  }
  return `${out}~>`;
}

function objectStream(): Buffer {
  const inner = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>',
  ];
  let body = '';
  const offsets: number[] = [];
  for (const o of inner) {
    offsets.push(body.length);
    body += `${o}\n`;
  }
  const header = inner.map((_, i) => `${i + 1} ${offsets[i]}`).join(' ') + '\n';
  return Buffer.concat([
    latin1('%PDF-1.5\n'),
    latin1('4 0 obj\n'), flate('BT /F1 12 Tf 72 760 Td (Nama: Lama) Tj ET'), latin1('\nendobj\n'),
    latin1('5 0 obj\n'), flate(header + body, `/Type /ObjStm /N 3 /First ${header.length}`), latin1('\nendobj\n'),
    latin1('6 0 obj\n'), stream('', '/Type /XRef /Size 7 /Root 1 0 R /W [1 2 1]'), latin1('\nendobj\nstartxref\n0\n%%EOF\n'),
    // An incremental update replaces the page content.
    latin1('4 0 obj\n'), flate('BT /F1 12 Tf 72 760 Td (Pasien: Siti Aminah) Tj ET'), latin1('\nendobj\n'),
    latin1('7 0 obj\n'), stream('', '/Type /XRef /Size 8 /Root 1 0 R /Prev 0 /W [1 2 1]'), latin1('\nendobj\nstartxref\n0\n%%EOF\n'),
  ]);
}

function annotations(): Buffer {
  const utf16 = (s: string) => `<FEFF${[...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>`;
  const file = document(['BT /F1 12 Tf 72 800 Td (FORMULIR PENGAJUAN KREDIT) Tj ET'], {
    extra: [
      '[7 0 R 8 0 R 9 0 R 10 0 R 11 0 R 12 0 R 13 0 R]',
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (nama_pemohon) /V (Budi Santoso) /Rect [72 700 300 720] >>',
      // A field whose name comes from its parent: "pemohon.nik".
      '<< /Type /Annot /Subtype /Widget /Parent 14 0 R /T (nik) /V (3201011508950001) /Rect [72 670 300 690] >>',
      `<< /Type /Annot /Subtype /Widget /FT /Tx /T (alamat) /V ${utf16('Jl. Mawar No. 5\nCibinong')} /Rect [72 640 300 660] >>`,
      '<< /Type /Annot /Subtype /Widget /FT /Btn /T (setuju) /V /Off /Rect [72 610 90 628] >>',
      '<< /Type /Annot /Subtype /Text /Contents (Cek ulang HP pemohon 0812-3456-7890) /Rect [400 700 420 720] /Popup 13 0 R >>',
      '<< /Type /Annot /Subtype /FreeText /Rect [300 500 500 530] /AP << /N 15 0 R >> /Contents (Agama: Islam) >>',
      '<< /Type /Annot /Subtype /Popup /Rect [400 600 600 700] /Contents (tidak dibaca) >>',
      '<< /T (pemohon) /Kids [8 0 R] /FT /Tx >>',
      flate('BT /F1 10 Tf 2 2 Td (Agama: Islam) Tj ET', '/Type /XObject /Subtype /Form /BBox [0 0 200 30] /Resources << /Font << /F1 3 0 R >> >>'),
    ],
  });
  // Point the page at the annotation array (object 6).
  return latin1(file.toString('latin1').replace('/Contents 5 0 R >>', '/Contents 5 0 R /Annots 6 0 R >>'));
}

const TYPE0_CMAP = [
  '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
  '1 begincodespacerange <0000> <FFFF> endcodespacerange',
  '2 beginbfchar <0001> <0042> <0002> <0075> endbfchar',
  '2 beginbfrange <0003> <0004> <0064> <0005> <0006> [<0069> <00200053>] endbfrange',
  'endcmap CMapName currentdict /CMap defineresource pop end end',
].join('\n');

/** Every sample, by name. */
export function samples(): Record<string, Buffer> {
  const cut = document(['BT /F1 12 Tf 72 760 Td (NIK 3201011508950001) Tj ET']);
  return {
    standard: document([
      'BT /F1 12 Tf 72 760 Td (Nama: Budi Santoso) Tj 0 -16 Td (NIK: 3201011508950001) Tj ET\n' +
        // A small gap is a space, a column-wide one a tab.
        'BT /F1 12 Tf 72 700 Td (Agama:) Tj 40 0 Td (Islam) Tj 60 0 Td (Kawin) Tj ET\n' +
        // Kerning inside a word, a word gap, an escaped bracket, octal for WinAnsi 0xE9, a line continuation.
        'BT /F1 12 Tf 72 680 Td [(Bu) 20 (di) -300 (Santoso)] TJ 0 -14 Td (Rp1.250.000 \\(lunas\\) caf\\351 ok\\\nsip) Tj ET',
    ]),
    differences: document(['BT /F1 12 Tf 72 760 Td (\\001\\002\\003\\002\\004\\005\\006\\007\\010 \\011\\012\\013) Tj ET'], {
      font:
        '<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Custom /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding ' +
        '/Differences [1 /N /a /m /space /S /i /t /uni00ED /eacute /one /zero] >> >>',
    }),
    type0: document(['BT /F1 10 Tf 1 0 0 1 72 760 Tm <000100020003000500060004> Tj ET'], {
      font: '<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Arial /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
      extra: [
        '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+Arial /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /W [1 [600 550] 3 6 500] >>',
        flate(TYPE0_CMAP),
      ],
    }),
    // A one-byte font whose ToUnicode map declares a two-byte code space, as Acrobat writes them.
    toUnicodeOneByte: document(['BT /F1 12 Tf 72 760 Td (Nama) Tj ET'], {
      font: '<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Calibri /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /ToUnicode 6 0 R >>',
      extra: [flate('begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 3 beginbfchar <4E> <004E> <61> <0061> <6D> <006D> endbfchar endcmap')],
    }),
    objectStream: objectStream(),
    formXObject: document(
      [
        'q 1 0 0 1 0 0 cm /Fm1 Do Q\n' +
          'BI /W 4 /H 1 /BPC 8 /CS /G ID \x00(Tj) Tj\xff EI\n' +
          'BT /F1 12 Tf 72 600 Td (HP 0812-3456-7890) Tj ET',
      ],
      {
        resources: '/XObject << /Fm1 6 0 R >>',
        extra: [flate('BT /F1 12 Tf 72 760 Td (Pasien: Siti Aminah) Tj ET', '/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >>')],
      },
    ),
    ascii85: pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
      HELVETICA,
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
      stream(ascii85(deflateSync(latin1('BT /F1 12 Tf 72 760 Td (NIK 3201011508950001) Tj ET'))), '/Filter [/ASCII85Decode /FlateDecode]'),
    ]),
    rawDeflate: pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
      HELVETICA,
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
      stream(deflateSync(latin1('BT /F1 12 Tf 72 760 Td (Nama: Rina Wati) Tj ET')).subarray(2), '/Filter /FlateDecode'),
    ]),
    scanned: document(['BT /F1 12 Tf 72 760 Td (Nama: Budi Santoso) Tj ET', 'q 595 0 0 842 0 0 cm /Im1 Do Q', 'q 595 0 0 842 0 0 cm /Im1 Do Q']),
    // Page 2's content does not decompress, page 3's is missing: damaged, not scanned.
    damagedPages: pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
      HELVETICA,
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
      flate('BT /F1 12 Tf 72 760 Td (Nama: Budi Santoso) Tj ET'),
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>',
      stream('this is not deflate data', '/Filter /FlateDecode'),
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 99 0 R >>',
    ]),
    encrypted: pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'], '/Root 1 0 R /Encrypt << /Filter /Standard /V 2 >>'),
    noPages: latin1('%PDF-1.4\n\0binary'),
    notPdf: latin1('bukan pdf'),
    // No xref and no trailer (a cut-off download).
    cutOff: cut.subarray(0, cut.indexOf('xref')),
    // Nesting meant to overflow the stack, after readable text.
    hostile: document(['BT /F1 12 Tf 72 760 Td (HP 0812-3456-7890) Tj ET\n' + '['.repeat(100000)]),
    annotations: annotations(),
  };
}
