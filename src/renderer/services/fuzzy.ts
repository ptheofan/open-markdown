/**
 * Fuzzy matching for the quick switcher.
 *
 * Every character of the query has to appear in the text, in order. The
 * score rewards runs of consecutive matches and matches at the start of a
 * word (after a separator), and penalises gaps, so "rdm" prefers README.md
 * over a path that merely contains those letters far apart.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices of the matched characters in the text */
  positions: number[];
}

const SEPARATORS = new Set([' ', '/', '\\', '-', '_', '.', ':']);

/**
 * Score the query against the text, or null when it does not match.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return { score: 0, positions: [] };
  if (q.length > t.length) return null;

  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let lastMatch = -2;

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    // Prefer a match at a word start, else the nearest one
    let found = -1;
    for (let k = ti; k < t.length; k++) {
      if (t[k] !== ch) continue;
      if (found === -1) found = k;
      if (k === 0 || SEPARATORS.has(t[k - 1]!)) {
        found = k;
        break;
      }
      // Beyond a few characters, settle for the nearest
      if (k - found > 8) break;
    }
    if (found === -1) return null;

    if (found === lastMatch + 1) score += 8;
    else if (found === 0 || SEPARATORS.has(t[found - 1]!)) score += 6;
    else score += 1;
    score -= Math.min(found - ti, 10) * 0.5;

    positions.push(found);
    lastMatch = found;
    ti = found + 1;
  }

  // Shorter texts with the same letters are better matches
  score -= t.length * 0.01;
  return { score, positions };
}

/**
 * Rank candidates by how well they match the query, best first. Items that
 * do not match are left out. With an empty query every item is returned in
 * its original order.
 */
export function rankByFuzzy<T>(
  query: string,
  items: T[],
  textOf: (item: T) => string
): Array<{ item: T; match: FuzzyMatch }> {
  const ranked: Array<{ item: T; match: FuzzyMatch; order: number }> = [];
  items.forEach((item, order) => {
    const match = fuzzyMatch(query, textOf(item));
    if (match) ranked.push({ item, match, order });
  });
  if (query.trim() === '') return ranked.map(({ item, match }) => ({ item, match }));
  ranked.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
  return ranked.map(({ item, match }) => ({ item, match }));
}
