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
    'anonymize_file', 'format_rupiah', 'list_holidays', 'list_wilayah', 'lookup_kode_pos', 'parse_alamat', 'parse_nik', 'parse_phone', 'parse_qris',
    'parse_rupiah', 'read_file_masked', 'scan_pii', 'search_wilayah', 'set_qris_amount', 'validate_npwp',
    'working_days', 'write_file_unmasked',
  ]);
  assert.match(client.getInstructions() ?? '', /read_file_masked/);
});

test('server HTTP untuk ChatGPT dan Claude.ai: tool data saja, tanpa akses file', async () => {
  const { startHttpServer } = await import('../src/server.ts');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const http = await startHttpServer(0);
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  try {
    const remote = new Client({ name: 'remote', version: '0.0.0' });
    await remote.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    const names = (await remote.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('parse_nik') && names.includes('parse_qris') && names.includes('search_wilayah'));
    for (const fileTool of ['scan_pii', 'read_file_masked', 'write_file_unmasked']) assert.ok(!names.includes(fileTool), fileTool);
    assert.doesNotMatch(remote.getInstructions() ?? '', /read_file_masked/);
    const res = (await remote.callTool({ name: 'parse_nik', arguments: { nik: '3201011508950001' } })) as { content: Array<{ text: string }> };
    assert.equal(JSON.parse(res.content[0]!.text).regency, 'Kabupaten Bogor');
    await remote.close();
    assert.equal((await fetch(`${url}/mcp`)).status, 405);
    assert.match(await (await fetch(url)).text(), /Lokal MCP server/);
  } finally {
    http.close();
  }
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

  // A made-up static QRIS: read it, then make it dynamic for Rp25.000 plus a 0.7% fee.
  const f = (tag: string, value: string) => tag + String(value.length).padStart(2, '0') + value;
  const fields = f('00', '01') + f('01', '11') + f('51', f('00', 'ID.CO.QRIS.WWW') + f('02', 'ID1026000000001') + f('03', 'UMI'))
    + f('52', '5812') + f('53', '360') + f('58', 'ID') + f('59', 'KOPI CONTOH') + f('60', 'BOGOR') + '6304';
  const crc = (await call('parse_qris', { payload: `${fields}0000` })).data;
  assert.equal(crc.valid, false);
  const expected = /seharusnya ([0-9A-F]{4})/.exec(crc.errors[0].message)![1];
  const read = (await call('parse_qris', { payload: fields + expected })).data;
  assert.deepEqual([read.valid, read.type, read.nmid, read.criteriaLabel], [true, 'static', 'ID1026000000001', 'Usaha Mikro']);
  const dynamic = (await call('set_qris_amount', { payload: fields + expected, amount: 25000, fee_percent: 0.7 })).data;
  assert.deepEqual([dynamic.type, dynamic.amount, dynamic.tip], ['dynamic', '25000', { kind: 'percent', value: '0.70' }]);
  assert.equal((await call('parse_qris', { payload: dynamic.payload })).data.valid, true);
  assert.equal((await call('set_qris_amount', { payload: fields + expected, amount: 0 })).isError, true);
});

test('kode pos, hari libur, dan hari kerja', async () => {
  const depok = await call('lookup_kode_pos', { kode_pos: '16431' });
  assert.ok(depok.data.some((w: any) => w.path.includes('Kota Depok')));
  assert.ok((await call('lookup_kode_pos', { wilayah_code: '32.76.01' })).data.postalCodes.includes('16436'));
  assert.equal((await call('lookup_kode_pos', {})).isError, true);
  const alamat = (await call('parse_alamat', { address: 'jl margonda raya no 100 rt 3/5 kemiri muka beji depok 16423' })).data;
  assert.equal(alamat.kelurahanDesa.code, '32.76.06.1004');
  assert.equal(alamat.confidence, 'high');
  assert.equal(alamat.rt, '003');
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
  assert.deepEqual(data.notScanned.files, ['ekspor/laporan.pdf (failed: unreadable PDF: No pages found)']);
  assert.deepEqual(data.notScanned.byStatus, { failed: 1, unsupported: 1 });
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

  // A placeholder the model made up is written as it is, and said so.
  const madeUp = await call('write_file_unmasked', { path: 'out/karangan.csv', content: '[NAME_1],[NIK_77]' });
  assert.deepEqual(madeUp.data.unknownPlaceholders, ['[NIK_77]']);
  assert.match(madeUp.data.warning, /1 placeholder\(s\) were not made in this session/);
  assert.equal(readFileSync(path.join(dir, 'out', 'karangan.csv'), 'utf8'), 'Budi Santoso,[NIK_77]');
});

