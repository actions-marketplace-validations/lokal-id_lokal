import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { samples } from './pdf-builder.ts';

const CLI = path.resolve(import.meta.dirname, '../src/cli.ts');

const CSV = `nama,nik,hp,kota
Budi Santoso,3201011508950001,0812-3456-7890,Bogor
Siti Aminah,3276015508030002,+62 857 1111 2222,Depok
Budi Santoso,3201011508950001,081234567890,Bogor
`;

let dir: string;
let client: Client;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'lokal-mcp-'));
  writeFileSync(path.join(dir, 'pelanggan.csv'), CSV);
  mkdirSync(path.join(dir, 'test'));
  writeFileSync(path.join(dir, 'test', 'fixture.json'), '{"nik":"3201011508950001"}');
  writeFileSync(path.join(dir, 'README.md'), '# Tidak ada data pribadi di sini\n');
  writeFileSync(path.join(dir, 'kode.ts'), "test('nik', () => parseNik('3201011508950001'));\n");
  mkdirSync(path.join(dir, 'ekspor'));
  copyFileSync(path.join(import.meta.dirname, 'fixtures', 'pelanggan.xlsx'), path.join(dir, 'ekspor', 'pelanggan.xlsx'));
  writeFileSync(path.join(dir, 'ekspor', 'laporan.pdf'), '%PDF-1.4\n\0binary');
  writeFileSync(path.join(dir, 'ekspor', 'ktp.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  writeFileSync(path.join(dir, '.samaranignore'), 'test/\n');

  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [CLI],
      env: { ...process.env, LOKAL_ROOT: dir } as Record<string, string>,
    }),
  );
});

after(async () => {
  await client?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  const text = res.content[0]!.text;
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { text, data, isError: res.isError };
}

test('server mengiklankan semua tool beserta instruksinya', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'format_rupiah', 'list_holidays', 'list_wilayah', 'lookup_kode_pos', 'parse_nik', 'parse_phone',
    'parse_rupiah', 'read_file_masked', 'scan_pii', 'search_wilayah', 'validate_npwp', 'working_days',
    'write_file_unmasked',
  ]);
  assert.match(client.getInstructions() ?? '', /read_file_masked/);
});

test('tool data Indonesia', async () => {
  const nik = await call('parse_nik', { nik: '3201011508950001' });
  assert.equal(nik.data.regency, 'Kabupaten Bogor');
  assert.equal((await call('parse_rupiah', { text: 'sejuta setengah' })).data.amount, 1500000);
  assert.equal((await call('format_rupiah', { amount: 1500000 })).data.terbilang, 'satu juta lima ratus ribu rupiah');
  assert.equal((await call('parse_phone', { phone: '0812 3456 7890' })).data.operator, 'Telkomsel');
  assert.equal((await call('search_wilayah', { query: 'depok' })).data[0].code, '32.76');
  assert.equal((await call('list_wilayah')).data.length, 38);
  assert.equal((await call('list_wilayah', { parent_code: '99' })).isError, true);
});

test('kode pos, hari libur, dan hari kerja', async () => {
  const depok = await call('lookup_kode_pos', { kode_pos: '16431' });
  assert.ok(depok.data.some((w: any) => w.path.includes('Kota Depok')));
  assert.ok((await call('lookup_kode_pos', { wilayah_code: '32.76.01' })).data.postalCodes.includes('16436'));
  assert.equal((await call('lookup_kode_pos', {})).isError, true);
  const villages = (await call('list_wilayah', { parent_code: '32.76.01' })).data;
  assert.ok(villages.every((v: any) => /^\d{5}$/.test(v.postalCode)));

  const h2027 = (await call('list_holidays', { year: 2027 })).data;
  assert.equal(h2027.holidays.length, 26);
  assert.match(h2027.source, /setneg/);
  assert.match((await call('list_holidays', { year: 2030 })).text, /belum tersedia/);
  assert.equal((await call('working_days', { from: '2026-03-17', add: 1 })).data.result, '2026-03-25');
  assert.equal((await call('working_days', { from: '2026-08-17' })).data.workingDay, false);
});

