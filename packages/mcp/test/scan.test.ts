import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines, formatGithub, formatSummary, gitTargets, pathTargets, scanTargets, unquoteGitPath } from '../src/scan.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '../src/cli.ts');
// Made-up people, as everywhere in these tests.
const OLD_ROW = 'Budi Santoso,3201011508950001,0812-3456-7890';
const NEW_ROW = 'Siti Aminah,3276014503920002,0813-9876-5432';

function repo(): { dir: string; git: (...args: string[]) => string; done: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-scan-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: dir }).toString('utf8');
  git('init', '-q', '-b', 'main');
  return { dir, git, done: () => rmSync(dir, { recursive: true, force: true }) };
}

function cli(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, 'scan', ...args], { cwd, encoding: 'utf8' });
}

test('addedLines reads the new side of a -U0 patch', () => {
  const patch = [
    'diff --git a/data/x.csv b/data/x.csv',
    '--- a/data/x.csv',
    '+++ b/data/x.csv',
    '@@ -2 +2,2 @@',
    '-old',
    '+new one',
    '+new two',
    '@@ -9,0 +11 @@',
    '+appended',
    '@@ -20,3 +22,0 @@',
    'diff --git a/gone.txt b/gone.txt',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
  ].join('\n');
  const lines = addedLines(patch);
  assert.deepEqual([...lines.get('data/x.csv')!], [2, 3, 11]);
  assert.equal(lines.has('gone.txt'), false);
});

test('unquoteGitPath decodes git C-style quoting', () => {
  assert.equal(unquoteGitPath('plain.csv'), 'plain.csv');
  assert.equal(unquoteGitPath('"caf\\303\\251 data.csv"'), 'café data.csv');
  assert.equal(unquoteGitPath('"tab\\there.csv"'), 'tab\there.csv');
});

test('--staged reports only lines added in the commit, from the staged content', () => {
  const { dir, git, done } = repo();
  try {
    writeFileSync(path.join(dir, 'pelanggan.csv'), `nama,nik,telepon\n${OLD_ROW}\n`);
    git('add', '.');
    git('commit', '-q', '-m', 'existing fixture');

    // Nothing staged yet: clean, even though the file already holds a NIK.
    assert.equal(scanTargets(gitTargets(dir, { staged: true })).findings.length, 0);

    writeFileSync(path.join(dir, 'pelanggan.csv'), `nama,nik,telepon\n${OLD_ROW}\n${NEW_ROW}\n`);
    git('add', 'pelanggan.csv');
    const report = scanTargets(gitTargets(dir, { staged: true }));
    assert.deepEqual(
      report.findings.map((f) => [f.file, f.line, f.type]),
      [['pelanggan.csv', 3, 'NAME'], ['pelanggan.csv', 3, 'NIK'], ['pelanggan.csv', 3, 'PHONE']],
    );
    // Values never appear whole.
    assert.ok(!JSON.stringify(report).includes('3276014503920002'));

    // What counts is the index: an unstaged edit is not part of the commit.
    git('commit', '-q', '-m', 'second customer');
    writeFileSync(path.join(dir, 'pelanggan.csv'), `nama,nik,telepon\n${OLD_ROW}\n${NEW_ROW}\nAndi,3201011508950001,\n`);
    assert.equal(scanTargets(gitTargets(dir, { staged: true })).findings.length, 0);

    const result = cli(dir, '--staged');
    assert.equal(result.status, 0, result.stderr);
    git('add', 'pelanggan.csv');
    const blocked = cli(dir, '--staged');
    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /pelanggan\.csv:4: NIK 3201\*{8}0001/);
    assert.doesNotMatch(blocked.stdout, /3201011508950001/);
  } finally {
    done();
  }
});

test('--diff checks a branch against its base; renamed and ignored files stay quiet', () => {
  const { dir, git, done } = repo();
  try {
    writeFileSync(path.join(dir, 'seed.csv'), `nama,nik\n${OLD_ROW}\n`);
    writeFileSync(path.join(dir, 'app.ts'), 'export const x = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();

    git('mv', 'seed.csv', 'seed-old.csv');
    writeFileSync(path.join(dir, 'app.ts'), `export const x = 1;\n// NIK pelanggan: 3276014503920002\nconst demo = '3201011508950001'; // samaran-ignore\n`);
    writeFileSync(path.join(dir, 'fixture.csv'), `${NEW_ROW}\n`);
    writeFileSync(path.join(dir, '.samaranignore'), 'fixture.csv\n');
    git('add', '.');
    git('commit', '-q', '-m', 'change');

    const report = scanTargets(gitTargets(dir, { base }), { isIgnored: (f) => f === 'fixture.csv' });
    assert.deepEqual(report.findings.map((f) => [f.file, f.line, f.type]), [['app.ts', 2, 'NIK']]);
    assert.equal(report.filesIgnored, 1);

    const result = cli(dir, '--diff', base, '--format', 'github');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^::error file=app\.ts,line=2,title=Personal data%3A NIK::NIK 3276\*{8}0002/m);
    assert.doesNotMatch(result.stdout, /fixture\.csv|seed/);
  } finally {
    done();
  }
});

test('binary documents in a change are scanned whole', () => {
  const { dir, git, done } = repo();
  try {
    writeFileSync(path.join(dir, 'README.md'), 'hi\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    copyFileSync(path.join(HERE, 'fixtures/pelanggan.xlsx'), path.join(dir, 'export.xlsx'));
    git('add', 'export.xlsx');
    const report = scanTargets(gitTargets(dir, { staged: true }));
    assert.ok(report.findings.some((f) => f.file === 'export.xlsx' && f.type === 'NIK' && f.sheet));
  } finally {
    done();
  }
});

test('a path scan follows .gitignore and reports files it cannot read', () => {
  const { dir, git, done } = repo();
  try {
    writeFileSync(path.join(dir, '.gitignore'), 'local/\n');
    writeFileSync(path.join(dir, 'ok.txt'), 'nothing here\n');
    mkdirSync(path.join(dir, 'local'));
    writeFileSync(path.join(dir, 'local/dump.csv'), `${OLD_ROW}\n`);
    writeFileSync(path.join(dir, 'backup.zip'), 'PK');
    git('add', '.gitignore', 'ok.txt');
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const report = scanTargets(pathTargets(dir, ['.']));
      assert.equal(report.findings.length, 0);
      assert.deepEqual(report.notScanned, [{ file: 'backup.zip', status: 'unsupported', reason: 'archive' }]);
    } finally {
      process.chdir(cwd);
    }
    assert.equal(cli(dir).status, 0);
    assert.equal(cli(dir, '--strict').status, 1);
  } finally {
    done();
  }
});

test('the job summary and annotations escape what GitHub would misread', () => {
  const report = {
    filesScanned: 1,
    filesIgnored: 0,
    findings: [{ file: 'a,b|c.csv', line: 1, type: 'NIK' as const, uuPdp: 'umum' as const, confidence: 'high' as const, preview: '3201********0001' }],
    notScanned: [],
  };
  assert.match(formatGithub(report), /^::error file=a%2Cb\|c\.csv,line=1,/);
  assert.match(formatSummary(report), /\| `a,b\\\|c\.csv:1` \| NIK \|/);
});

test('usage errors exit with 2', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lokal-scan-'));
  try {
    assert.equal(cli(dir, '--format', 'xml').status, 2);
    assert.equal(cli(dir, '--types', 'SHOE_SIZE').status, 2);
    assert.equal(cli(dir, '--staged').status, 2);
    assert.ok(readFileSync(CLI, 'utf8').includes("'scan'"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
