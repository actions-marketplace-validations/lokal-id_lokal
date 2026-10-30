// Audit log: one JSON line per decision Lokal made about personal data, for teams that must show what reached a model.
// Turned on with "audit": true in .samaran.json (.lokal/audit.jsonl) or a path. A line holds counts per type, the
// action, and where it happened; never a value, a placeholder's meaning, or a prompt.
//
//   lokal-mcp audit [file] [--since 7d] [--json]   summarizes it
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './files.ts';

export type AuditSource = 'proxy' | 'mcp' | 'guard';

export interface AuditEvent {
  source: AuditSource;
  /** What Lokal did: masked, blocked, routed, refused, asked, restored, anonymized, forgot, forwarded. */
  action: string;
  /** The tool, hook event, or API path. */
  what: string;
  /** A file, relative to the project root. */
  file?: string;
  /** Values per type or custom label. */
  counts?: Record<string, number>;
  /** Why something was refused, in words that hold no data. */
  reason?: string;
  status?: string;
  /** How many values, for the vault: how many it forgot. */
  values?: number;
}

/** Appends one event to the audit log; does nothing when there is none. Never throws: an audit error must not stop work. */
export function writeAudit(file: string | undefined, event: AuditEvent): void {
  if (!file) return;
  try {
    const dir = path.dirname(file);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      // The default folder is Lokal's own: keep it out of git, where a log of file names does not belong.
      if (path.basename(dir) === '.lokal') writeFileSync(path.join(dir, '.gitignore'), '*\n');
    }
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  } catch (e) {
    process.stderr.write(`lokal audit: could not write ${file}: ${(e as Error).message}\n`);
  }
}

/** Counts of matches by custom label or type, as an audit event holds them. */
export function countMatches(matches: Iterable<{ type: string; label?: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of matches) out[m.label ?? m.type] = (out[m.label ?? m.type] ?? 0) + 1;
  return out;
}

const USAGE = `Usage: lokal-mcp audit [file] [--since <7d|24h|30m>] [--json]

Summarizes the audit log: what Lokal masked, blocked, routed, and refused, per source and type.
The file defaults to the "audit" path in .samaran.json, or .lokal/audit.jsonl.`;

/** "7d", "24h", "30m" in milliseconds. */
function duration(s: string): number | undefined {
  const m = /^(\d+)\s*([dhm])$/.exec(s.trim());
  if (!m) return undefined;
  return Number(m[1]) * { d: 86_400_000, h: 3_600_000, m: 60_000 }[m[2] as 'd' | 'h' | 'm'];
}

export function runAudit(args: string[]): void {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const sinceAt = args.indexOf('--since');
  const since = sinceAt >= 0 ? duration(args[sinceAt + 1] ?? '') : undefined;
  if (sinceAt >= 0 && since === undefined) {
    process.stderr.write('--since takes a duration such as 7d, 24h, or 30m\n');
    process.exitCode = 1;
    return;
  }
  const positional = args.filter((a, i) => !a.startsWith('--') && !(sinceAt >= 0 && i === sinceAt + 1));
  let file = positional[0] ? path.resolve(positional[0]) : undefined;
  if (!file) {
    try {
      file = loadConfig(process.cwd()).audit;
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exitCode = 1;
      return;
    }
    file ??= path.resolve('.lokal/audit.jsonl');
  }
  if (!existsSync(file)) {
    process.stderr.write(`No audit log at ${file}. Turn it on with "audit": true in .samaran.json.\n`);
    process.exitCode = 1;
    return;
  }

  const from = since === undefined ? 0 : Date.now() - since;
  const events: Array<AuditEvent & { ts: string }> = [];
  let broken = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as AuditEvent & { ts: string };
      if (Date.parse(e.ts) >= from) events.push(e);
    } catch {
      broken++;
    }
  }
  const byAction = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const e of events) {
    const key = `${e.source} ${e.action}`;
    byAction.set(key, (byAction.get(key) ?? 0) + 1);
    for (const [t, n] of Object.entries(e.counts ?? {})) byType.set(t, (byType.get(t) ?? 0) + n);
  }
  const refused = events.filter((e) => ['blocked', 'refused'].includes(e.action));
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      file,
      events: events.length,
      first: events[0]?.ts,
      last: events.at(-1)?.ts,
      byAction: Object.fromEntries(byAction),
      byType: Object.fromEntries(byType),
      refused: refused.slice(-20),
      unreadableLines: broken,
    }, null, 2)}\n`);
    return;
  }
  const lines = [
    `Audit log ${path.relative(process.cwd(), file) || file}: ${events.length} event(s)${events.length ? `, ${events[0]!.ts} to ${events.at(-1)!.ts}` : ''}`,
    '',
    'source / action          events',
    ...[...byAction].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.padEnd(24)} ${String(n).padStart(6)}`),
    '',
    'type                     values',
    ...[...byType].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.padEnd(24)} ${String(n).padStart(6)}`),
  ];
  if (refused.length) {
    lines.push('', `Last ${Math.min(10, refused.length)} refused or blocked:`);
    for (const e of refused.slice(-10)) {
      const counts = Object.entries(e.counts ?? {}).map(([t, n]) => `${t}=${n}`).join(',');
      lines.push(`  ${e.ts} ${e.source} ${e.what}${e.file ? ` ${e.file}` : ''}${counts ? ` ${counts}` : ''}${e.reason ? ` (${e.reason})` : ''}`);
    }
  }
  if (broken) lines.push('', `${broken} line(s) could not be read.`);
  process.stdout.write(`${lines.join('\n')}\n`);
}
