/**
 * Fence info strings and line decoration of highlighted code.
 */
import {
  parseCodeBlockInfo,
  parseLineRanges,
  splitHighlightedLines,
  wrapCodeLines,
} from '@plugins/builtin/codeBlockInfo';
import { describe, it, expect } from 'vitest';

describe('parseLineRanges', () => {
  it('reads single lines and ranges', () => {
    expect([...parseLineRanges('1,3-5, 8')].sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 8]);
  });

  it('ignores junk and inverted ranges', () => {
    expect([...parseLineRanges('a, 5-3, 2')]).toEqual([2]);
  });
});

describe('parseCodeBlockInfo', () => {
  it('takes the language from the first word', () => {
    expect(parseCodeBlockInfo('ts', '')).toEqual({ lang: 'ts', title: null, highlightLines: new Set() });
  });

  it('reads title=, filename= and file=, quoted or bare', () => {
    expect(parseCodeBlockInfo('bash', 'title="setup.sh"').title).toBe('setup.sh');
    expect(parseCodeBlockInfo('bash', "filename='a b.sh'").title).toBe('a b.sh');
    expect(parseCodeBlockInfo('bash', 'file=run.sh').title).toBe('run.sh');
    expect(parseCodeBlockInfo('bash', 'untitled=x').title).toBeNull();
  });

  it('reads {ranges} after the language or glued to it', () => {
    expect([...parseCodeBlockInfo('ts', '{3-5}').highlightLines]).toEqual([3, 4, 5]);
    const glued = parseCodeBlockInfo('ts{1,2}', '');
    expect(glued.lang).toBe('ts');
    expect([...glued.highlightLines]).toEqual([1, 2]);
  });

  it('reads highlight= and hl_lines= too', () => {
    expect([...parseCodeBlockInfo('py', 'highlight="1,3"').highlightLines]).toEqual([1, 3]);
    expect([...parseCodeBlockInfo('py', 'hl_lines="2 4"').highlightLines]).toEqual([2, 4]);
  });

  it('copes with attributes and no language', () => {
    const info = parseCodeBlockInfo('title="x.txt"', '{2}');
    expect(info.lang).toBe('');
    expect(info.title).toBe('x.txt');
    expect([...info.highlightLines]).toEqual([2]);
  });
});

describe('splitHighlightedLines', () => {
  it('splits plain text at newlines', () => {
    expect(splitHighlightedLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('closes and reopens spans across a newline', () => {
    const html = '<span class="hljs-comment">/* a\nb */</span> x';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="hljs-comment">/* a</span>',
      '<span class="hljs-comment">b */</span> x',
    ]);
  });

  it('handles nested spans', () => {
    const html = '<span class="a">1<span class="b">2\n3</span>4</span>';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="a">1<span class="b">2</span></span>',
      '<span class="a"><span class="b">3</span>4</span>',
    ]);
  });

  it('keeps a trailing empty line', () => {
    expect(splitHighlightedLines('a\n')).toEqual(['a', '']);
  });
});

describe('wrapCodeLines', () => {
  it('wraps every line and marks the highlighted ones, keeping the text intact', () => {
    const out = wrapCodeLines('one\ntwo\nthree\n', { highlightLines: new Set([2]) });
    expect(out).toBe(
      '<span class="code-line">one</span>\n' +
        '<span class="code-line code-line-highlighted">two</span>\n' +
        '<span class="code-line">three</span>\n'
    );
    expect(out.replace(/<[^>]+>/g, '')).toBe('one\ntwo\nthree\n');
  });

  it('marks diff additions and deletions by their leading span', () => {
    const html =
      '<span class="hljs-deletion">- old</span>\n<span class="hljs-addition">+ new</span>\n same\n';
    const out = wrapCodeLines(html, { diff: true });
    expect(out).toContain('<span class="code-line code-line-deletion"><span class="hljs-deletion">- old</span></span>');
    expect(out).toContain('<span class="code-line code-line-addition"><span class="hljs-addition">+ new</span></span>');
    expect(out).toContain('<span class="code-line"> same</span>');
  });
});
