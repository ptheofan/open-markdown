/**
 * @vitest-environment jsdom
 *
 * When `setTheme` rebuilds the document.
 *
 * The app calls `setTheme` after every preference change, including ones
 * that cannot change the rendered document: moving a window saves its bounds
 * as a preference. A rebuild drops the reader's selection, closes the
 * `<details>` they opened and resets diagram zoom, so it happens only when the
 * theme or a plugin preference differs from what the document was rendered with.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMarkdownViewer, type MarkdownViewer } from '@renderer/components/MarkdownViewer';

const FILE = '/repo/docs/plan.md';
const DOC = '---\nname: x\n---\n\n# Title\n\nBody.';

describe('MarkdownViewer rebuilds on setTheme', () => {
  let container: HTMLElement;
  let viewer: MarkdownViewer;

  beforeEach(async () => {
    vi.restoreAllMocks();
    document.body.innerHTML = '<div id="markdown-content"></div>';
    container = document.getElementById('markdown-content')!;
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      assets: { resolve: vi.fn(() => null), resolvePath: vi.fn() },
      file: { resolveReferences: vi.fn().mockResolvedValue({}) },
    };
    viewer = createMarkdownViewer(container);
    await viewer.initialize();
    viewer.notifyAllPluginsPreferencesChange({ 'front-matter': { expanded: true } });
    await viewer.setTheme('light');
    await viewer.render(DOC, FILE);
  });

  const heading = (): Element | null => container.querySelector('h1');

  it('keeps the document when nothing it was rendered with changed', async () => {
    const before = heading();

    await viewer.setTheme('light');

    expect(heading()).toBe(before);
  });

  it('keeps the document when the same plugin preferences arrive again', async () => {
    const before = heading();

    // A broadcast after an unrelated change carries fresh, equal objects
    viewer.notifyAllPluginsPreferencesChange({ 'front-matter': { expanded: true } });
    await viewer.setTheme('light');

    expect(heading()).toBe(before);
  });

  it('rebuilds when the theme changes', async () => {
    const before = heading();

    await viewer.setTheme('dark');

    expect(heading()).not.toBe(before);
  });

  it('rebuilds when a plugin preference changes', async () => {
    const before = heading();

    viewer.notifyPluginPreferencesChange('front-matter', { expanded: false });
    await viewer.setTheme('light');

    expect(heading()).not.toBe(before);
    expect(container.querySelector<HTMLDetailsElement>('details.front-matter')!.open).toBe(false);
  });

  it('keeps the document when the same plugins arrive in another order', async () => {
    viewer.notifyAllPluginsPreferencesChange({
      'front-matter': { expanded: true },
      mermaid: { export: { background: 'transparent' } },
    });
    await viewer.setTheme('light');
    const before = heading();

    viewer.notifyAllPluginsPreferencesChange({
      mermaid: { export: { background: 'transparent' } },
      'front-matter': { expanded: true },
    });
    await viewer.setTheme('light');

    expect(heading()).toBe(before);
  });

  it('retries a render that failed, even when nothing changed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const internals = viewer as unknown as { pluginManager: { render: (md: string) => string } };
    vi.spyOn(internals.pluginManager, 'render').mockImplementationOnce(() => {
      throw new Error('boom');
    });

    await viewer.render(DOC, FILE);
    expect(container.querySelector('.render-error')).not.toBeNull();

    await viewer.setTheme('light');

    expect(container.querySelector('.render-error')).toBeNull();
    expect(heading()).not.toBeNull();
  });
});

// Main reads the project root when the viewer asks it to resolve file
// references, which happens after a render. Now that a preference change
// no longer rebuilds the document, a new root has to re-resolve them itself.
describe('MarkdownViewer project root', () => {
  let container: HTMLElement;
  let viewer: MarkdownViewer;
  let resolveReferences: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    document.body.innerHTML = '<div id="markdown-content"></div>';
    container = document.getElementById('markdown-content')!;
    resolveReferences = vi.fn().mockResolvedValue({ 'src/app.ts': null });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      assets: { resolve: vi.fn(() => null), resolvePath: vi.fn() },
      file: { resolveReferences },
    };
    viewer = createMarkdownViewer(container);
    viewer.setProjectRoot('');
    await viewer.render('# Title\n\nSee `src/app.ts`.', FILE);
    await vi.waitFor(() => expect(resolveReferences).toHaveBeenCalledTimes(1));
  });

  it('re-resolves file references in place when the root changes', async () => {
    const before = container.querySelector('h1');
    resolveReferences.mockResolvedValue({ 'src/app.ts': '/repo/src/app.ts' });

    viewer.setProjectRoot('/repo');

    await vi.waitFor(() =>
      expect(container.querySelector('a.file-ref')?.getAttribute('href')).toBe('/repo/src/app.ts')
    );
    expect(container.querySelector('h1')).toBe(before);
  });

  it('does not ask main again when the root is unchanged', async () => {
    viewer.setProjectRoot('');
    await Promise.resolve();

    expect(resolveReferences).toHaveBeenCalledTimes(1);
  });
});