test('scan_pii melapor tanpa membocorkan nilai, menghormati .samaranignore', async () => {
  const { data, text } = await call('scan_pii', { path: '.' });
  assert.equal(data.filesWithPii, 3, 'pelanggan.csv, kode.ts, ekspor/pelanggan.xlsx');
  assert.equal(data.filesIgnored, 1);
  assert.equal(data.totals.NIK, 7);
  assert.equal(data.totals.RELIGION, 3, 'agama column in the xlsx');
  assert.equal(data.totals.HEALTH, 2, 'diagnosa and gol_darah in the Medis sheet');
  assert.ok(data.dataPribadiSpesifik >= 5, 'health + salary');
  assert.ok(data.findings.some((f: any) => f.sheet === 'Medis' && f.uuPdp === 'spesifik'));
  assert.ok(!text.includes('3201011508950001'));
  assert.ok(!text.includes('3456-7890'));
  assert.ok(!text.includes('Asma'));
});

test('scan_pii tidak pernah diam soal file yang tidak bisa dipindai', async () => {
  const { data } = await call('scan_pii', { path: 'ekspor' });
  assert.equal(data.notScanned.count, 2);
  assert.deepEqual(data.notScanned.files, ['ekspor/laporan.pdf (unreadable PDF: No pages found)']);
  assert.match(data.warning, /NOT scanned/);
});

test('read_file_masked membaca Excel per sheet', async () => {
  const { text } = await call('read_file_masked', { path: 'ekspor/pelanggan.xlsx' });
  assert.match(text, /2 sheets, as CSV/);
  assert.match(text, /=== Sheet: Medis/);
  for (const secret of ['Budi', 'Siti', '3201011508950001', 'Islam', 'Asma', '8000000']) {
    assert.ok(!text.includes(secret), `${secret} leaked`);
  }
  assert.match(text, /\[RELIGION_1\]/);
  assert.equal((await call('read_file_masked', { path: 'ekspor/laporan.pdf' })).isError, true);
});

test('read_file_masked → olah → write_file_unmasked (round trip)', async () => {
  const read = await call('read_file_masked', { path: 'pelanggan.csv' });
  assert.ok(!read.text.includes('3201011508950001'));
  assert.ok(!read.text.includes('Budi'));
  // Same person on rows 1 and 3, written differently, gets the same placeholders: dedup still works.
  const rows = read.text.split('\n').slice(4);
  assert.deepEqual(rows.slice(0, 3), [
    '[NAME_1],[NIK_1],[PHONE_1],Bogor',
    '[NAME_2],[NIK_2],[PHONE_2],Depok',
    '[NAME_1],[NIK_1],[PHONE_1],Bogor',
  ]);

  // The agent writes a deduplicated file using only placeholders.
  const deduped = [rows[0], rows[1]].join('\n');
  const write = await call('write_file_unmasked', { path: 'out/unik.csv', content: deduped });
  assert.equal(write.data.restored, 6);
  const written = readFileSync(path.join(dir, 'out', 'unik.csv'), 'utf8');
  assert.match(written, /3201011508950001/);
  assert.match(written, /3276015508030002/);

  const again = await call('write_file_unmasked', { path: 'out/unik.csv', content: 'x' });
  assert.equal(again.isError, true, 'refuses to overwrite without overwrite: true');
});

test('path di luar root ditolak', async () => {
  const res = await call('read_file_masked', { path: '../../etc/passwd' });
  assert.equal(res.isError, true);
  assert.match(res.text, /outside the allowed root/);
});

function guard(event: object, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, 'guard'], {
    input: JSON.stringify(event),
    env: { ...process.env, ...env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  });
}

test('guard: prompt berisi NIK ditahan, #izinkan-pii meloloskan', () => {
  const blocked = guard({ hook_event_name: 'UserPromptSubmit', prompt: 'cek NIK 3201011508950001 dong' });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /NIK×1 \(3201\*{8}0001\)/);
  assert.ok(!blocked.stderr.includes('3201011508950001'));

  const kk = guard({ hook_event_name: 'UserPromptSubmit', prompt: 'ini KK 3201010101200001 sama paspor A1234567' });
  assert.equal(kk.status, 2);
  assert.match(kk.stderr, /KK×1.*PASSPORT×1/);
  const health = guard({ hook_event_name: 'UserPromptSubmit', prompt: 'pelanggan ini didiagnosis TBC, bantu balas' });
  assert.equal(health.status, 2);
  const ok = guard({ hook_event_name: 'UserPromptSubmit', prompt: 'cek NIK 3201011508950001 #izinkan-pii' });
  assert.equal(ok.status, 0);
  assert.equal(guard({ hook_event_name: 'UserPromptSubmit', prompt: 'bikin form checkout' }).status, 0);
});

