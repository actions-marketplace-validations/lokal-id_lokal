// `lokal-mcp init` sets a project up from a profile, and `lokal-mcp check` says what its configuration does.
//
//   lokal-mcp init [--profile personal|team|strict] [--dry-run] [--force]
//   lokal-mcp check [folder]
//
// init writes only files that are not there yet (--force replaces .samaran.json); nothing else in the project is touched.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PiiType } from '@lokal-id/core';
import { loadConfig, type SamaranConfig } from './files.ts';
import { VERSION } from './version.ts';

export type Profile = 'personal' | 'team' | 'strict';
export const PROFILES: readonly Profile[] = ['personal', 'team', 'strict'];

const DOCS = 'https://github.com/lokal-id/lokal#policy-local-routing-and-the-audit-log';

/** What each profile puts in .samaran.json. */
export function profileConfig(profile: Profile): Record<string, unknown> {
  const base = { $comment: `Lokal profile "${profile}". What each key does: ${DOCS}`, custom: [], allow: [] };
  if (profile === 'personal') return { ...base, vaultTtlMinutes: 120 };
  if (profile === 'team') return { ...base, audit: true, vaultTtlMinutes: 60 };
  return {
    ...base,
    policy: { HEALTH: 'block', CRIMINAL_RECORD: 'block', BIOMETRIC: 'block' },
    audit: true,
    vaultTtlMinutes: 30,
    guard: 'strict',
  };
}

const IGNORE = `# Files that hold only made-up data, which Samaran should not flag or block (gitignore syntax).
# Keep real exports and dumps out of this list.
# test/fixtures/
# database/seeders/
# *.example.csv
`;

function workflow(profile: Profile): string {
  return `# Fails a pull request that adds Indonesian personal data (NIK, phone numbers, bank accounts, health data, …).
# Written by lokal-mcp init --profile ${profile}. Nothing leaves the runner; findings show masked values only.
name: PII
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: lokal-id/lokal@v${VERSION}
${profile === 'strict' ? '        with:\n          strict: true  # also fail on changed files that could not be read\n' : ''}`;
}

export interface PlannedFile {
  file: string;
  content: string;
  /** What happens to it: written, replaced, or kept because it is already there. */
  action: 'write' | 'replace' | 'keep';
}

/** The files a profile writes in `root`, and what would happen to each. */
export function planInit(root: string, profile: Profile, force = false): PlannedFile[] {
  const files: Array<{ file: string; content: string; replaceable?: boolean }> = [
    { file: '.samaran.json', content: `${JSON.stringify(profileConfig(profile), null, 2)}\n`, replaceable: true },
    { file: '.samaranignore', content: IGNORE },
  ];
  if (profile !== 'personal') files.push({ file: '.github/workflows/pii.yml', content: workflow(profile) });
  return files.map(({ file, content, replaceable }) => {
    const there = existsSync(path.join(root, file));
    return { file, content, action: !there ? 'write' : force && replaceable ? 'replace' : 'keep' };
  });
}

const NEXT: Record<Profile, string[]> = {
  personal: [
    'Claude Code: /plugin marketplace add lokal-id/lokal, then /plugin install lokal@lokal (skills, MCP server, guard).',
    'Other agents: see https://github.com/lokal-id/lokal#quick-start',
  ],
  team: [
    'Commit .samaran.json, .samaranignore, and .github/workflows/pii.yml so everyone gets the same rules.',
    'Each developer installs the Claude Code plugin, or the guard hook for their agent.',
    'The audit log goes to .lokal/audit.jsonl on each machine (kept out of git); read it with lokal-mcp audit.',
  ],
  strict: [
    'Commit .samaran.json, .samaranignore, and .github/workflows/pii.yml so everyone gets the same rules.',
    'The guard now blocks what it cannot check, for everyone in this repository, and read_file_masked refuses files with health, criminal, or biometric data.',
    'Add rules your team needs to "custom", and change "policy" to suit; lokal-mcp check shows the result.',
  ],
};

const INIT_USAGE = `Usage: lokal-mcp init [--profile personal|team|strict] [--dry-run] [--force]

Sets up Samaran in this folder:
  personal (default)  .samaran.json (vault forgotten after 2 hours) and .samaranignore
  team                ...plus the audit log, a 1-hour vault, and a GitHub workflow that fails pull requests with
                      personal data
  strict              ...plus a guard that blocks what it cannot check, health, criminal, and biometric data
                      refused even masked, and a 30-minute vault

  --dry-run   Show what would be written, and write nothing
  --force     Replace an existing .samaran.json (other files are never replaced)`;

