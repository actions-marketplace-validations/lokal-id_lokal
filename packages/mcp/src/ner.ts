// Names without a label or a cue ("saya di chat sama rianto surya"), from @lokal-id/ner, when .samaran.json has
// "ner": true. The package is optional: it brings a model runtime (onnxruntime-web) and downloads a 125 MB model on
// first use, so it is loaded only when asked for, and installed next to the server:
//
//   npx -y -p @lokal-id/mcp -p @lokal-id/ner lokal-mcp
//
// Without it the rules still run, and the tools say that names without a cue may be missed.

import { createHmac, randomBytes } from 'node:crypto';
import type { PiiMatch } from '@lokal-id/core';

interface Finder {
  find(text: string): Promise<PiiMatch[]>;
}

/**
 * Looks up names in text; remembers recent texts, as a chat sends its whole history again with every message.
 *
 * The memory holds no personal data: an entry's key is a keyed hash of the text (HMAC-SHA256 with a random key, so a
 * short text such as "NIK 3201…" cannot be found again by hashing guesses), and its value only where the names are.
 * The names are read from the text again when it comes back. `clear()` forgets everything and draws a new key: the
 * server calls it when its vault is cleared or expires.
 */
export class NerNames {
  private loading: Promise<Finder | undefined> | undefined;
  private readonly cache = new Map<string, Array<[start: number, end: number]>>();
  private key = randomBytes(32);
  private readonly load: () => Promise<Finder>;
  private readonly limit: number;
  /** Why NER is not running though it was asked for; undefined while it is, or before the first use. */
  problem: string | undefined;

  constructor(load: () => Promise<Finder> = async () => (await import('@lokal-id/ner')).NerNames.load(), limit = 2000) {
    this.load = load;
    this.limit = limit;
  }

  /** The names in `text`, or undefined when the model could not be loaded (see `problem`). */
  async find(text: string): Promise<PiiMatch[] | undefined> {
    const id = createHmac('sha256', this.key).update(text).digest('base64');
    const known = this.cache.get(id);
    if (known) {
      this.cache.delete(id);
      this.cache.set(id, known);
      return known.map(([start, end]) => ({ type: 'NAME', start, end, value: text.slice(start, end), confidence: 'medium' }));
    }
    this.loading ??= this.load().catch((e: unknown) => {
      const message = (e as Error).message;
      this.problem = /Cannot find (package|module) '@lokal-id\/ner'/.test(message)
        ? '"ner" is on in .samaran.json, but @lokal-id/ner is not installed next to the server (npx -y -p @lokal-id/mcp -p @lokal-id/ner lokal-mcp)'
        : `"ner" is on in .samaran.json, but its model could not be loaded: ${message}`;
      process.stderr.write(`lokal-mcp: ${this.problem}. Only the rules find names.\n`);
      return undefined;
    });
    const finder = await this.loading;
    if (!finder) return undefined;
    const names = await finder.find(text);
    this.cache.set(id, names.map((m) => [m.start, m.end]));
    if (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value!);
    return names;
  }

  /** Forgets every text seen so far, and draws a new key. */
  clear(): void {
    this.cache.clear();
    this.key = randomBytes(32);
  }

  /** How many texts are remembered: for tests. */
  get size(): number {
    return this.cache.size;
  }
}