test('guard: Read file data pelanggan diarahkan ke read_file_masked', () => {
  const read = (file: string) =>
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: file }, cwd: dir });
  const blocked = read(path.join(dir, 'pelanggan.csv'));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /read_file_masked/);
  assert.equal(read(path.join(dir, 'README.md')).status, 0);
  assert.equal(read(path.join(dir, 'kode.ts')).status, 0, 'source code is never blocked');
  assert.equal(read(path.join(dir, 'test', 'fixture.json')).status, 0, '.samaranignore');
  assert.equal(read(path.join(dir, 'tidak-ada.txt')).status, 0);
  assert.equal(read(path.join(dir, 'ekspor', 'pelanggan.xlsx')).status, 2, 'spreadsheets are guarded too');
});

test('guard: foto dokumen dan PDF yang tidak terbaca ditanyakan dulu ke pengguna', () => {
  const read = (file: string) =>
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: file }, cwd: dir });
  const decision = (r: ReturnType<typeof read>) =>
    r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : undefined;
  const files: Record<string, Buffer | string> = {
    'var/media/kredit/ktp-budi.jpg': Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    'storage/app/uploads/IMG_2041.HEIC': 'x',
    'arsip/selfie_siti.png': 'x',
    'src/assets/logo.png': 'x',
    'public/images/hero.webp': 'x',
    'media/brand/icons/menu.png': 'x',
    'contoh/ktp-dummy.jpg': 'x',
    'scan/terkunci.pdf': samples().encrypted!,
    'scan/lampiran.pdf': samples().scanned!,
  };
  for (const [name, data] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), data);
  }
  writeFileSync(path.join(dir, '.samaranignore'), 'test/\ncontoh/\n');

  for (const name of ['var/media/kredit/ktp-budi.jpg', 'storage/app/uploads/IMG_2041.HEIC', 'arsip/selfie_siti.png', 'ekspor/ktp.jpg']) {
    const r = read(path.join(dir, name));
    assert.equal(r.status, 0, name);
    const d = decision(r);
    assert.equal(d?.hookEventName, 'PreToolUse', name);
    assert.equal(d?.permissionDecision, 'ask', name);
    assert.match(d.permissionDecisionReason, /foto KTP atau dokumen pribadi/);
  }
  // The app's own images, files listed in .samaranignore, and files that do not exist are not asked about.
  for (const name of ['src/assets/logo.png', 'public/images/hero.webp', 'media/brand/icons/menu.png', 'contoh/ktp-dummy.jpg', 'ktp/tidak-ada.jpg']) {
    const r = read(path.join(dir, name));
    assert.equal(r.status, 0, name);
    assert.equal(decision(r), undefined, name);
  }
  // PDFs Samaran cannot fully read; the one whose text has personal data is blocked instead.
  assert.match(decision(read(path.join(dir, 'scan/terkunci.pdf'))).permissionDecisionReason, /encrypted PDF/);
  assert.match(decision(read(path.join(dir, 'scan/lampiran.pdf'))).permissionDecisionReason, /pages 2-3 of 3 have no text layer/);
  assert.match(decision(read(path.join(dir, 'ekspor/laporan.pdf'))).permissionDecisionReason, /unreadable PDF/);
  writeFileSync(path.join(dir, '.samaranignore'), 'test/\n');
});