export function runInit(args: string[]): void {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${INIT_USAGE}\n`);
    return;
  }
  const at = args.indexOf('--profile');
  const profile = (at >= 0 ? args[at + 1] : 'personal') as Profile;
  if (!PROFILES.includes(profile)) {
    process.stderr.write(`Unknown profile ${profile ?? ''}. Choose personal, team, or strict.\n\n${INIT_USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const root = process.cwd();
  const dryRun = args.includes('--dry-run');
  const plan = planInit(root, profile, args.includes('--force'));
  const out: string[] = [`${dryRun ? 'Would set up' : 'Setting up'} Samaran with the "${profile}" profile in ${root}:`];
  for (const p of plan) {
    const verb = { write: dryRun ? 'would write' : 'wrote', replace: dryRun ? 'would replace' : 'replaced', keep: 'kept (already there)' }[p.action];
    out.push(`  ${p.file.padEnd(28)} ${verb}`);
    if (!dryRun && p.action !== 'keep') {
      mkdirSync(path.dirname(path.join(root, p.file)), { recursive: true });
      writeFileSync(path.join(root, p.file), p.content, 'utf8');
    }
  }
  if (dryRun) {
    for (const p of plan.filter((f) => f.action !== 'keep')) out.push('', `--- ${p.file}`, p.content.trimEnd());
  } else {
    out.push('', 'Next:', ...NEXT[profile].map((l) => `  - ${l}`), '  - lokal-mcp check shows what the configuration does.');
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

// --- check -----------------------------------------------------------------------------------------------------

/** Types that identify someone on their own: letting the model see them is worth a second look. */
const IDENTIFIERS: PiiType[] = ['NIK', 'KK', 'NPWP', 'PASSPORT', 'SIM', 'NIP', 'NISN', 'AKTA', 'BANK_ACCOUNT', 'BPJS', 'CARD'];

const isLocal = (url: string) => {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0|host\.docker\.internal)$/.test(host) || !host.includes('.') ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch {
    return false;
  }
};

/** What a configuration does, as lines, and the warnings worth reading. */
export function describeConfig(root: string, config: SamaranConfig, env: NodeJS.ProcessEnv = process.env): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const guard = env.SAMARAN_GUARD === 'off'
    ? 'off (SAMARAN_GUARD=off on this machine)'
    : env.SAMARAN_GUARD === 'strict'
      ? 'strict (SAMARAN_GUARD=strict)'
      : config.guard === 'strict'
        ? env.SAMARAN_GUARD ? `default (SAMARAN_GUARD=${env.SAMARAN_GUARD} overrides "guard": "strict")` : 'strict ("guard": "strict")'
        : 'default (asks about what it cannot check)';
  const policy = Object.entries(config.policy ?? {});
  const ignore = existsSync(path.join(root, '.samaranignore'))
    ? readFileSync(path.join(root, '.samaranignore'), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
    : undefined;
  const lines = [
    `.samaran.json   ${existsSync(path.join(root, '.samaran.json')) ? 'valid' : 'not found (the defaults below apply)'}`,
    `guard           ${guard}`,
    `custom rules    ${config.custom.length ? config.custom.map((r) => r.label).join(', ') : 'none'}`,
    `allow list      ${config.allow.length} value(s)`,
    `policy          ${policy.length ? `${policy.map(([k, a]) => `${k}=${a}`).join(', ')}; everything else is masked` : 'everything is masked'}`,
    `route           ${config.route ? [config.route.openai && `openai ${config.route.openai}`, config.route.anthropic && `anthropic ${config.route.anthropic}`, config.route.model && `model ${config.route.model}`].filter(Boolean).join(', ') : 'none'}`,
    `audit log       ${config.audit ? path.relative(root, config.audit) || config.audit : 'off'}`,
    `vault           ${env.LOKAL_VAULT_TTL_MINUTES ? `forgotten after ${env.LOKAL_VAULT_TTL_MINUTES} min (LOKAL_VAULT_TTL_MINUTES)` : config.vaultTtlMinutes ? `forgotten after ${config.vaultTtlMinutes} min without use` : 'kept until the MCP server stops (set "vaultTtlMinutes" or call clear_vault)'}`,
    `.samaranignore  ${ignore ? `${ignore.length} pattern(s)` : 'not found'}`,
  ];
  if (env.SAMARAN_GUARD === 'off') warnings.push('The guard is off on this machine: prompts and file reads are not checked.');
  const allowedIds = policy.filter(([k, a]) => a === 'allow' && IDENTIFIERS.includes(k as PiiType)).map(([k]) => k);
  if (allowedIds.length) warnings.push(`policy allows ${allowedIds.join(', ')}: the model sees these identity numbers unmasked.`);
  for (const [kind, url] of Object.entries({ openai: config.route?.openai, anthropic: config.route?.anthropic })) {
    if (url && !isLocal(url)) warnings.push(`route.${kind} (${url}) is not on this machine or a private network: routed requests are sent there unmasked.`);
  }
  if (config.audit && path.relative(root, config.audit).split(path.sep)[0] !== '.lokal' && !path.relative(root, config.audit).startsWith('..')) {
    warnings.push(`The audit log ${path.relative(root, config.audit)} is inside the project: keep it out of git (it lists file names).`);
  }
  const risky = (ignore ?? []).filter((l) => /^\*+$|^\/?\*\*?\/?$|^\.$|^\*\.(csv|xlsx|json|sql|log)$/i.test(l.trim()));
  if (risky.length) warnings.push(`.samaranignore has ${risky.map((l) => `"${l.trim()}"`).join(', ')}, which skips real data files too.`);
  return { lines, warnings };
}

export function runCheck(args: string[]): void {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: lokal-mcp check [folder]\n\nValidates .samaran.json and .samaranignore and shows what they do. Exits with 1 when .samaran.json is wrong.\n');
    return;
  }
  const root = path.resolve(args.find((a) => !a.startsWith('-')) ?? '.');
  let config: SamaranConfig;
  try {
    config = loadConfig(root);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = 1;
    return;
  }
  const { lines, warnings } = describeConfig(root, config);
  const out = [`Samaran configuration in ${root}`, '', ...lines];
  if (warnings.length) out.push('', 'Warnings:', ...warnings.map((w) => `  - ${w}`));
  process.stdout.write(`${out.join('\n')}\n`);
}
