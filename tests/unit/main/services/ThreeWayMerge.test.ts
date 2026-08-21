import { describe, it, expect } from 'vitest';
import { splitBlocks, joinBlocks, threeWayMerge, applyResolutions, twoWayReview } from '@main/services/ThreeWayMerge';
import type { MergeOutcome } from '@main/services/ThreeWayMerge';

/** Only the differences no default can settle. */
const conflictsOf = (outcome: MergeOutcome): MergeOutcome['changes'] =>
  outcome.changes.filter((change) => change.kind === 'conflict');

describe('splitBlocks', () => {
  it('keeps a fenced code block whole despite its blank lines', () => {
    const md = 'intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nafter\n';
    expect(splitBlocks(md)).toEqual([
      'intro',
      '```ts\nconst a = 1;\n\nconst b = 2;\n```',
      'after',
    ]);
  });

  it('keeps a list together as one block', () => {
    expect(splitBlocks('- one\n- two\n\nafter\n')).toEqual(['- one\n- two', 'after']);
  });

  it('keeps a table together as one block', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n';
    expect(splitBlocks(md)).toEqual(['| a | b |\n| --- | --- |\n| 1 | 2 |', 'after']);
  });

  it('round-trips through joinBlocks', () => {
    const md = '# Title\n\npara\n\n- a\n- b\n';
    expect(joinBlocks(splitBlocks(md))).toBe(md);
  });
});

describe('threeWayMerge', () => {
  it('takes both sides when they touched different blocks', () => {
    const result = threeWayMerge({
      localBase: 'one\n\ntwo\n\nthree\n',
      local: 'one EDITED\n\ntwo\n\nthree\n',
      remoteBase: 'one\n\ntwo\n\nthree\n',
      remote: 'one\n\ntwo\n\nthree EDITED\n',
    });

    expect(conflictsOf(result)).toEqual([]);
    expect(joinBlocks(result.blocks)).toBe('one EDITED\n\ntwo\n\nthree EDITED\n');
  });

  it('applies a deletion made only in the Doc', () => {
    const result = threeWayMerge({
      localBase: 'one\n\ntwo\n\nthree\n',
      local: 'one\n\ntwo\n\nthree\n',
      remoteBase: 'one\n\ntwo\n\nthree\n',
      remote: 'one\n\nthree\n',
    });

    expect(conflictsOf(result)).toEqual([]);
    expect(joinBlocks(result.blocks)).toBe('one\n\nthree\n');
  });

  it('raises one conflict when both sides changed the same block', () => {
    const result = threeWayMerge({
      localBase: 'one\n\ntwo\n',
      local: 'one\n\ntwo LOCAL\n',
      remoteBase: 'one\n\ntwo\n',
      remote: 'one\n\ntwo REMOTE\n',
    });

    expect(conflictsOf(result)).toHaveLength(1);
    expect(conflictsOf(result)[0]).toMatchObject({ local: 'two LOCAL', remote: 'two REMOTE' });
  });

  it('does not call it a conflict when both sides made the same edit', () => {
    const result = threeWayMerge({
      localBase: 'one\n\ntwo\n',
      local: 'one\n\ntwo SAME\n',
      remoteBase: 'one\n\ntwo\n',
      remote: 'one\n\ntwo SAME\n',
    });

    expect(conflictsOf(result)).toEqual([]);
    expect(joinBlocks(result.blocks)).toBe('one\n\ntwo SAME\n');
  });

  it('keeps local source that the Doc can only represent differently', () => {
    // The Doc has no notion of a mermaid fence -- it holds a PNG. The remote
    // baseline records that, so an untouched diagram raises no hunk and the
    // fence in the local file survives a merge untouched. Only the prose the
    // collaborator actually edited comes back.
    const result = threeWayMerge({
      localBase: '# Title\n\n```mermaid\ngraph A\n```\n\nProse\n',
      local: '# Title\n\n```mermaid\ngraph A\n```\n\nProse\n',
      remoteBase: '# Title\n\n![](https://drive/x)\n\nProse\n',
      remote: '# Title\n\n![](https://drive/x)\n\nProse edited\n',
    });

    expect(conflictsOf(result)).toEqual([]);
    expect(joinBlocks(result.blocks)).toBe('# Title\n\n```mermaid\ngraph A\n```\n\nProse edited\n');
  });

  it('lands a remote edit correctly when one local block became two remote ones', () => {
    // The real shape: a mermaid fence reaches the Doc as an image *plus* a
    // "view in mermaid.live" link, so every block after it sits at a different
    // index on the two sides. Without translating remote hunks into local
    // coordinates, the collaborator's prose edit lands on the wrong block.
    const result = threeWayMerge({
      localBase: '# Title\n\n```mermaid\ngraph A\n```\n\nProse\n',
      local: '# Title\n\n```mermaid\ngraph A\n```\n\nProse\n',
      remoteBase: '# Title\n\n![](https://drive/x)\n\n[Edit](https://mermaid.live/a)\n\nProse\n',
      remote: '# Title\n\n![](https://drive/x)\n\n[Edit](https://mermaid.live/a)\n\nProse edited\n',
    });

    expect(conflictsOf(result)).toEqual([]);
    expect(joinBlocks(result.blocks)).toBe('# Title\n\n```mermaid\ngraph A\n```\n\nProse edited\n');
  });

  it('removes a block the Doc dropped even when the dialects differ elsewhere', () => {
    const result = threeWayMerge({
      localBase: '# Title\n\n```mermaid\ngraph A\n```\n\nProse\n',
      local: '# Title\n\n```mermaid\ngraph A\n```\n\nProse\n',
      remoteBase: '# Title\n\n![](https://drive/x)\n\nProse\n',
      remote: '# Title\n\n![](https://drive/x)\n',
    });

    expect(conflictsOf(result)).toEqual([]);
    expect(joinBlocks(result.blocks)).toBe('# Title\n\n```mermaid\ngraph A\n```\n');
  });
});