test('read_file_masked: text in a file that looks like a placeholder', async () => {
  // A template that uses a number this session already gave out to a real person.
  writeFileSync(path.join(dir, 'template.txt'), 'Halo [NAME_1], tagihan kamu jatuh tempo.\nHalo [NAME_99], ini lain.\n');
  const read = await call('read_file_masked', { path: 'template.txt' });
  assert.match(read.text, /Note: the file itself contains \[NAME_1\], which this session also uses as placeholders/);
  assert.ok(!read.text.includes('[NAME_99], which'), 'a number nobody has yet is no clash');
});

test('tool data membaca placeholder dari read_file_masked tanpa membuka nilainya', async () => {
  writeFileSync(path.join(dir, 'alamat.csv'), 'id,alamat\n1,"Jl. Melati No. 5 RT 3/5, Kemiri Muka, Beji, Depok 16423"\n');
  const read = await call('read_file_masked', { path: 'alamat.csv' });
  const placeholder = /\[ADDRESS_\d+\]/.exec(read.text)?.[0];
  assert.ok(placeholder, read.text);

  const alamat = await call('parse_alamat', { address: placeholder });
  assert.equal(alamat.data.kelurahanDesa.code, '32.76.06.1004');
  assert.equal(alamat.data.input, placeholder);
  for (const secret of ['Melati', 'No. 5', 'RT 003', 'RW 005']) assert.ok(!alamat.text.includes(secret), `${secret} reached the model`);
  assert.match(alamat.data.street, /^\[ADDRESS_\d+\]$/);
  // RT and RW are placeholders for "RT 003" and "RW 005", so the address reads the same once restored.
  assert.match(alamat.data.formatted, /^\[ADDRESS_\d+\], \[ADDRESS_\d+\]\/\[ADDRESS_\d+\], Kelurahan Kemiri Muka/);

  // The agent writes the cleaned row with placeholders; the file on disk has the real street.
  const row = `${alamat.data.street},${alamat.data.rt},${alamat.data.kelurahanDesa.name},${alamat.data.kelurahanDesa.code}`;
  await call('write_file_unmasked', { path: 'out/alamat-rapi.csv', content: row });
  assert.equal(readFileSync(path.join(dir, 'out', 'alamat-rapi.csv'), 'utf8'), 'Jl. Melati No. 5,RT 003,Kemiri Muka,32.76.06.1004');

  const pelanggan = await call('read_file_masked', { path: 'pelanggan.csv' });
  const nik = /\[NIK_\d+\]/.exec(pelanggan.text)![0];
  const phone = /\[PHONE_\d+\]/.exec(pelanggan.text)![0];
  const parsedNik = await call('parse_nik', { nik });
  assert.equal(parsedNik.data.valid, true);
  assert.equal(parsedNik.data.regency, 'Kabupaten Bogor');
  assert.match(parsedNik.data.birthDate, /^\[BIRTH_DATE_\d+\]$/);
  assert.ok(!/1995|3201011508950001/.test(parsedNik.text), parsedNik.text);
  const parsedPhone = await call('parse_phone', { phone });
  assert.equal(parsedPhone.data.operator, 'Telkomsel');
  assert.ok(!/3456|7890/.test(parsedPhone.text), parsedPhone.text);
  assert.equal((await call('validate_npwp', { npwp: nik })).data.valid, true);
  // A placeholder this session never made is just text.
  assert.equal((await call('parse_alamat', { address: '[ADDRESS_99]' })).data.confidence, 'none');
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

test('guard untuk Cursor: selalu menjawab JSON dalam format Cursor', () => {
  const cursor = (event: object) => {
    const r = guard({ conversation_id: 'c1', workspace_roots: [dir], ...event });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const prompt = cursor({ hook_event_name: 'beforeSubmitPrompt', prompt: 'cek NIK 3201011508950001 dong' });
  assert.equal(prompt.continue, false);
  assert.match(prompt.user_message, /Samaran menahan prompt ini/);
  assert.deepEqual(cursor({ hook_event_name: 'beforeSubmitPrompt', prompt: 'bikin form checkout' }), { continue: true });

  const read = (file: string) => cursor({ hook_event_name: 'beforeReadFile', file_path: path.join(dir, file), content: '' });
  assert.equal(read('pelanggan.csv').permission, 'deny');
  assert.match(read('pelanggan.csv').user_message, /read_file_masked/);
  assert.deepEqual(read('README.md'), { permission: 'allow' });
  assert.deepEqual(Object.keys(read('pelanggan.csv')).sort(), ['permission', 'user_message'], 'only documented fields');
  const photo = read('ekspor/ktp.jpg');
  assert.equal(photo.permission, 'deny');
  assert.match(photo.user_message, /Cursor tidak bisa bertanya dulu/);

  const shell = (command: string) => cursor({ hook_event_name: 'beforeShellExecution', command, cwd: dir, sandbox: false });
  const cat = shell('cat pelanggan.csv');
  assert.equal(cat.permission, 'deny');
  assert.match(cat.agent_message, /read_file_masked/);
  assert.deepEqual(shell('ls'), { permission: 'allow' });
});

test('guard untuk Gemini CLI: exit code 2 untuk prompt dan tool yang ditahan', () => {
  const gemini = (event: object) => guard({ session_id: 's1', cwd: dir, timestamp: '2026-10-17T00:00:00Z', ...event });
  assert.equal(gemini({ hook_event_name: 'BeforeAgent', prompt: 'NIK 3201011508950001' }).status, 2);
  assert.equal(gemini({ hook_event_name: 'BeforeAgent', prompt: 'buat landing page' }).status, 0);
  const read = gemini({ hook_event_name: 'BeforeTool', tool_name: 'read_file', tool_input: { absolute_path: path.join(dir, 'pelanggan.csv') } });
  assert.equal(read.status, 2);
  assert.match(read.stderr, /read_file_masked/);
  assert.equal(gemini({ hook_event_name: 'BeforeTool', tool_name: 'run_shell_command', tool_input: { command: 'cat pelanggan.csv' } }).status, 2);
  assert.equal(gemini({ hook_event_name: 'BeforeTool', tool_name: 'write_file', tool_input: { file_path: 'x.txt' } }).status, 0);
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

test('guard SAMARAN_GUARD=strict: input rusak memblokir, kode inline yang membaca file data ditahan', () => {
  const strict = { SAMARAN_GUARD: 'strict' };
  const broken = spawnSync(process.execPath, [CLI, 'guard'], { input: 'bukan json', encoding: 'utf8', env: { ...process.env, ...strict } });
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /SAMARAN_GUARD=strict/);

  const sh = (command: string, env: Record<string, string>, tool = 'Bash') =>
    guard({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd: dir }, env).status;
  const inline = [
    `python3 -c "print(open('pelanggan.csv').read())"`,
    `node -e "console.log(require('fs').readFileSync('./pelanggan.csv', 'utf8'))"`,
    `python3 - <<'EOF'\nimport csv\nfor row in csv.reader(open("pelanggan.csv")): print(row)\nEOF`,
  ];
  for (const command of inline) {
    assert.equal(sh(command, {}), 0, `default: ${command}`);
    assert.equal(sh(command, strict), 2, `strict: ${command}`);
  }
  assert.equal(sh(`[IO.File]::ReadAllText('pelanggan.csv')`, strict, 'PowerShell'), 2);
  assert.equal(sh(`@'\nprint(open('pelanggan.csv').read())\n'@ | python -`, strict, 'PowerShell'), 2);
  // Still allowed in strict mode: scripts in files, output written to a file, code that names no data file.
  for (const command of [
    'node dedupe.js pelanggan.csv',
    `python3 -c "print(open('pelanggan.csv').read())" > salinan.csv`,
    `python3 -c "print(1 + 1)"`,
    `python3 -c "print(open('kode.ts').read())"`,
    "cat > dedupe.js <<'EOF'\nconst rows = require('fs').readFileSync('pelanggan.csv', 'utf8');\nEOF",
  ]) {
    assert.equal(sh(command, strict), 0, command);
  }
  assert.equal(sh('cat pelanggan.csv', strict), 2);
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
    'pdf/surat-keterangan.pdf (partial: page 2 of 3 has no text layer (scanned) and needs OCR)',
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

test('anonymize_file: dump produksi jadi data staging, konsisten antarfile, agent tidak melihat isinya', async () => {
  mkdirSync(path.join(dir, 'prod'), { recursive: true });
  writeFileSync(path.join(dir, 'prod', 'pelanggan.sql'), "INSERT INTO pelanggan (nama, nik, no_hp) VALUES ('Budi Santoso', '3201011508950001', '0812-3456-7890');\n");
  writeFileSync(path.join(dir, 'prod', 'kredit.csv'), 'nik,gaji\n3201011508950001,8500000\n');
  const res = await call('anonymize_file', { paths: ['prod/pelanggan.sql', 'prod/kredit.csv'], output: 'staging', secret: 'uji', keep: ['FINANCIAL'] });
  assert.equal(res.isError, undefined, res.text);
  assert.deepEqual(res.data.files.map((f: any) => f.to), ['staging/pelanggan.sql', 'staging/kredit.csv']);
  assert.deepEqual(res.data.files[0].replaced, { NAME: 1, NIK: 1, PHONE: 1 });
  assert.match(res.data.note, /samaranignore/);
  for (const secret of ['Budi Santoso', '3201011508950001', '3456-7890']) assert.ok(!res.text.includes(secret), secret);

  const sql = readFileSync(path.join(dir, 'staging', 'pelanggan.sql'), 'utf8');
  const csv = readFileSync(path.join(dir, 'staging', 'kredit.csv'), 'utf8');
  for (const secret of ['Budi Santoso', '3201011508950001', '3456-7890']) assert.ok(!sql.includes(secret) && !csv.includes(secret), secret);
  const nik = /'(\d{16})'/.exec(sql)![1]!;
  assert.equal(csv.split('\n')[1], `${nik},8500000`, 'the same customer in both files; FINANCIAL kept');

  const again = await call('anonymize_file', { paths: ['prod/kredit.csv'], output: 'staging/kredit.csv', secret: 'uji' });
  assert.match(again.text, /already exists/);
  assert.match((await call('anonymize_file', { paths: ['../luar.sql'], output: 'x.sql' })).text, /outside the allowed root/);
  assert.match((await call('anonymize_file', { paths: ['ekspor/pelanggan.xlsx'], output: 'x.xlsx' })).text, /not a text file/);

  // The same through the command line, with the same secret: the same stand-ins.
  const cli = spawnSync(process.execPath, [CLI, 'kembaran', path.join(dir, 'prod', 'kredit.csv'), '-o', path.join(dir, 'cli.csv'), '--secret', 'uji', '--keep', 'FINANCIAL'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /NIK=1/);
  assert.equal(readFileSync(path.join(dir, 'cli.csv'), 'utf8'), csv);
});
