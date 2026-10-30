// Kembaran for files: the `lokal-mcp kembaran` command and the anonymize_file tool. Several files share one set of
// stand-ins, so an SQL dump and a CSV export of the same customers still join. Only counts are reported: whoever
// runs it, an agent included, never sees the data.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PII_TYPES, type CustomRule, type PiiType } from '@lokal-id/core';
import { KEEP_BY_DEFAULT, Kembaran } from '@lokal-id/core/kembaran';
import { isTextFile, loadConfig, MAX_FILE_BYTES } from './files.ts';

export interface AnonymizeOptions {
  secret?: string;
  /** Types to leave as they are, on top of the defaults (gender, religion, marital status, nationality). */
  keep?: PiiType[];
  keepBirthDate?: boolean;
  overwrite?: boolean;
  /** Count what would be replaced, and write nothing. */
  dryRun?: boolean;
  /** The project's own rules from .samaran.json. */
  custom?: CustomRule[];
}

export interface AnonymizedFile {
  from: string;
  to: string;
  replaced: Partial<Record<PiiType, number>>;
}

export const KEMBARAN_NOTE =
  'The output holds made-up people that look real, so Samaran and the guard will flag it; list it in .samaranignore if agents should read it. A made-up phone number can still belong to someone: keep staging from sending SMS, WhatsApp, or e-mail to real addresses.';

/** Where each input goes: `output` itself for one file, `output/<name>` for several or when it is a folder. */
export function planOutputs(inputs: string[], output: string): string[] {
  const several = inputs.length > 1 || (existsSync(output) && statSync(output).isDirectory());
  return inputs.map((file) => (several ? path.join(output, path.basename(file)) : output));
}

export function anonymizeFiles(inputs: string[], output: string, options: AnonymizeOptions = {}): AnonymizedFile[] {
  const targets = planOutputs(inputs, output);
  // Check everything before writing anything.
  inputs.forEach((file, i) => {
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Not a file: ${file}`);
    if (statSync(file).size > MAX_FILE_BYTES) throw new Error(`${file} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
    if (!isTextFile(file)) throw new Error(`${file} is not a text file. Kembaran reads SQL dumps, CSV, JSON, and logs.`);
    if (path.resolve(targets[i]!) === path.resolve(file)) throw new Error(`${file}: the output must be a different file.`);
    if (!options.dryRun && existsSync(targets[i]!) && !options.overwrite) throw new Error(`${targets[i]} already exists. Pass overwrite to replace it.`);
  });
  const kembaran = new Kembaran({
    secret: options.secret,
    keep: [...KEEP_BY_DEFAULT, ...(options.keep ?? [])],
    keepBirthDate: options.keepBirthDate,
    custom: options.custom,
  });
  return inputs.map((file, i) => {
    const { text, replaced } = kembaran.text(readFileSync(file, 'utf8'));
    if (options.dryRun) return { from: file, to: targets[i]!, replaced };
    mkdirSync(path.dirname(targets[i]!), { recursive: true });
    writeFileSync(targets[i]!, text, 'utf8');
    return { from: file, to: targets[i]!, replaced };
  });
}

const USAGE = `Usage: lokal-mcp kembaran <input>... -o <output> [options]

Replaces Indonesian personal data in SQL dumps, CSV, JSON, and logs with realistic stand-ins: valid NIKs in the same
district, phone numbers on the same operator, names with the same casing. Several inputs share one set of stand-ins.

  -o, --output <path>   Output file, or a folder for several inputs
  --secret <text>       The same secret gives the same stand-ins on every run (default: random each run)
  --keep <types>        Types to leave as they are, e.g. FINANCIAL,NAME
  --keep-birth-date     Keep whole birth dates, not only the year
  --overwrite           Replace existing output files
  --dry-run             Count what would be replaced, and write nothing (-o is optional)`;

export function runKembaran(args: string[]): void {
  const opt = (...names: string[]) => {
    const i = args.findIndex((a) => names.includes(a));
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes('--help') || args.includes('-h') || !args.length) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const valued = new Set(['-o', '--output', '--secret', '--keep']);
  const inputs = args.filter((a, i) => !a.startsWith('-') && !valued.has(args[i - 1] ?? ''));
  const output = opt('-o', '--output');
  const dryRun = args.includes('--dry-run');
  if (!inputs.length || (!output && !dryRun)) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const keep = (opt('--keep') ?? '').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  const unknown = keep.filter((t) => !PII_TYPES.includes(t as PiiType));
  if (unknown.length) {
    process.stderr.write(`Unknown PII type ${unknown.join(', ')}. Valid types: ${PII_TYPES.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const files = anonymizeFiles(inputs, output ?? '(dry run)', {
      secret: opt('--secret'),
      keep: keep as PiiType[],
      keepBirthDate: args.includes('--keep-birth-date'),
      overwrite: args.includes('--overwrite'),
      dryRun,
      custom: loadConfig(process.cwd()).custom,
    });
    for (const f of files) {
      const counts = Object.entries(f.replaced).map(([t, n]) => `${t}=${n}`).join(', ') || 'nothing found';
      process.stderr.write(dryRun ? `${f.from}: would replace ${counts}\n` : `${f.from} -> ${f.to}: ${counts}\n`);
    }
    process.stderr.write(dryRun ? 'Dry run: nothing was written.\n' : `${KEMBARAN_NOTE}\n`);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}
