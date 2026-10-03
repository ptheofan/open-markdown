/**
 * The edit-mode slicer treats front matter as a single block.
 */
import { describe, it, expect } from 'vitest';
import { MarkdownSlicer } from '@renderer/services/MarkdownSlicer';

describe('MarkdownSlicer front matter', () => {
  it('keeps the whole block together instead of a rule and a paragraph', () => {
    const slices = new MarkdownSlicer().slice('---\nname: x\ntags:\n  - a\n---\n\n# Title\n\nBody');
    expect(slices[0]).toMatchObject({ type: 'unknown', startLine: 0, endLine: 5 });
    expect(slices[0]?.raw).toBe('---\nname: x\ntags:\n  - a\n---');
    expect(slices[1]).toMatchObject({ type: 'heading', raw: '# Title' });
  });

  it('leaves a plain horizontal rule alone', () => {
    const slices = new MarkdownSlicer().slice('---\n\ntext');
    expect(slices[0]?.type).toBe('hr');
  });
});
