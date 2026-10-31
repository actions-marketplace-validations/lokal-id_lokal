import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { dataReadsInCommand, inlineCodeReads } from '../src/shell-reads.ts';

const CLI = path.resolve(import.meta.dirname, '../src/cli.ts');
// Made-up people: no NIK here belongs to anyone.
const CSV = 'nama,nik\nBudi Santoso,3201011508950001\nSiti Aminah,3276015508030002\n';

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-shell-'));
  mkdirSync(path.join(dir, 'data', 'arsip'), { recursive: true });
  writeFileSync(path.join(dir, 'data', 'pelanggan.csv'), CSV);
  writeFileSync(path.join(dir, 'data', 'arsip', 'lama.csv'), CSV);
  writeFileSync(path.join(dir, 'laporan.py'), "import csv\nfor row in csv.reader(open('data/pelanggan.csv')):\n    print(row)\n");
  writeFileSync(path.join(dir, 'olah.py'), 'import sys\nrows = open(sys.argv[1]).read()\nprint(len(rows))\n');
  writeFileSync(path.join(dir, 'lihat.sh'), 'cd data\ncat pelanggan.csv\n');
  return dir;
}

const files = (reads: { file: string }[], dir: string) => [...new Set(reads.map((r) => path.relative(dir, r.file).replace(/\\/g, '/')))].sort();

