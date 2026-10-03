/**
 * Toggling a task-list marker in markdown source.
 *
 * The rendered checkbox knows its source line; the toggle must flip the one
 * marker on that line and leave every other byte alone -- indentation, list
 * marker, the item's text, its continuation lines, and the line endings.
 */
import { describe, it, expect } from 'vitest';
import { readTaskMarker, toggleTaskAtLine } from '@shared/markdown/taskList';

describe('readTaskMarker', () => {
  it('finds an unchecked marker after a bullet', () => {
    expect(readTaskMarker('- [ ] Buy milk')).toEqual({ stateIndex: 3, checked: false });
  });

  it('finds a checked marker, either case', () => {
    expect(readTaskMarker('- [x] Done')).toEqual({ stateIndex: 3, checked: true });
    expect(readTaskMarker('- [X] Done')).toEqual({ stateIndex: 3, checked: true });
  });

  it('accepts every list marker', () => {
    expect(readTaskMarker('* [ ] a')?.checked).toBe(false);
    expect(readTaskMarker('+ [ ] a')?.checked).toBe(false);
    expect(readTaskMarker('1. [ ] a')?.stateIndex).toBe(4);
    expect(readTaskMarker('12) [x] a')?.stateIndex).toBe(5);
  });

  it('accepts indentation and blockquote prefixes', () => {
    expect(readTaskMarker('    - [ ] nested')?.stateIndex).toBe(7);
    expect(readTaskMarker('> - [ ] quoted')?.stateIndex).toBe(5);
    expect(readTaskMarker('> > 1. [x] deep')?.stateIndex).toBe(8);
  });

  it('tolerates a trailing carriage return', () => {
    expect(readTaskMarker('- [ ] Task\r')).toEqual({ stateIndex: 3, checked: false });
  });

  it('allows a marker with nothing after it', () => {
    expect(readTaskMarker('- [ ]')).toEqual({ stateIndex: 3, checked: false });
  });

  it('rejects lines that are not task items', () => {
    expect(readTaskMarker('- Regular item')).toBeNull();
    expect(readTaskMarker('[ ] no list marker')).toBeNull();
    expect(readTaskMarker('- [ ]not a task')).toBeNull();
    expect(readTaskMarker('-[ ] no space after bullet')).toBeNull();
    expect(readTaskMarker('- [y] unknown state')).toBeNull();
    expect(readTaskMarker('# [ ] heading')).toBeNull();
    expect(readTaskMarker('')).toBeNull();
  });
});

describe('toggleTaskAtLine', () => {
  it('checks an unchecked item', () => {
    expect(toggleTaskAtLine('- [ ] Buy milk', 0)).toBe('- [x] Buy milk');
  });

  it('unchecks a checked item, whatever its case', () => {
    expect(toggleTaskAtLine('- [x] Done', 0)).toBe('- [ ] Done');
    expect(toggleTaskAtLine('- [X] Done', 0)).toBe('- [ ] Done');
  });

  it('touches only the requested line', () => {
    const md = ['# Plan', '', '- [ ] one', '- [x] two', '- [ ] three'].join('\n');
    const result = toggleTaskAtLine(md, 3);
    expect(result).toBe(['# Plan', '', '- [ ] one', '- [ ] two', '- [ ] three'].join('\n'));
  });

  it('handles nested items with mixed markers', () => {
    const md = ['- [ ] parent', '  * [x] child a', '  + [ ] child b', '    1. [ ] grandchild'].join('\n');
    expect(toggleTaskAtLine(md, 1)?.split('\n')[1]).toBe('  * [ ] child a');
    expect(toggleTaskAtLine(md, 3)?.split('\n')[3]).toBe('    1. [x] grandchild');
  });

  it('leaves a multi-line item\'s continuation lines alone', () => {
    const md = ['- [ ] A long item', '  that wraps onto a second line', '', '  and has a paragraph'].join('\n');
    const result = toggleTaskAtLine(md, 0);
    expect(result).toBe(['- [x] A long item', '  that wraps onto a second line', '', '  and has a paragraph'].join('\n'));
  });

  it('keeps CRLF line endings', () => {
    const md = '- [ ] one\r\n- [ ] two\r\n';
    expect(toggleTaskAtLine(md, 1)).toBe('- [ ] one\r\n- [x] two\r\n');
  });

  it('keeps a trailing newline and other whitespace', () => {
    expect(toggleTaskAtLine('- [ ] one\n\n', 0)).toBe('- [x] one\n\n');
    expect(toggleTaskAtLine('\t- [ ]   spaced  ', 0)).toBe('\t- [x]   spaced  ');
  });

  it('works inside blockquotes', () => {
    expect(toggleTaskAtLine('> - [ ] quoted', 0)).toBe('> - [x] quoted');
  });

  it('returns null when the line is not a task item', () => {
    expect(toggleTaskAtLine('- Regular item', 0)).toBeNull();
    expect(toggleTaskAtLine('# Heading\n- [ ] task', 0)).toBeNull();
  });

  it('returns null for a line outside the document', () => {
    expect(toggleTaskAtLine('- [ ] only', 1)).toBeNull();
    expect(toggleTaskAtLine('- [ ] only', -1)).toBeNull();
  });

  it('round-trips', () => {
    const md = '- [ ] a\n- [x] b';
    const once = toggleTaskAtLine(md, 0)!;
    expect(toggleTaskAtLine(once, 0)).toBe(md);
  });
});