describe('applyResolutions', () => {
  const merged = threeWayMerge({
    localBase: 'one\n\ntwo\n',
    local: 'one\n\ntwo LOCAL\n',
    remoteBase: 'one\n\ntwo\n',
    remote: 'one\n\ntwo REMOTE\n',
  });

  it('keeps the local side', () => {
    const blocks = applyResolutions(merged.blocks, merged.changes, ['local']);
    expect(joinBlocks(blocks)).toBe('one\n\ntwo LOCAL\n');
  });

  it('keeps the remote side', () => {
    const blocks = applyResolutions(merged.blocks, merged.changes, ['remote']);
    expect(joinBlocks(blocks)).toBe('one\n\ntwo REMOTE\n');
  });

  it('keeps both, local first', () => {
    const blocks = applyResolutions(merged.blocks, merged.changes, ['both']);
    expect(joinBlocks(blocks)).toBe('one\n\ntwo LOCAL\n\ntwo REMOTE\n');
  });
});

describe('threeWayMerge change reporting', () => {
  it('reports a change for every edit, not only the clashing ones', () => {
    const result = threeWayMerge({
      localBase: 'one\n\ntwo\n\nthree\n',
      local: 'one EDITED\n\ntwo\n\nthree\n',
      remoteBase: 'one\n\ntwo\n\nthree\n',
      remote: 'one\n\ntwo\n\nthree EDITED\n',
    });

    expect(result.changes).toEqual([
      { index: 0, kind: 'local-only', local: 'one EDITED', remote: 'one', choice: 'local' },
      { index: 2, kind: 'remote-only', local: 'three', remote: 'three EDITED', choice: 'remote' },
    ]);
  });

  it('marks a block both sides rewrote as a conflict', () => {
    const result = threeWayMerge({
      localBase: 'one\n\ntwo\n',
      local: 'one MINE\n\ntwo\n',
      remoteBase: 'one\n\ntwo\n',
      remote: 'one THEIRS\n\ntwo\n',
    });

    expect(result.changes).toEqual([
      { index: 0, kind: 'conflict', local: 'one MINE', remote: 'one THEIRS', choice: 'local' },
    ]);
  });

  it('reports an empty side when one of them deleted the block', () => {
    const result = threeWayMerge({
      localBase: 'one\n\ntwo\n',
      local: 'one\n\ntwo\n',
      remoteBase: 'one\n\ntwo\n',
      remote: 'one\n',
    });

    expect(result.changes).toEqual([
      { index: 1, kind: 'remote-only', local: 'two', remote: '', choice: 'remote' },
    ]);
  });
});

