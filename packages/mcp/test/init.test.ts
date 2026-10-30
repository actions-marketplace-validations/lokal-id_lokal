// Fase 3: `lokal-mcp init` profiles, `lokal-mcp check`, "guard": "strict" in .samaran.json, and Kembaran's dry run.
// Every value here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfig } from '../src/files.ts';
import { describeConfig, PROFILES } from '../src/init.ts';
import { VERSION } from '../src/version.ts';

const CLI = path.resolve(import.meta.dirname, '../src/cli.ts');
const CSV = 'nama,nik,hp\nKenanga Purbasari,3174015507880099,0813-7788-1290\n';

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'lokal-init-'));
const run = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, SAMARAN_GUARD: '', ...env }, encoding: 'utf8' });

test('init: every profile writes a .samaran.json the loader accepts, and the files the profile names', () => {
  for (const profile of PROFILES) {
    const dir = tempDir();
    try {
      const r = run(dir, ['init', '--profile', profile]);
      assert.equal(r.status, 0, r.stderr);
      const config = loadConfig(dir);
      assert.ok(existsSync(path.join(dir, '.samaranignore')));
      const workflow = path.join(dir, '.github', 'workflows', 'pii.yml');
      assert.equal(existsSync(workflow), profile !== 'personal', profile);
      if (profile === 'personal') {
        assert.equal(config.audit, undefined);
        assert.equal(config.vaultTtlMinutes, 120);
      } else {
        assert.equal(config.audit, path.join(dir, '.lokal', 'audit.jsonl'));
        // The action is pinned to the release that wrote it.
        assert.match(readFileSync(workflow, 'utf8'), new RegExp(`uses: lokal-id/lokal@v${VERSION.replace(/\./g, '\\.')}\\n`));
      }
      if (profile === 'strict') {
        assert.equal(config.guard, 'strict');
        assert.deepEqual(config.policy, { HEALTH: 'block', CRIMINAL_RECORD: 'block', BIOMETRIC: 'block' });
        assert.match(readFileSync(workflow, 'utf8'), /strict: true/);
      } else {
        assert.equal(config.guard, undefined);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('init: --dry-run writes nothing; existing files are kept, and --force replaces only .samaran.json', () => {
  const dir = tempDir();
  try {
    const dry = run(dir, ['init', '--profile', 'team', '--dry-run']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /\.samaran\.json\s+would write/);
    assert.match(dry.stdout, /--- \.github\/workflows\/pii\.yml/);
    assert.deepEqual(readdirSync(dir), []);

    writeFileSync(path.join(dir, '.samaran.json'), '{"allow": ["0800-1-500-500"]}');
    writeFileSync(path.join(dir, '.samaranignore'), 'seed/\n');
    const kept = run(dir, ['init', '--profile', 'strict']);
    assert.match(kept.stdout, /\.samaran\.json\s+kept \(already there\)/);
    assert.deepEqual(loadConfig(dir).allow, ['0800-1-500-500']);
    assert.ok(existsSync(path.join(dir, '.github', 'workflows', 'pii.yml')));

    const forced = run(dir, ['init', '--profile', 'strict', '--force']);
    assert.match(forced.stdout, /\.samaran\.json\s+replaced/);
    assert.equal(loadConfig(dir).guard, 'strict');
    assert.equal(readFileSync(path.join(dir, '.samaranignore'), 'utf8'), 'seed/\n', '.samaranignore is the team\'s own list');

    const bad = run(dir, ['init', '--profile', 'paranoid']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Unknown profile paranoid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: explains the configuration, warns about risky settings, and fails on a broken file', () => {
  const dir = tempDir();
  try {
    const none = run(dir, ['check']);
    assert.equal(none.status, 0, none.stderr);
    assert.match(none.stdout, /not found \(the defaults below apply\)/);
    assert.match(none.stdout, /policy\s+everything is masked/);

    writeFileSync(path.join(dir, '.samaran.json'), JSON.stringify({
      policy: { NIK: 'allow', HEALTH: 'route' },
      route: { openai: 'https://llm.example.com/v1' },
      audit: 'logs/audit.jsonl',
    }));
    writeFileSync(path.join(dir, '.samaranignore'), '# made-up data\nfixtures/\n*.csv\n');
    const risky = run(dir, ['check']);
    assert.equal(risky.status, 0, risky.stderr);
    assert.match(risky.stdout, /policy\s+NIK=allow, HEALTH=route; everything else is masked/);
    assert.match(risky.stdout, /\.samaranignore\s+2 pattern\(s\)/);
    assert.match(risky.stdout, /policy allows NIK: the model sees these identity numbers unmasked/);
    assert.match(risky.stdout, /route\.openai \(https:\/\/llm\.example\.com\/v1\) is not on this machine/);
    assert.match(risky.stdout, /audit log logs[\\/]audit\.jsonl is inside the project/);
    assert.match(risky.stdout, /"\*\.csv", which skips real data files too/);

    // Local and private endpoints, and the compose service name, are not warned about.
    for (const url of ['http://127.0.0.1:11434/v1', 'http://localhost:11434/v1', 'http://ollama:11434/v1', 'http://192.168.1.20:11434/v1']) {
      const { warnings } = describeConfig(path.join(dir, 'empty'), { custom: [], allow: [], route: { openai: url } }, {});
      assert.deepEqual(warnings, [], url);
    }
    const { lines } = describeConfig(dir, { custom: [], allow: [], guard: 'strict' }, { SAMARAN_GUARD: 'off' });
    assert.ok(lines.some((l) => /guard\s+off \(SAMARAN_GUARD=off/.test(l)));

    writeFileSync(path.join(dir, '.samaran.json'), '{"guard": "off"}');
    const broken = run(dir, ['check']);
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /"guard" can only be "strict"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guard: "guard": "strict" in .samaran.json turns strict mode on for the repository; SAMARAN_GUARD still wins', () => {
  const dir = tempDir();
  mkdirSync(path.join(dir, 'ktp'));
  writeFileSync(path.join(dir, 'ktp', 'kenanga.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  const read = (env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [CLI, 'guard'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'ktp', 'kenanga.jpg') } }),
      env: { ...process.env, SAMARAN_GUARD: '', CLAUDE_PROJECT_DIR: dir, ...env },
      encoding: 'utf8',
    });
  try {
    // A photo filed like an ID card: asked about by default.
    assert.match(read().stdout, /"permissionDecision":"ask"/);
    writeFileSync(path.join(dir, '.samaran.json'), '{"guard": "strict"}');
    const strict = read();
    assert.equal(strict.status, 2);
    assert.match(strict.stderr, /"guard": "strict" in \.samaran\.json blocks what it cannot check/);
    assert.equal(read({ SAMARAN_GUARD: 'off' }).status, 0);
    assert.match(read({ SAMARAN_GUARD: 'strict' }).stderr, /SAMARAN_GUARD=strict blocks/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('kembaran --dry-run and anonymize_file dry_run count what would change and write nothing', async () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, 'pelanggan.csv'), CSV);
  try {
    const cli = run(dir, ['kembaran', 'pelanggan.csv', '--dry-run']);
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stderr, /pelanggan\.csv: would replace .*NIK=1/);
    assert.match(cli.stderr, /Dry run: nothing was written/);
    assert.ok(!cli.stderr.includes('3174015507880099'));
    // An output that is already there is no reason to stop a dry run.
    writeFileSync(path.join(dir, 'staging.csv'), 'old');
    assert.equal(run(dir, ['kembaran', 'pelanggan.csv', '-o', 'staging.csv', '--dry-run']).status, 0);
    assert.equal(readFileSync(path.join(dir, 'staging.csv'), 'utf8'), 'old');
    assert.deepEqual(readdirSync(dir).sort(), ['pelanggan.csv', 'staging.csv']);

    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI], env: { ...process.env, LOKAL_ROOT: dir } as Record<string, string> }));
    try {
      const r = await client.callTool({ name: 'anonymize_file', arguments: { paths: ['pelanggan.csv'], output: 'out.csv', dry_run: true } });
      const text = (r.content as Array<{ text: string }>)[0]!.text;
      assert.ok(!r.isError, text);
      const body = JSON.parse(text);
      assert.equal(body.dry_run, true);
      assert.equal(body.files[0].would_write, 'out.csv');
      assert.equal(body.files[0].would_replace.NIK, 1);
      assert.ok(!existsSync(path.join(dir, 'out.csv')));
    } finally {
      await client.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
