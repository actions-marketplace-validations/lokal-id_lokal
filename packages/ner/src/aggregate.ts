/**
 * Word-level grouping of the model's token labels into person spans. The model labels word pieces; a name can come
 * out split when one piece of a word leans the other way ("kira" of "kirapuspa" at 0.01, "##pus" at 0.53, "##pa" at
 * 0.86), and the word, or the rest of the name after it, is lost. Here each word takes the highest person probability
 * of its pieces, and consecutive person words are one name unless a word leans to B- (a new name starts). The same
 * function as `aggregate_words` in Python's lokal.samaran._onnx_ner, checked by parity vectors.
 */

/** A token: its offsets, and whether it continues the word before it (a "##" piece). */
export interface PieceToken {
  start: number;
  end: number;
  sub: boolean;
}

/** A person span: offsets of its first and last word, and the mean of its words' person probabilities. */
export interface PersonSpan {
  start: number;
  end: number;
  score: number;
}

/** The person probability a word needs: chosen on the development sets (0.3 found no more names there). */
export const WORD_THRESHOLD = 0.5;

/**
 * `probs[i]` is token i's probability for each label, in the order of `labels` ("O", "B-PER", "I-PER", ...).
 * Labels other than PER are ignored.
 */
export function aggregateWords(
  tokens: readonly PieceToken[], probs: ArrayLike<ArrayLike<number>>, labels: readonly string[], threshold = WORD_THRESHOLD,
): PersonSpan[] {
  const b = labels.indexOf('B-PER');
  const i = labels.indexOf('I-PER');
  const words: Array<{ start: number; end: number; per: number; begins: boolean }> = [];
  tokens.forEach((t, k) => {
    const p = probs[k]!;
    const per = (b >= 0 ? p[b]! : 0) + (i >= 0 ? p[i]! : 0);
    const last = words[words.length - 1];
    if (t.sub && last) {
      last.end = t.end;
      last.per = Math.max(last.per, per);
    } else {
      words.push({ start: t.start, end: t.end, per, begins: b >= 0 && i >= 0 && p[b]! > p[i]! });
    }
  });
  const out: Array<{ start: number; end: number; scores: number[] }> = [];
  let current: { start: number; end: number; scores: number[] } | undefined;
  for (const w of words) {
    if (w.per < threshold) {
      current = undefined;
    } else if (current && !w.begins) {
      current.end = w.end;
      current.scores.push(w.per);
    } else {
      current = { start: w.start, end: w.end, scores: [w.per] };
      out.push(current);
    }
  }
  return out.map((e) => ({ start: e.start, end: e.end, score: e.scores.reduce((x, y) => x + y, 0) / e.scores.length }));
}