test('shell: folder yang dimasuki dengan cd ikut dilacak', () => {
  const dir = project();
  try {
    for (const command of [
      'cd data && cat pelanggan.csv',
      'cd data; cat pelanggan.csv',
      '(cd data && cat pelanggan.csv)',
      '( cd data && cat pelanggan.csv )',
      '{ cd data; cat pelanggan.csv; }',
      'pushd data && head -5 pelanggan.csv && popd',
      'cd ./data/ && grep Budi pelanggan.csv',
      'cd data && cd arsip && cat ../pelanggan.csv',
    ]) {
      assert.deepEqual(files(dataReadsInCommand(command, dir), dir), ['data/pelanggan.csv'], command);
    }
    assert.deepEqual(files(dataReadsInCommand('Set-Location data; Get-Content pelanggan.csv', dir, true), dir), ['data/pelanggan.csv']);
    assert.deepEqual(files(dataReadsInCommand('cd data\\arsip; gc lama.csv', dir, true), dir), ['data/arsip/lama.csv']);
    // A subshell goes back: the file may be in either folder.
    assert.deepEqual(files(dataReadsInCommand('(cd data/arsip && ls); cat data/pelanggan.csv', dir), dir), ['data/pelanggan.csv']);
    assert.deepEqual(files(dataReadsInCommand('cd data && wc -l pelanggan.csv', dir), dir), [], 'a count');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell: pembaca lain, variabel, salinan, xargs, loop, dan shell di dalam shell', () => {
  const dir = project();
  try {
    for (const command of [
      'diff data/pelanggan.csv data/arsip/lama.csv',
      'base64 data/pelanggan.csv',
      "perl -pe 's/,/;/g' data/pelanggan.csv",
      "perl -ne 'print if /Budi/' data/pelanggan.csv",
      'sqlite3 :memory: ".import --csv data/pelanggan.csv p" "select * from p"',
      `curl -s file://${path.join(dir, 'data', 'pelanggan.csv').replace(/\\/g, '/')}`,
      'echo data/pelanggan.csv | xargs cat',
      'ls data/*.csv | xargs -n 1 head -3',
      'find data -name "*.csv" | xargs cat',
      'cp data/pelanggan.csv /tmp/x.txt && cat /tmp/x.txt',
      'cp data/pelanggan.csv salinan && cat salinan',
      'mv data/pelanggan.csv b.bak; cat b.bak',
      'head -3 data/pelanggan.csv > potong; cat potong',
      'while read baris; do echo "$baris"; done < data/pelanggan.csv',
      'cat data/pelanggan.csv | while read baris; do echo "$baris"; done',
      'F=data/pelanggan.csv; cat "$F"',
      'export F=data/pelanggan.csv && head ${F}',
      'D=data; cat $D/pelanggan.csv',
      'for f in data/*.csv; do cat "$f"; done',
      'echo "$(cat data/pelanggan.csv)"',
      'echo `cat data/pelanggan.csv`',
      'bash -c "cat data/pelanggan.csv"',
      "sh -c 'cd data && cat pelanggan.csv'",
      'bash lihat.sh',
      'source lihat.sh',
      'python3 -m json.tool data/pelanggan.csv',
    ]) {
      assert.ok(files(dataReadsInCommand(command, dir), dir).length > 0, command);
    }
    for (const command of ['$f = "data/pelanggan.csv"; Get-Content $f', "$f='data/pelanggan.csv'; gc $f", '$rows = Import-Csv data/pelanggan.csv; $rows', 'cmd /c type data\\pelanggan.csv', 'Copy-Item data/pelanggan.csv -Destination x.txt; gc x.txt']) {
      assert.ok(files(dataReadsInCommand(command, dir, true), dir).length > 0, command);
    }
    // Still allowed: processing, counting, and writing without printing.
    for (const command of [
      'cp data/pelanggan.csv cadangan.csv',
      'F=data/pelanggan.csv; wc -l "$F"',
      'python3 olah.py data/pelanggan.csv',
      'node dedupe.js data/pelanggan.csv',
      'sqlite3 app.db "select count(*) from users"',
      'diff kode-lama.ts kode-baru.ts',
      'for f in data/*.csv; do wc -l "$f"; done',
      'cat data/pelanggan.csv | wc -l',
      'ls data | xargs echo',
      'bash -c "sort data/pelanggan.csv > urut.csv"',
    ]) {
      assert.deepEqual(files(dataReadsInCommand(command, dir), dir), [], command);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell: pencarian ke folder, find -exec, gzip, file tanpa ekstensi, dan .env', () => {
  const dir = project();
  try {
    writeFileSync(path.join(dir, 'data', 'ekspor.csv.gz'), gzipSync(CSV));
    writeFileSync(path.join(dir, 'data', 'pelanggan_mentah'), CSV);
    writeFileSync(path.join(dir, '.env.local'), 'ADMIN_NIK=3201011508950001\n');
    const abs = path.join(dir, 'data').replace(/\\/g, '/');
    for (const [command, want] of [
      ['grep -rn 0812 .', 'data/pelanggan.csv'],
      ['grep -R Budi data/', 'data/pelanggan.csv'],
      ['rg Budi', 'data/pelanggan.csv'],
      ['rg -n Budi data', 'data/arsip/lama.csv'],
      ['ag Siti', 'data/pelanggan.csv'],
      ['find data -name "*.csv" -exec head -3 {} \\;', 'data/pelanggan.csv'],
      ['find . -type f -exec cat {} +', 'data/pelanggan.csv'],
      [`cd ${abs} && head pelanggan.csv`, 'data/pelanggan.csv'],
      ['zcat data/ekspor.csv.gz', 'data/ekspor.csv.gz'],
      ['gunzip -c data/ekspor.csv.gz | head', 'data/ekspor.csv.gz'],
      ['gzip -dc data/ekspor.csv.gz', 'data/ekspor.csv.gz'],
      ['cat data/pelanggan_mentah', 'data/pelanggan_mentah'],
      ['cat .env.local', '.env.local'],
      ['iconv -f utf-8 -t ascii data/pelanggan.csv', 'data/pelanggan.csv'],
      [`duckdb -c "select * from 'data/pelanggan.csv'"`, 'data/pelanggan.csv'],
    ] as const) {
      assert.ok(files(dataReadsInCommand(command, dir), dir).includes(want), `${command}: ${files(dataReadsInCommand(command, dir), dir)}`);
    }
    // Counting, listing, and searching code stay allowed.
    for (const command of ['grep -rc Budi data', 'grep -rl Budi .', 'rg --files', 'find data -name "*.csv"', 'rg parseNik src']) {
      assert.deepEqual(files(dataReadsInCommand(command, dir), dir), [], command);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell strict: skrip yang dijalankan dan mencetak data juga ditahan', () => {
  const dir = project();
  try {
    for (const command of [
      'python3 laporan.py',
      'cd data && python3 ../laporan.py',
      "cat > /tmp/cek.py <<'EOF'\nprint(open('data/pelanggan.csv').read())\nEOF\npython3 /tmp/cek.py",
      'F=data/pelanggan.csv; python3 -c "print(open(\'$F\').read())"',
    ]) {
      assert.deepEqual(files(inlineCodeReads(command, dir), dir), ['data/pelanggan.csv'], command);
    }
    for (const command of ['python3 laporan.py > hasil.txt', 'python3 olah.py data/pelanggan.csv', 'python3 -c "print(1)"']) {
      assert.deepEqual(files(inlineCodeReads(command, dir), dir), [], command);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guard: cd lalu cat ditahan lewat hook, dari ujung ke ujung', () => {
  const dir = project();
  try {
    const guard = (command: string) =>
      spawnSync(process.execPath, [CLI, 'guard'], {
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: dir }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        encoding: 'utf8',
      });
    for (const command of ['cd data && cat pelanggan.csv', '(cd data && cat pelanggan.csv)', 'F=data/pelanggan.csv; cat "$F"']) {
      const r = guard(command);
      assert.equal(r.status, 2, command);
      assert.ok(!r.stderr.includes('3201011508950001'), 'the message carries no value');
    }
    assert.equal(guard('cd data && wc -l pelanggan.csv').status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
