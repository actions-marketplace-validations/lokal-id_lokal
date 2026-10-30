// The canary for the leak tests: one made-up person (canary.json) in the formats real data arrives in, and a check
// that none of their values comes out of an integration. Used by core and mcp tests; python/tests reads the JSON too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type Field = [key: string, label: string, type: string, value: string];
const { fields } = JSON.parse(readFileSync(path.join(import.meta.dirname, 'canary.json'), 'utf8')) as { fields: Field[] };

export const CANARY_FIELDS = fields;

/** The same person as a form, JSON, a log line, and CSV. */
export const CANARY_FORMATS: Record<string, string> = {
  text: fields.map(([, label, , value]) => `${label}: ${value}`).join('\n'),
  json: JSON.stringify({ customer: Object.fromEntries(fields.map(([key, , , value]) => [key, value])) }),
  log: `2026-10-29 10:00:00 INFO checkout ${fields.map(([key, , , value]) => `${key}="${value}"`).join(' ')}`,
  csv: `${fields.map(([key]) => key).join(',')}\n${fields.map(([, , , value]) => `"${value}"`).join(',')}\n`,
};

/**
 * What must never appear: every value, the digits of a number written another way (081377881290), and the parts of
 * the name and street, so a mask that covers only "Kenanga" still fails.
 */
export const CANARY_NEEDLES: string[] = [
  ...new Set(
    fields.flatMap(([, , type, value]) => {
      const digits = value.replace(/\D/g, '');
      const parts = type === 'NAME' ? value.split(' ') : type === 'ADDRESS' ? ['Kanari Raya'] : [];
      return [value, ...(digits.length >= 8 && digits !== value ? [digits] : []), ...parts];
    }),
  ),
];

/** Fails with the values that leaked and where, without printing the rest of the output. */
export function assertNoCanary(output: string, where: string): void {
  const leaked = CANARY_NEEDLES.filter((n) => output.includes(n));
  assert.deepEqual(leaked, [], `${where} leaked ${leaked.join(', ')}`);
}
