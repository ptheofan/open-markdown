/**
 * @vitest-environment jsdom
 *
 * Selection handling when the viewer swaps documents.
 *
 * Select All leaves a range spanning the content container. Replacing that
 * container's children does not collapse the range, so the next document opens
 * looking fully selected. A re-render of the *same* file — a watched file
 * changing on disk — must not disturb whatever the user has selected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMarkdownViewer, type MarkdownViewer } from '@renderer/components/MarkdownViewer';

describe('MarkdownViewer selection handling', () => {
  let container: HTMLElement;
  let viewer: MarkdownViewer;
  let removeAllRanges: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '<div id="markdown-content"></div>';
    container = document.getElementById('markdown-content')!;
    viewer = createMarkdownViewer(container);

    removeAllRanges = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);
  });

  it('clears the selection when a different document is opened', async () => {
    await viewer.render('# First', '/docs/first.md');
    removeAllRanges.mockClear();

    await viewer.render('# Second', '/docs/second.md');

    expect(removeAllRanges).toHaveBeenCalled();
  });

  it('leaves the selection alone when the same file re-renders', async () => {
    await viewer.render('# First', '/docs/first.md');
    removeAllRanges.mockClear();

    // What a file-watch reload looks like: same path, new content.
    await viewer.render('# First, edited', '/docs/first.md');

    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  it('leaves the selection alone when no path is given', async () => {
    await viewer.render('# First', '/docs/first.md');
    removeAllRanges.mockClear();

    await viewer.render('# Untitled');

    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  it('still renders the incoming document', async () => {
    await viewer.render('# First', '/docs/first.md');
    await viewer.render('# Second', '/docs/second.md');

    expect(container.innerHTML).toContain('Second');
    expect(container.innerHTML).not.toContain('First');
  });
});
