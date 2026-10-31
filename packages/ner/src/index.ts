/**
 * Names that Samaran's rules do not know, found by a local NER model: "saya di chat sama rianto surya tadi pagi".
 *
 *   import { Samaran } from '@lokal-id/core';
 *   import { NerNames } from '@lokal-id/ner';
 *
 *   const ner = await NerNames.load();          // downloads the model once (125 MB), checked against its SHA-256
 *   const samaran = new Samaran();
 *   samaran.mask(text, await ner.find(text));   // rules and model together
 *
 * The model is Lokal's own: IndoBERT-base fine-tuned for person names on public Indonesian NER corpora and Lokal's
 * synthetic chat, quantized to int8 (see MODEL.md). It runs on the CPU in WebAssembly (onnxruntime-web, no native
 * binaries, no install scripts). The text never leaves the machine.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { cpus, homedir } from 'node:os';
import path from 'node:path';
import type { PiiMatch } from '@lokal-id/core';
import { namesFromSpans, nerChunks, type NerSpan } from '@lokal-id/core/ner';
import * as ort from 'onnxruntime-web';
import { aggregateWords } from './aggregate.ts';
import { WordPiece, type Token } from './wordpiece.ts';

export { aggregateWords, WORD_THRESHOLD, type PersonSpan, type PieceToken } from './aggregate.ts';
export { WordPiece, type Token } from './wordpiece.ts';

interface ModelFile {
  sha256: string;
  size: number;
}

/** The model `NerNames.load()` downloads: where from, and the hash each file must have. */
export const MODEL = {
  name: 'lokal-ner-base-v1',
  url: 'https://github.com/lokal-id/lokal/releases/download/ner-base-v1/',
  files: {
    'model.onnx': {
      sha256: '88eda9302acae1ca4bf3f0261673713af467179fe0de730a8c25dcb2444cd254',
      size: 124610019,
    },
    'tokenizer.json': {
      sha256: 'da8791ba8d7a1459108876b0a0e105c5df39929cc8e7826499f63e74239b0181',
      size: 709027,
    },
    'config.json': {
      sha256: 'a8e49fbae72931c14fb26322aa9cfe5388ab29a9e208589e06d63739e1681d69',
      size: 1291,
    },
  } satisfies Record<string, ModelFile>,
} as const;

export interface NerOptions {
  /**
   * A folder with model.onnx, tokenizer.json, and config.json: an approved copy, or offline use. Without it the model
   * is read from the cache folder (`LOKAL_NER_DIR`, or ~/.cache/lokal-id/ner), and downloaded there if missing.
   */
  modelPath?: string;
  /** The model's confidence below which a name is dropped. Default 0.7. */
  minScore?: number;
  /** Threads for the model. Default: half the CPUs, at most 4. */
  threads?: number;
  /** Set false to fail instead of downloading when the model is not in the cache. */
  download?: boolean;
}

const MAX_TOKENS = 512;
const STRIDE = 64;

