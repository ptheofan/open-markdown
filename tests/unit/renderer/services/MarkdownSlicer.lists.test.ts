/**
 * The edit-mode slicer keeps a list item's continuation lines and nested lists
 * inside the item, instead of splitting them off as stray paragraphs.
 */
import { describe, it, expect } from 'vitest';
import { MarkdownSlicer } from '@renderer/services/MarkdownSlicer';

describe('MarkdownSlicer list items', () => {
  it('keeps continuation lines and nested lists in their item', () => {
    const md = '- one\n  more\n- two\n  - nested';
    const slices = new MarkdownSlicer().slice(md);
    expect(slices.map((s) => s.raw)).toEqual(['- one\n  more', '- two\n  - nested']);
    expect(slices.every((s) => s.type === 'list-item')).toBe(true);
    expect(slices[1]).toMatchObject({ startLine: 2, endLine: 4 });
  });

  it('leaves the blank line between loose items out of the item', () => {
    const md = '1. one\n\n   para\n\n2. two\n\nAfter.';
    const slicer = new MarkdownSlicer();
    const slices = slicer.slice(md);
    expect(slices.map((s) => s.raw)).toEqual(['1. one\n\n   para', '2. two', 'After.']);
    expect(slicer.reassemble(slices)).toBe(md);
  });

  it('round-trips a tight list unchanged', () => {
    const md = '- a\n- b\n  - c\n- d';
    const slicer = new MarkdownSlicer();
    expect(slicer.reassemble(slicer.slice(md))).toBe(md);
  });
});