describe('twoWayReview', () => {
  it('finds nothing when the two sides already agree', () => {
    const result = twoWayReview('one\n\ntwo\n', 'one\n\ntwo\n');
    expect(result.changes).toEqual([]);
    expect(joinBlocks(result.blocks)).toBe('one\n\ntwo\n');
  });

  it('reports a block only the Doc has, defaulting to the file', () => {
    const result = twoWayReview('one\n', 'one\n\nextra\n');
    expect(result.changes).toEqual([
      { index: 1, kind: 'remote-only', local: '', remote: 'extra', choice: 'local' },
    ]);
    // Left at its default, the file wins and the Doc's block goes.
    expect(joinBlocks(result.blocks)).toBe('one\n');
  });

  it('reports a block only the file has', () => {
    const result = twoWayReview('one\n\nmine\n', 'one\n');
    expect(result.changes).toEqual([
      { index: 1, kind: 'local-only', local: 'mine', remote: '', choice: 'local' },
    ]);
  });

  it('reports a differing block as a conflict', () => {
    const result = twoWayReview('one\n\ntwo MINE\n', 'one\n\ntwo THEIRS\n');
    expect(result.changes).toEqual([
      { index: 1, kind: 'conflict', local: 'two MINE', remote: 'two THEIRS', choice: 'local' },
    ]);
  });

  it('lets the Doc win when the choice is flipped', () => {
    const result = twoWayReview('one\n\ntwo MINE\n', 'one\n\ntwo THEIRS\n');
    const blocks = applyResolutions(result.blocks, result.changes, ['remote']);
    expect(joinBlocks(blocks)).toBe('one\n\ntwo THEIRS\n');
  });
});

describe('splitBlocks on markdown written without blank lines', () => {
  // A real synced document had headings, prose and tables on consecutive
  // lines with no blank line anywhere. Splitting only on blank lines turned
  // whole sections into single blocks, so nothing lined up against the Doc's
  // paragraph-per-block conversion and every remote edit looked like an
  // insertion into a void.
  it('splits a heading from the prose directly below it', () => {
    expect(splitBlocks('# Title\nProse here\n')).toEqual(['# Title', 'Prose here']);
  });

  it('splits consecutive headings', () => {
    expect(splitBlocks('# One\n## Two\n')).toEqual(['# One', '## Two']);
  });

  it('splits a table from the heading directly above it', () => {
    expect(splitBlocks('### H\n| a | b |\n| --- | --- |\n| 1 | 2 |\n')).toEqual([
      '### H',
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
    ]);
  });

  it('splits a list from the prose directly above it', () => {
    expect(splitBlocks('intro\n- a\n- b\n')).toEqual(['intro', '- a\n- b']);
  });

  it('splits prose that follows a table', () => {
    expect(splitBlocks('| a |\n| --- |\nafter\n')).toEqual(['| a |\n| --- |', 'after']);
  });

  it('keeps consecutive prose lines as one paragraph, the way the Doc does', () => {
    expect(splitBlocks('one line\ntwo line\n')).toEqual(['one line\ntwo line']);
  });

  it('splits a horizontal rule out on its own', () => {
    expect(splitBlocks('intro\n\n---\nafter\n')).toEqual(['intro', '---', 'after']);
  });

  it('treats dashes under a line of prose as a setext heading, not a rule', () => {
    expect(splitBlocks('Title\n---\nafter\n')).toEqual(['Title\n---', 'after']);
  });

  it('splits a blockquote from the prose above it', () => {
    expect(splitBlocks('intro\n> quoted\n> more\n')).toEqual(['intro', '> quoted\n> more']);
  });

  it('splits a fence that starts immediately after prose', () => {
    expect(splitBlocks('intro\n```ts\ncode\n```\n')).toEqual(['intro', '```ts\ncode\n```']);
  });
});