test('guard: Bash/PowerShell yang mencetak file data ditahan, skrip pengolah diloloskan', () => {
  const sh = (command: string, tool = 'Bash') =>
    guard({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd: dir }).status;
  // Printing the data into the conversation.
  for (const command of [
    'cat pelanggan.csv',
    'head -5 pelanggan.csv',
    'tail -n 2 ./pelanggan.csv',
    'cat *.csv | sort | uniq',
    'grep Budi pelanggan.csv',
    'sed -n 2,3p pelanggan.csv',
    'cd sub && cat pelanggan.csv; cat "pelanggan.csv"',
    'awk -F, \'{print $2}\' pelanggan.csv',
    'cut -d, -f1 pelanggan.csv',
    'cat /' + dir.replace(/^([A-Za-z]):[\\/]/, (_, d: string) => `${d.toLowerCase()}/`).replace(/\\/g, '/') + '/pelanggan.csv',
  ]) {
    assert.equal(sh(command), 2, command);
  }
  for (const command of [
    'Get-Content .\\pelanggan.csv',
    'Get-Content pelanggan.csv -TotalCount 3',
    'Import-Csv pelanggan.csv | Select-Object -First 2',
    'Select-String -Path pelanggan.csv -Pattern Budi',
  ]) {
    assert.equal(sh(command, 'PowerShell'), 2, command);
  }
  // Looking at the shape, counting, or processing without printing.
  for (const command of [
    'head -1 pelanggan.csv',
    'cut -d, -f4 pelanggan.csv | sort | uniq -c',
    'grep -o "Bogor\\|Depok" pelanggan.csv | sort | uniq -c',
    'wc -l pelanggan.csv',
    'grep -c Budi pelanggan.csv',
    'grep Jakarta pelanggan.csv',
    'node dedupe.js pelanggan.csv',
    'python3 clean.py pelanggan.csv > bersih.csv',
    'sort pelanggan.csv > urut.csv',
    'cat pelanggan.csv | node dedupe.js',
    'cat kode.ts',
    'cat test/fixture.json',
    "cat > dedupe.js <<'EOF'\nconst rows = require('fs').readFileSync('pelanggan.csv', 'utf8');\ncat pelanggan.csv\nEOF",
    'ls -la',
  ]) {
    assert.equal(sh(command), 0, command);
  }
  assert.equal(sh('Get-Content pelanggan.csv -TotalCount 1', 'PowerShell'), 0);
  assert.equal(sh('Import-Csv pelanggan.csv | Measure-Object', 'PowerShell'), 0);
  const blocked = guard({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat pelanggan.csv' }, cwd: dir });
  assert.match(blocked.stderr, /pelanggan\.csv.*read_file_masked/);
  assert.ok(!blocked.stderr.includes('3201011508950001'));
});

test('guard: Grep isi file data ditahan, pencarian kode dan daftar file diloloskan', () => {
  const grep = (input: object) =>
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: input, cwd: dir }).status;
  assert.equal(grep({ pattern: 'Budi', output_mode: 'content' }), 2);
  assert.equal(grep({ pattern: 'Budi', path: 'pelanggan.csv', output_mode: 'content' }), 2);
  assert.equal(grep({ pattern: 'budi', output_mode: 'content', glob: '*.{csv,json}', '-i': true }), 2);
  assert.equal(grep({ pattern: 'Budi' }), 0, 'files_with_matches is the default');
  assert.equal(grep({ pattern: 'Budi', output_mode: 'count' }), 0);
  assert.equal(grep({ pattern: 'Jakarta', output_mode: 'content' }), 0, 'no matching line, nothing shown');
  assert.equal(grep({ pattern: 'parseNik', output_mode: 'content', type: 'ts' }), 0);
  assert.equal(grep({ pattern: 'nik', output_mode: 'content', glob: '*.ts' }), 0);
  assert.equal(grep({ pattern: 'nik', path: 'test', output_mode: 'content' }), 0, '.samaranignore');
});

test('guard: input rusak tidak pernah memblokir', () => {
  const res = spawnSync(process.execPath, [CLI, 'guard'], { input: 'bukan json', encoding: 'utf8' });
  assert.equal(res.status, 0);
});

test('Word: teks, header, dan tabel dipindai dan disamarkan', async () => {
  mkdirSync(path.join(dir, 'dokumen'), { recursive: true });
  copyFileSync(path.join(import.meta.dirname, 'fixtures', 'surat.docx'), path.join(dir, 'dokumen', 'surat.docx'));
  const scan = await call('scan_pii', { path: 'dokumen' });
  assert.equal(scan.data.filesWithPii, 1);
  assert.equal(scan.data.totals.NIK, 2);
  assert.equal(scan.data.totals.NAME, 2, 'Siti Aminah in the text, Budi Santoso in the table');
  assert.equal(scan.data.totals.HEALTH, 1);
  assert.equal(scan.data.notScanned, undefined);

  const read = await call('read_file_masked', { path: 'dokumen/surat.docx' });
  assert.match(read.text, /Word document: text and 1 table/);
  assert.match(read.text, /=== Part: Tabel 1 /);
  assert.match(read.text, /Nama,NIK,HP\n\[NAME_\d\],\[NIK_\d\],\[PHONE_1\]/);
  for (const secret of ['Siti Aminah', 'Budi Santoso', '3276015508030002', '0812-3456-7890', 'Margonda Raya No. 45']) {
    assert.ok(!read.text.includes(secret), secret);
  }
});

