/**
 * BERT's WordPiece tokenizer, as Hugging Face's `tokenizers` runs it for IndoBERT (BertNormalizer with lowercase,
 * BertPreTokenizer, WordPiece), with each token's [start, end) offsets into the original text in UTF-16 units.
 */

export interface Token {
  id: number;
  start: number;
  end: number;
  /** A "##" piece: it continues the word of the token before it. */
  sub: boolean;
}

interface Char {
  c: string;
  /** Where the character it came from starts and ends in the original text. */
  start: number;
  end: number;
}

// What `tokenizers` drops as a control character: every "Other" category, but not a tab or a line break.
const CONTROL = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}]/u;
const WHITESPACE = /\s/u;
const MARK = /\p{Mn}/u;
const PUNCT = /\p{P}/u;

// The CJK ideograph blocks BERT puts spaces around, so each is a word of its own.
function isChinese(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) || (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

// BERT counts ASCII symbols such as "$", "+", "^", and "`" as punctuation too.
function isPunctuation(c: string): boolean {
  const cp = c.codePointAt(0)!;
  return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126) || PUNCT.test(c);
}

export class WordPiece {
  readonly vocab: Map<string, number>;
  readonly unk: number;
  readonly cls: number;
  readonly sep: number;
  private readonly maxCharsPerWord: number;

  constructor(vocab: Map<string, number>, maxCharsPerWord = 100) {
    this.vocab = vocab;
    this.maxCharsPerWord = maxCharsPerWord;
    const id = (t: string) => {
      const v = vocab.get(t);
      if (v === undefined) throw new Error(`The vocabulary has no ${t} token`);
      return v;
    };
    this.unk = id('[UNK]');
    this.cls = id('[CLS]');
    this.sep = id('[SEP]');
  }

  /** From a `tokenizer.json` (Hugging Face `tokenizers`) with a WordPiece model. */
  static fromTokenizerJson(json: string): WordPiece {
    const t = JSON.parse(json) as { model?: { type?: string; vocab?: Record<string, number>; max_input_chars_per_word?: number } };
    if (t.model?.type !== 'WordPiece' || !t.model.vocab) throw new Error('tokenizer.json does not hold a WordPiece model');
    return new WordPiece(new Map(Object.entries(t.model.vocab)), t.model.max_input_chars_per_word ?? 100);
  }

  /** The tokens of `text`, without [CLS] and [SEP]. */
  encode(text: string): Token[] {
    const out: Token[] = [];
    for (const word of this.words(text)) this.wordPieces(word, out);
    return out;
  }

  // Normalizes as BertNormalizer does (drop control characters, spaces for whitespace, spaces around CJK, lower case,
  // no accents), then splits into words at whitespace and around each punctuation mark.
  private words(text: string): Char[][] {
    const words: Char[][] = [];
    let word: Char[] = [];
    const flush = () => {
      if (word.length) words.push(word);
      word = [];
    };
    let i = 0;
    for (const ch of text) {
      const start = i;
      const end = (i += ch.length);
      const cp = ch.codePointAt(0)!;
      const breakChar = ch === '\t' || ch === '\n' || ch === '\r';
      if (!breakChar && (cp === 0 || cp === 0xfffd || CONTROL.test(ch))) continue;
      if (breakChar || WHITESPACE.test(ch)) {
        flush();
        continue;
      }
      if (isChinese(cp)) {
        flush();
        words.push([{ c: ch, start, end }]);
        continue;
      }
      for (const c of ch.toLowerCase().normalize('NFD')) {
        if (MARK.test(c)) continue;
        if (isPunctuation(c)) {
          flush();
          words.push([{ c, start, end }]);
        } else {
          word.push({ c, start, end });
        }
      }
    }
    flush();
    return words;
  }

  // Greedy longest match first; a word with a piece the vocabulary lacks is one [UNK].
  private wordPieces(word: Char[], out: Token[]): void {
    const unknown = () => {
      out.push({ id: this.unk, start: word[0]!.start, end: word[word.length - 1]!.end, sub: false });
    };
    if (word.length > this.maxCharsPerWord) return unknown();
    const pieces: Token[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let found: number | undefined;
      while (start < end) {
        let piece = '';
        for (let k = start; k < end; k++) piece += word[k]!.c;
        if (start > 0) piece = '##' + piece;
        found = this.vocab.get(piece);
        if (found !== undefined) break;
        end--;
      }
      if (found === undefined) return unknown();
      pieces.push({ id: found, start: word[start]!.start, end: word[end - 1]!.end, sub: start > 0 });
      start = end;
    }
    out.push(...pieces);
  }
}
