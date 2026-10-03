/**
 * Extracting one section -- a heading and what sits under it -- from markdown.
 */
import { describe, it, expect } from 'vitest';
import { extractSection } from '@shared/markdown/sections';

const DOC = [
  '# Title',            // 0
  '',                   // 1
  'Intro paragraph.',   // 2
  '',                   // 3
  '## Setup',           // 4
  '',                   // 5
  'Install things.',    // 6
  '',                   // 7
  '### Details',        // 8
  '',                   // 9
  'More.',              // 10
  '',                   // 11
  '## Usage',           // 12
  '',                   // 13
  'Run it.',            // 14
  '',                   // 15
].join('\n');

describe('extractSection', () => {
  it('runs from the heading to the next heading of the same level', () => {
    expect(extractSection(DOC, 4)).toBe(['## Setup', '', 'Install things.', '', '### Details', '', 'More.'].join('\n'));
  });

  it('includes deeper headings and stops at a shallower one', () => {
    expect(extractSection(DOC, 8)).toBe(['### Details', '', 'More.'].join('\n'));
  });

  it('runs to the end of the document for the last section', () => {
    expect(extractSection(DOC, 12)).toBe(['## Usage', '', 'Run it.'].join('\n'));
  });

  it('takes the whole document for a top-level heading with no sibling', () => {
    const result = extractSection(DOC, 0);
    expect(result?.startsWith('# Title')).toBe(true);
    expect(result?.endsWith('Run it.')).toBe(true);
  });

  it('ignores hashes inside fenced code', () => {
    const md = ['## A', '', '```sh', '# not a heading', '## nor this', '```', '', 'tail', '', '## B'].join('\n');
    expect(extractSection(md, 0)).toBe(['## A', '', '```sh', '# not a heading', '## nor this', '```', '', 'tail'].join('\n'));
  });

  it('matches fence lengths, so a longer fence can wrap a shorter one', () => {
    const md = ['## A', '````md', '```', '# inner', '```', '````', '## B'].join('\n');
    expect(extractSection(md, 0)).toBe(['## A', '````md', '```', '# inner', '```', '````'].join('\n'));
  });

  it('handles tilde fences', () => {
    const md = ['## A', '~~~', '# x', '~~~', '## B'].join('\n');
    expect(extractSection(md, 0)).toBe(['## A', '~~~', '# x', '~~~'].join('\n'));
  });

  it('returns null when the line is not a heading', () => {
    expect(extractSection(DOC, 2)).toBeNull();
    expect(extractSection(DOC, 99)).toBeNull();
    expect(extractSection('#hashtag', 0)).toBeNull();
    expect(extractSection('####### seven', 0)).toBeNull();
  });

  it('accepts a heading with no text and a heading indented up to three spaces', () => {
    expect(extractSection('##\nbody', 0)).toBe('##\nbody');
    expect(extractSection('   ## indented\nbody\n## next', 0)).toBe('   ## indented\nbody');
  });
});