test('file data di atas 5 MB dipindai, dan guard memeriksa awalnya alih-alih meloloskannya', async () => {
  mkdirSync(path.join(dir, 'besar'), { recursive: true });
  const row = 'Budi Santoso,3201011508950001,0812-3456-7890,Bogor\n';
  writeFileSync(path.join(dir, 'besar', 'ekspor.csv'), `nama,nik,hp,kota\n${row.repeat(Math.ceil((6 * 1024 * 1024) / row.length))}`);

  const scan = await call('scan_pii', { path: 'besar' });
  assert.equal(scan.data.filesWithPii, 1);
  assert.equal(scan.data.notScanned, undefined);

  const started = Date.now();
  const read = guard({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'besar', 'ekspor.csv') }, cwd: dir });
  assert.equal(read.status, 2, read.stderr);
  assert.ok(Date.now() - started < 8000, 'well inside the 10 s hook timeout');
  const shell = (command: string) =>
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: dir }).status;
  assert.equal(shell('cat besar/ekspor.csv'), 2); // once crashed on a 240k-element spread and let it through
  assert.equal(shell('wc -l besar/ekspor.csv'), 0);

  // Unique values: checking each against a large output with includes() was quadratic.
  const rows = Array.from({ length: 60000 }, (_, i) => `Pelanggan ${i},32010115089${String(10000 + i).slice(-5)},Bogor`);
  writeFileSync(path.join(dir, 'besar', 'unik.csv'), `nama,nik,kota\n${rows.join('\n')}\n`);
  const t0 = Date.now();
  assert.equal(shell('cut -d, -f2 besar/unik.csv'), 2);
  assert.equal(shell('grep Bogor besar/unik.csv'), 2);
  assert.equal(shell('head -1 besar/unik.csv'), 0);
  assert.ok(Date.now() - t0 < 12000, `${Date.now() - t0} ms for three hook runs`);
});

test('PDF: teks dipindai dan disamarkan, halaman hasil scan dilaporkan, guard menahan Read', async () => {
  mkdirSync(path.join(dir, 'pdf'), { recursive: true });
  for (const f of ['invoice.pdf', 'surat-keterangan.pdf']) copyFileSync(path.join(import.meta.dirname, 'fixtures', f), path.join(dir, 'pdf', f));
  const scan = await call('scan_pii', { path: 'pdf' });
  assert.equal(scan.data.filesScanned, 2);
  assert.equal(scan.data.filesWithPii, 2);
  assert.equal(scan.data.totals.NIK, 4);
  assert.ok(scan.data.findings.some((f: any) => f.file === 'pdf/invoice.pdf' && f.sheet === 'Halaman 1' && f.type === 'NAME'));
  assert.deepEqual(scan.data.notScanned.files, [
    'pdf/surat-keterangan.pdf (partly scanned: page 2 of 3 has no text layer (scanned) and needs OCR)',
  ]);
  for (const secret of ['3201011508950001', 'Budi Santoso', 'Rina Wati', '0812-3456-7890']) assert.ok(!scan.text.includes(secret), secret);

  const invoice = await call('read_file_masked', { path: 'pdf/invoice.pdf' });
  assert.match(invoice.text, /\(PDF: 1 page with text\)/);
  assert.match(invoice.text, /=== Page: Halaman 1 \(lines 1-\d+ of \d+\) ===/);
  assert.match(invoice.text, /Nama Pelanggan\t\[NAME_\d\]\nNIK\t\[NIK_\d\]/);
  for (const secret of ['Budi Santoso', 'Siti Aminah', 'Rina Wati', 'Hendra Gunawan', '3276014503920002', '0857-1111-2222', 'budi.santoso@gmail.com', 'diabetes']) {
    assert.ok(!invoice.text.includes(secret), `${secret} leaked`);
  }
  const surat = await call('read_file_masked', { path: 'pdf/surat-keterangan.pdf' });
  assert.match(surat.text, /Not read: page 2 of 3 has no text layer/);
  assert.match(surat.text, /=== Page: Halaman 3 /);
  assert.ok(!surat.text.includes('Dewi Lestari'));

  const read = (file: string) =>
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'pdf', file) }, cwd: dir });
  const blocked = read('invoice.pdf');
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(blocked.stderr, /read_file_masked/);
  assert.ok(!blocked.stderr.includes('3201011508950001'));
  assert.equal(read('surat-keterangan.pdf').status, 2);
  const shell = (command: string) =>
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: dir }).status;
  assert.equal(shell('pdftotext -layout pdf/invoice.pdf -'), 2, 'prints the text');
  assert.equal(shell('pdftotext pdf/invoice.pdf - | head -20'), 2);
  assert.equal(shell('pdftotext pdf/invoice.pdf invoice.txt'), 0, 'writes a file instead');
  assert.equal(shell('pdfinfo pdf/invoice.pdf'), 0);
});
