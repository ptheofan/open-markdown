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

/**
 * Link routing.
 *
 * Every click on a link inside the document is intercepted: default navigation
 * would replace the whole app page with the target, blanking the viewer. Where
 * the click goes next depends on the href — the system browser, a scroll within
 * the document, or opening another markdown file.
 */
describe('MarkdownViewer link handling', () => {
  let container: HTMLElement;
  let viewer: MarkdownViewer;
  let openExternal: ReturnType<typeof vi.fn>;
  let resolvePath: ReturnType<typeof vi.fn>;
  let onOpenLocalFile: ReturnType<typeof vi.fn>;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  const BASE = '/docs/project/README.md';

  beforeEach(() => {
    document.body.innerHTML = '<div id="markdown-content"></div>';
    container = document.getElementById('markdown-content')!;

    openExternal = vi.fn();
    resolvePath = vi.fn();
    onOpenLocalFile = vi.fn();
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    // jsdom implements neither of these; the real renderer is Chromium.
    (globalThis as { CSS?: { escape(v: string): string } }).CSS ??= {
      escape: (value: string) => value.replace(/[^\w-]/gu, (c) => `\\${c}`),
    };

    (window as unknown as { electronAPI: unknown }).electronAPI = {
      shell: { openExternal },
      assets: { resolve: vi.fn(() => null), resolvePath },
    };

    viewer = createMarkdownViewer(container);
    viewer.setOnOpenLocalFile(onOpenLocalFile);
  });

  /** Click the first link in the rendered document, returning the event. */
  function clickLink(): MouseEvent {
    const anchor = container.querySelector('a');
    if (!anchor) throw new Error('no link rendered');
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    anchor.dispatchEvent(event);
    return event;
  }

  it('opens an http link in the system browser', async () => {
    await viewer.render('[docs](https://example.com/page)', BASE);

    const event = clickLink();

    expect(openExternal).toHaveBeenCalledWith('https://example.com/page');
    expect(event.defaultPrevented).toBe(true);
  });

  it('scrolls to the target heading for an in-document anchor', async () => {
    await viewer.render('[jump](#install)\n\n## Install', BASE);

    clickLink();

    expect(scrollIntoView).toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens a linked markdown file in the viewer', async () => {
    resolvePath.mockReturnValue('/docs/project/guide.md');
    await viewer.render('[guide](./guide.md)', BASE);

    clickLink();

    expect(resolvePath).toHaveBeenCalledWith(BASE, './guide.md');
    expect(onOpenLocalFile).toHaveBeenCalledWith('/docs/project/guide.md', null);
  });

  it('passes the fragment along so the new file scrolls to the section', async () => {
    resolvePath.mockReturnValue('/docs/project/guide.md');
    await viewer.render('[install](./guide.md#getting%20started)', BASE);

    clickLink();

    expect(onOpenLocalFile).toHaveBeenCalledWith(
      '/docs/project/guide.md',
      'getting started'
    );
  });

  // Negative cases: the handler must stay silent on everything else, while
  // still swallowing the navigation that would blank the app.

  it('does not open a local file that is not markdown', async () => {
    resolvePath.mockReturnValue('/docs/project/notes.txt');
    await viewer.render('[notes](./notes.txt)', BASE);

    const event = clickLink();

    expect(onOpenLocalFile).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing when the reference does not resolve to a local file', async () => {
    resolvePath.mockReturnValue(null);
    await viewer.render('[nowhere](./missing.md)', BASE);

    clickLink();

    expect(onOpenLocalFile).not.toHaveBeenCalled();
  });

  it('ignores clicks that are not on a link', async () => {
    await viewer.render('Just a paragraph.', BASE);

    // Without the error listener this passes even if the handler throws on the
    // way past its guards, which is not the same thing as ignoring the click.
    const onError = vi.fn();
    window.addEventListener('error', onError);
    container
      .querySelector('p')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    window.removeEventListener('error', onError);

    expect(onError).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(onOpenLocalFile).not.toHaveBeenCalled();
  });
});
