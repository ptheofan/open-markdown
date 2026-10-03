/**
 * @vitest-environment jsdom
 *
 * File references and front matter in the viewer: references are resolved
 * through main once rendered, clicks open the resolved file, and opening or
 * closing the front matter is reported so it can be remembered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMarkdownViewer, type MarkdownViewer } from '@renderer/components/MarkdownViewer';

const FILE = '/repo/docs/plan.md';

describe('MarkdownViewer file references', () => {
  let container: HTMLElement;
  let viewer: MarkdownViewer;
  let resolveReferences: ReturnType<typeof vi.fn>;
  let onOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '<div id="markdown-content"></div>';
    container = document.getElementById('markdown-content')!;

    resolveReferences = vi.fn().mockResolvedValue({
      'src/app.ts': '/repo/src/app.ts',
      'missing.md': null,
    });
    onOpen = vi.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      assets: { resolve: vi.fn(() => null), resolvePath: vi.fn() },
      file: { resolveReferences },
      clipboard: { writeText: vi.fn() },
    };

    viewer = createMarkdownViewer(container);
    viewer.setOnOpenFileReference(onOpen);
  });

  function click(el: Element): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    el.dispatchEvent(event);
    return event;
  }

  async function renderAndResolve(md: string): Promise<void> {
    await viewer.render(md, FILE);
    await vi.waitFor(() => expect(resolveReferences).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
  }

  it('asks main to resolve every distinct reference against the document', async () => {
    await renderAndResolve('See `src/app.ts:42` and `src/app.ts` and `missing.md`.');
    expect(resolveReferences).toHaveBeenCalledWith(FILE, ['src/app.ts', 'missing.md']);
  });

  it('marks resolved references with the path and unresolved ones as plain', async () => {
    await renderAndResolve('See `src/app.ts:42` and `missing.md`.');
    const [resolved, unresolved] = Array.from(container.querySelectorAll('a.file-ref'));

    expect(resolved?.getAttribute('data-file-path')).toBe('/repo/src/app.ts');
    expect(resolved?.getAttribute('href')).toBe('/repo/src/app.ts');
    expect(resolved?.getAttribute('title')).toBe('/repo/src/app.ts');
    expect(resolved?.classList.contains('file-ref-unresolved')).toBe(false);

    expect(unresolved?.classList.contains('file-ref-unresolved')).toBe(true);
    expect(unresolved?.hasAttribute('href')).toBe(false);
  });

  it('opens a resolved reference with its line and column, and prevents navigation', async () => {
    await renderAndResolve('Fix `src/app.ts:42:7`.');
    const event = click(container.querySelector('a.file-ref code')!);

    expect(event.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledWith('/repo/src/app.ts', 42, 7);
  });

  it('passes null for a reference without a position', async () => {
    await renderAndResolve('Open `src/app.ts`.');
    click(container.querySelector('a.file-ref')!);
    expect(onOpen).toHaveBeenCalledWith('/repo/src/app.ts', null, null);
  });

  it('does nothing for an unresolved reference', async () => {
    await renderAndResolve('Open `missing.md`.');
    click(container.querySelector('a.file-ref')!);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not decorate a document that has since been replaced', async () => {
    let release: (value: Record<string, string | null>) => void = () => undefined;
    resolveReferences.mockImplementationOnce(
      () => new Promise<Record<string, string | null>>((resolve) => { release = resolve; })
    );
    await viewer.render('Old `src/app.ts`.', FILE);
    await viewer.render('New `other.md`.', FILE);
    release({ 'src/app.ts': '/repo/src/app.ts', 'other.md': '/repo/other.md' });
    await Promise.resolve();
    await Promise.resolve();

    const anchor = container.querySelector('a.file-ref')!;
    expect(anchor.textContent).toBe('other.md');
    expect(anchor.getAttribute('data-file-path')).not.toBe('/repo/src/app.ts');
  });

  it('skips resolution when there is nothing to resolve', async () => {
    await viewer.render('Plain text.', FILE);
    await Promise.resolve();
    expect(resolveReferences).not.toHaveBeenCalled();
  });
});

describe('MarkdownViewer front matter', () => {
  let container: HTMLElement;
  let viewer: MarkdownViewer;

  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '<div id="markdown-content"></div>';
    container = document.getElementById('markdown-content')!;
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      assets: { resolve: vi.fn(() => null), resolvePath: vi.fn() },
      file: { resolveReferences: vi.fn().mockResolvedValue({}) },
    };
    viewer = createMarkdownViewer(container);
  });

  it('renders the block and reports when it is opened or closed', async () => {
    const onToggle = vi.fn();
    viewer.setOnFrontMatterToggle(onToggle);
    await viewer.render('---\nname: x\n---\n\n# T', FILE);

    const details = container.querySelector<HTMLDetailsElement>('details.front-matter')!;
    expect(details.open).toBe(true);

    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(onToggle).toHaveBeenCalledWith(false);

    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });

  it('follows the plugin preference for the initial state', async () => {
    await viewer.initialize();
    viewer.notifyPluginPreferencesChange('front-matter', { expanded: false });
    await viewer.render('---\nname: x\n---\n\n# T', FILE);
    expect(container.querySelector<HTMLDetailsElement>('details.front-matter')!.open).toBe(false);
  });
});