/** The folder the model is cached in. */
export function modelDir(): string {
  const base =
    process.env['LOKAL_NER_DIR'] ??
    path.join(
      process.platform === 'win32'
        ? (process.env['LOCALAPPDATA'] ?? path.join(homedir(), 'AppData', 'Local'))
        : (process.env['XDG_CACHE_HOME'] ?? path.join(homedir(), '.cache')),
      'lokal-id',
      'ner',
    );
  return path.join(base, MODEL.name);
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Downloads the model into `dir` (default: the cache folder) unless it is there already, and checks every file
 * against its SHA-256. A file that does not match is deleted and the call fails. Returns the folder.
 */
export async function downloadModel(dir = modelDir()): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (const [name, want] of Object.entries(MODEL.files)) {
    const file = path.join(dir, name);
    if (existsSync(file) && (await sha256(file)) === want.sha256) continue;
    const res = await fetch(MODEL.url + name, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Downloading ${MODEL.url + name} failed: HTTP ${res.status}`);
    // A name nobody can guess, created only if it is not there: a link planted in the folder is never written through.
    const tmp = `${file}.${randomBytes(8).toString('hex')}.part`;
    try {
      await writeFile(tmp, res.body as unknown as AsyncIterable<Uint8Array>, { flag: 'wx' });
      const got = await sha256(tmp);
      if (got !== want.sha256) throw new Error(`${name} from ${MODEL.url} does not match its SHA-256 (got ${got})`);
      await rename(tmp, file);
    } finally {
      await rm(tmp, { force: true });
    }
  }
  return dir;
}

/**
 * The model's files from `dir`, read once and checked in memory: what is used is exactly what was hashed, so a file
 * replaced after the check is never loaded. Undefined when one is missing or does not match.
 */
async function readVerified(dir: string): Promise<Record<string, Buffer> | undefined> {
  const out: Record<string, Buffer> = {};
  for (const [name, want] of Object.entries(MODEL.files)) {
    let buf: Buffer;
    try {
      buf = await readFile(path.join(dir, name));
    } catch {
      return undefined;
    }
    if (createHash('sha256').update(buf).digest('hex') !== want.sha256) return undefined;
    out[name] = buf;
  }
  return out;
}

function softmax(row: Float32Array): Float32Array {
  let max = -Infinity;
  for (const v of row) max = Math.max(max, v);
  const out = new Float32Array(row.length);
  let sum = 0;
  for (let k = 0; k < row.length; k++) sum += out[k] = Math.exp(row[k]! - max);
  for (let k = 0; k < row.length; k++) out[k]! /= sum;
  return out;
}

/** Finds people's names with Lokal's NER model, for `samaran.mask(text, await ner.find(text))`. */
export class NerNames {
  readonly minScore: number;
  private readonly session: ort.InferenceSession;
  private readonly tokenizer: WordPiece;
  private readonly labels: string[];

  private constructor(session: ort.InferenceSession, tokenizer: WordPiece, labels: string[], minScore: number) {
    this.session = session;
    this.tokenizer = tokenizer;
    this.labels = labels;
    this.minScore = minScore;
  }

  /** Loads the model: from `modelPath`, or from the cache folder, downloading it there first if needed. */
  static async load(options: NerOptions = {}): Promise<NerNames> {
    let files: Record<string, Buffer> | undefined;
    if (options.modelPath) {
      // A folder the caller chose (an approved copy, or another model): read as it is.
      const dir = options.modelPath;
      files = Object.fromEntries(
        await Promise.all(Object.keys(MODEL.files).map(async (name) => [name, await readFile(path.join(dir, name))] as const)),
      );
    } else {
      const dir = modelDir();
      files = await readVerified(dir);
      if (!files) {
        if (options.download === false) throw new Error(`The NER model is not in ${dir}; run downloadModel() first`);
        await downloadModel(dir);
        files = await readVerified(dir);
        if (!files) throw new Error(`The NER model in ${dir} changed after it was downloaded and checked`);
      }
    }
    const config = JSON.parse(files['config.json']!.toString('utf8')) as { id2label: Record<string, string> };
    const labels = Object.entries(config.id2label)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, label]) => label);
    const tokenizer = WordPiece.fromTokenizerJson(files['tokenizer.json']!.toString('utf8'));
    ort.env.wasm.numThreads = options.threads ?? Math.max(1, Math.min(4, Math.floor(cpus().length / 2)));
    const session = await ort.InferenceSession.create(files['model.onnx']!, {
      executionProviders: ['wasm'],
    });
    return new NerNames(session, tokenizer, labels, options.minScore ?? 0.7);
  }

  /** The names in `text`, as NAME matches with offsets into it. */
  async find(text: string): Promise<PiiMatch[]> {
    if (!text.trim()) return [];
    const spans: NerSpan[] = [];
    for (const [offset, end] of nerChunks(text)) {
      for (const s of await this.persons(text.slice(offset, end))) {
        spans.push({ start: offset + s.start, end: offset + s.end, score: s.score });
      }
    }
    return namesFromSpans(text, spans, this.minScore);
  }

  /** Frees the model's memory. */
  async close(): Promise<void> {
    await this.session.release();
  }

  // Each token's label probabilities. Text longer than the model reads at once goes in overlapping windows; a token
  // takes its probabilities from the window where it has the most context before it.
  private async probabilities(ids: number[]): Promise<Float32Array[]> {
    const n = MAX_TOKENS - 2;
    const best: Float32Array[] = [];
    for (let start = 0; ; start += n - STRIDE) {
      const piece = [this.tokenizer.cls, ...ids.slice(start, start + n), this.tokenizer.sep];
      const shape = [1, piece.length];
      const feeds = {
        input_ids: new ort.Tensor('int64', BigInt64Array.from(piece, BigInt), shape),
        attention_mask: new ort.Tensor('int64', new BigInt64Array(piece.length).fill(1n), shape),
        token_type_ids: new ort.Tensor('int64', new BigInt64Array(piece.length), shape),
      };
      const logits = (await this.session.run(feeds))['logits']!;
      const data = logits.data as Float32Array;
      const k = logits.dims[2]!;
      for (let i = 0; i < piece.length - 2; i++) {
        if (best[start + i] === undefined || i >= STRIDE) {
          best[start + i] = softmax(data.subarray((i + 1) * k, (i + 2) * k));
        }
      }
      if (start + n >= ids.length) break;
    }
    return best;
  }

  // Person spans by word: each word takes the highest person probability of its pieces (see aggregate.ts).
  private async persons(text: string): Promise<NerSpan[]> {
    const tokens: Token[] = this.tokenizer.encode(text);
    if (!tokens.length) return [];
    return aggregateWords(tokens, await this.probabilities(tokens.map((t) => t.id)), this.labels);
  }
}
