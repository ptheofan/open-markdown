import { describe, it, expect } from 'vitest';
import { fuzzyMatch, rankByFuzzy } from '@renderer/services/fuzzy';

describe('fuzzyMatch', () => {
  it('matches characters in order, case-insensitively', () => {
    expect(fuzzyMatch('rdm', 'README.md')?.positions).toEqual([0, 3, 7]);
    expect(fuzzyMatch('xyz', 'README.md')).toBeNull();
    expect(fuzzyMatch('dme', 'README.md')).toBeNull();
  });

  it('matches everything with an empty query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });

  it('prefers consecutive and word-start matches', () => {
    const exact = fuzzyMatch('plan', 'docs/plan.md')!.score;
    const scattered = fuzzyMatch('plan', 'people/landing/analytics.md')!.score;
    expect(exact).toBeGreaterThan(scattered);
  });

  it('prefers the shorter of two otherwise equal matches', () => {
    expect(fuzzyMatch('a', 'a.md')!.score).toBeGreaterThan(fuzzyMatch('a', 'a-very-long-name.md')!.score);
  });
});

describe('rankByFuzzy', () => {
  const items = ['src/app.ts', 'docs/plan.md', 'README.md', 'notes/planning-2026.md'];

  it('keeps the original order for an empty query', () => {
    expect(rankByFuzzy('', items, (s) => s).map((r) => r.item)).toEqual(items);
  });

  it('drops non-matches and ranks the rest best first', () => {
    const ranked = rankByFuzzy('plan', items, (s) => s).map((r) => r.item);
    expect(ranked[0]).toBe('docs/plan.md');
    expect(ranked).toContain('notes/planning-2026.md');
    expect(ranked).not.toContain('README.md');
  });
});
