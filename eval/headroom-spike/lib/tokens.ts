/**
 * Token counting for the spike. Real, not a stub.
 *
 * Default is a conservative char/4 heuristic so the harness runs without a tokenizer.
 * For the actual spike, swap in the tokenizer for your target model (e.g. tiktoken /
 * @anthropic-ai/tokenizer) so savings ratios reflect real token deltas.
 */

export type Tokenizer = (text: string) => number;

/** Conservative heuristic: ~4 chars/token. Replace with a real tokenizer for the run. */
export const heuristicTokenizer: Tokenizer = (text: string): number => {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
};

/** Active tokenizer. Reassign in run-spike before measuring if a real one is available. */
let active: Tokenizer = heuristicTokenizer;

export function setTokenizer(t: Tokenizer): void {
  active = t;
}

export function countTokens(text: string): number {
  return active(text);
}

/** Savings ratio in [0, 1]. Never negative (clamped per FR-009). */
export function savingsRatio(originalTokens: number, compressedTokens: number): number {
  if (originalTokens <= 0) return 0;
  const ratio = 1 - compressedTokens / originalTokens;
  return ratio > 0 ? ratio : 0;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function p95(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx];
}
