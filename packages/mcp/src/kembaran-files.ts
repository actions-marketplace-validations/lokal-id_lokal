// Kembaran for files: the `lokal-mcp kembaran` command and the anonymize_file tool. Several files share one set of
// stand-ins, so an SQL dump and a CSV export of the same customers still join. Only counts are reported: whoever
// runs it, an agent included, never sees the data.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PII_TYPES, type CustomRule, type PiiType } from '@lokal-id/core';
import { KEEP_BY_DEFAULT, Kembaran } from '@lokal-id/core/kembaran';
import { isTextFile, loadConfig, loadInRoot, MAX_FILE_BYTES, writeInRoot } from './files.ts';

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
  /**
   * The MCP server's root: inputs are read and outputs written only as files checked inside it when opened, so a path
   * swapped for a link after the check cannot lead out of it. The command line has no root.
   */
  root?: string;
}

export interface AnonymizedFile {
  from: string;
  to: string;
  replaced: Partial<Record<PiiType, number>>;
  /** Values the detector missed in this file, replaced because they were found in this or another input. */
  crossed: Partial<Record<PiiType, number>>;
}

export interface Anonymized {
  files: AnonymizedFile[];
  /** Real identity numbers, phone numbers, e-mail addresses, and full names of the input left in the output: 0 unless glued to other text. */
  leaked: number;
}

export const KEMBARAN_NOTE =
  'Kembaran replaces the personal data it recognizes, and a 16-digit run that is a valid NIK however it is written; anything else it does not recognize is copied as it is. Look through the output before sharing it, and only then, if agents should read it, list it in .samaranignore (the made-up people in it look real, so Samaran and the guard flag them). A made-up phone number can still belong to someone: keep staging from sending SMS, WhatsApp, or e-mail to real addresses.';

/** Said of a file in which Kembaran replaced nothing: never "clean", since it only knows what it recognizes. */
export const NOTHING_REPLACED =
  'nothing replaced: Kembaran recognized no personal data, which does not mean there is none; the output is a copy of the input';

/** Where each input goes: `output` itself for one file, `output/<name>` for several or when it is a folder. */
export function planOutputs(inputs: string[], output: string): string[] {
  const several = inputs.length > 1 || (existsSync(output) && statSync(output).isDirectory());
  return inputs.map((file) => (several ? path.join(output, path.basename(file)) : output));
}

export function anonymizeFiles(inputs: string[], output: string, options: AnonymizeOptions = {}): Anonymized {
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
  // All files at once: a value found in one is replaced in the others too, where it has no label or column name.
  const read = (file: string): string => {
    if (options.root === undefined) return readFileSync(file, 'utf8');
    const { doc } = loadInRoot(options.root, file);
    if (doc.kind !== 'text') throw new Error(`${file} is not a text file. Kembaran reads SQL dumps, CSV, JSON, and logs.`);
    return doc.text;
  };
  const result = kembaran.texts(inputs.map(read));
  const files = result.files.map(({ text, replaced, crossed }, i) => {
    if (!options.dryRun) {
      if (options.root !== undefined) {
        writeInRoot(options.root, targets[i]!, text);
      } else {
        mkdirSync(path.dirname(targets[i]!), { recursive: true });
        writeFileSync(targets[i]!, text, 'utf8');
      }
    }
    return { from: inputs[i]!, to: targets[i]!, replaced, crossed };
  });
  return { files, leaked: result.leaked };
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
    const { files, leaked } = anonymizeFiles(inputs, output ?? '(dry run)', {
      secret: opt('--secret'),
      keep: keep as PiiType[],
      keepBirthDate: args.includes('--keep-birth-date'),
      overwrite: args.includes('--overwrite'),
      dryRun,
      custom: loadConfig(process.cwd()).custom,
    });
    let empty = 0;
    for (const f of files) {
      const crossed = Object.values(f.crossed).reduce((a, b) => a + b, 0);
      const replaced = Object.entries(f.replaced).map(([t, n]) => `${t}=${n}`).join(', ');
      if (!replaced && !crossed) empty++;
      const counts = !replaced && !crossed
        ? NOTHING_REPLACED
        : (replaced || 'nothing directly') + (crossed ? `, and ${crossed} more found through the other values or as valid NIKs` : '');
      process.stderr.write(dryRun ? `${f.from}: would replace ${counts}\n` : `${f.from} -> ${f.to}: ${counts}\n`);
    }
    if (leaked) {
      process.stderr.write(`Warning: ${leaked} real value(s) are still in the output, glued to other text. Do not share it as it is.\n`);
      process.exitCode = 1;
    }
    if (empty) process.stderr.write(`Warning: ${empty} file(s) had nothing replaced. Do not treat them as anonymized without looking.\n`);
    process.stderr.write(dryRun ? 'Dry run: nothing was written.\n' : `${KEMBARAN_NOTE}\n`);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}
