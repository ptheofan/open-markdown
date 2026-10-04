/**
 * @vitest-environment jsdom
 *
 * The Files pane: lazy directories, the highlighted document, keyboard
 * walking, the filter and live refresh.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createFolderTree, type FolderTreeDeps } from '@renderer/components/FolderTree';
import type { FolderEntry } from '@shared/types';

const FILES: Record<string, FolderEntry[]> = {
  '/repo': [
    { name: 'docs', path: '/repo/docs', kind: 'directory', isMarkdown: false },
    { name: 'README.md', path: '/repo/README.md', kind: 'file', isMarkdown: true },
    { name: 'plan.md', path: '/repo/plan.md', kind: 'file', isMarkdown: true },
  ],
  '/repo/docs': [
    { name: 'api', path: '/repo/docs/api', kind: 'directory', isMarkdown: false },
    { name: 'guide.md', path: '/repo/docs/guide.md', kind: 'file', isMarkdown: true },
  ],
  '/repo/docs/api': [{ name: 'index.md', path: '/repo/docs/api/index.md', kind: 'file', isMarkdown: true }],
};

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function names(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.folder-item:not(.folder-item-loading) .folder-item-name')).map(
    (el) => el.textContent ?? ''
  );
}

describe('FolderTree', () => {
  let container: HTMLElement;
  let deps: FolderTreeDeps & {
    list: ReturnType<typeof vi.fn>;
    listAll: ReturnType<typeof vi.fn>;
    watch: ReturnType<typeof vi.fn>;
    unwatch: ReturnType<typeof vi.fn>;
    onOpenFile: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
    showContextMenu: ReturnType<typeof vi.fn>;
    onCopyPath: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="folder-panel"></div>';
    container = document.getElementById('folder-panel')!;
    deps = {
      list: vi.fn((dir: string) => Promise.resolve(FILES[dir] ?? [])),
      listAll: vi.fn(() => Promise.resolve(['README.md', 'plan.md', 'docs/guide.md', 'docs/api/index.md'])),
      watch: vi.fn(() => Promise.resolve()),
      unwatch: vi.fn(() => Promise.resolve()),
      onOpenFile: vi.fn(),
      onClose: vi.fn(),
      showContextMenu: vi.fn(() => Promise.resolve('copy-path')),
      onCopyPath: vi.fn(),
    };
  });

  it('lists the root when opened, watches it, and loads folders on demand', async () => {
    const tree = createFolderTree(container, deps);
    expect(container.classList.contains('folder-panel-open')).toBe(false);

    await tree.open('/repo');
    expect(container.querySelector('.folder-title')?.textContent).toBe('repo');
    expect(names(container)).toEqual(['docs', 'README.md', 'plan.md']);
    expect(deps.watch).toHaveBeenCalledWith('/repo');
    expect(deps.list).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLElement>('[data-path="/repo/docs"]')!.click();
    await settle();
    expect(names(container)).toEqual(['docs', 'api', 'guide.md', 'README.md', 'plan.md']);
    expect(deps.list).toHaveBeenCalledWith('/repo/docs', { root: '/repo', showAll: false });
    expect(deps.watch).toHaveBeenCalledWith('/repo/docs');
    expect(container.querySelector('[data-path="/repo/docs"]')?.getAttribute('aria-expanded')).toBe('true');

    container.querySelector<HTMLElement>('[data-path="/repo/docs"]')!.click();
    expect(names(container)).toEqual(['docs', 'README.md', 'plan.md']);
    expect(deps.unwatch).toHaveBeenCalledWith('/repo/docs');
  });

  it('opens a clicked file, in a new window with a modifier', async () => {
    const tree = createFolderTree(container, deps);
    await tree.open('/repo');

    container.querySelector<HTMLElement>('[data-path="/repo/plan.md"] .folder-item-name')!.click();
    expect(deps.onOpenFile).toHaveBeenCalledWith('/repo/plan.md', { newWindow: false });

    container
      .querySelector<HTMLElement>('[data-path="/repo/README.md"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(deps.onOpenFile).toHaveBeenLastCalledWith('/repo/README.md', { newWindow: true });
  });

  it('highlights the current document and opens the folders down to it', async () => {
    const tree = createFolderTree(container, deps);
    await tree.open('/repo');

    tree.setCurrentFile('/repo/docs/api/index.md');
    await settle();
    await settle();
    const current = container.querySelector<HTMLElement>('.folder-item-current');
    expect(current?.dataset.path).toBe('/repo/docs/api/index.md');
    expect(names(container)).toEqual(['docs', 'api', 'index.md', 'guide.md', 'README.md', 'plan.md']);

    tree.setCurrentFile('/elsewhere/x.md');
    expect(container.querySelector('.folder-item-current')).toBeNull();
  });

  it('walks with the arrow keys and opens with Enter', async () => {
    const tree = createFolderTree(container, deps);
    await tree.open('/repo');
    const treeEl = container.querySelector<HTMLElement>('.folder-tree')!;
    const press = (key: string): void => {
      treeEl.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    const selected = (): string | undefined =>
      container.querySelector<HTMLElement>('.folder-item-selected')?.dataset.path;

    press('ArrowDown');
    expect(selected()).toBe('/repo/docs');
    press('ArrowRight');
    await settle();
    expect(selected()).toBe('/repo/docs');
    expect(names(container)).toContain('guide.md');
    press('ArrowRight');
    expect(selected()).toBe('/repo/docs/api');
    press('ArrowDown');
    expect(selected()).toBe('/repo/docs/guide.md');
    press('ArrowLeft');
    expect(selected()).toBe('/repo/docs');
    press('ArrowLeft');
    expect(names(container)).not.toContain('guide.md');
    press('End');
    expect(selected()).toBe('/repo/plan.md');
    press('Enter');
    expect(deps.onOpenFile).toHaveBeenCalledWith('/repo/plan.md', { newWindow: false });
  });

  it('filters the whole folder by fuzzy name and shows where matches live', async () => {
    const tree = createFolderTree(container, deps);
    await tree.open('/repo');

    const input = container.querySelector<HTMLInputElement>('.folder-filter')!;
    input.value = 'gui';
    input.dispatchEvent(new Event('input'));
    await settle();

    expect(deps.listAll).toHaveBeenCalledWith('/repo', { showAll: false });
    expect(names(container)).toEqual(['guide.md']);
    expect(container.querySelector('.folder-item-path')?.textContent).toBe('docs');

    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    expect(container.querySelector('.folder-empty')?.textContent).toBe('No matching files');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(input.value).toBe('');
    expect(names(container)).toEqual(['docs', 'README.md', 'plan.md']);
  });

  it('lists a directory again when it changes on disk', async () => {
    const tree = createFolderTree(container, deps);
    await tree.open('/repo');
    expect(deps.list).toHaveBeenCalledTimes(1);

    tree.handleChange('/repo/docs');
    expect(deps.list).toHaveBeenCalledTimes(1);

    tree.handleChange('/repo');
    await settle();
    expect(deps.list).toHaveBeenCalledTimes(2);
  });

  it('remembers the all-files toggle and lists again with it', async () => {
    const tree = createFolderTree(container, deps);
    await tree.open('/repo');
    container.querySelector<HTMLElement>('[data-folder-toggle-all]')!.click();
    await settle();
    expect(tree.getShowAll()).toBe(true);
    expect(deps.list).toHaveBeenLastCalledWith('/repo', { root: '/repo', showAll: true });
    expect(localStorage.getItem('folder-tree-show-all')).toBe('1');
  });

  it('closes from the header, releasing its watchers', async () => {
    const tree = createFolderTree(container, deps);
    await tree.open('/repo');
    container.querySelector<HTMLElement>('[data-folder-close]')!.click();
    expect(deps.onClose).toHaveBeenCalled();

    await tree.close();
    expect(tree.isOpen()).toBe(false);
    expect(deps.unwatch).toHaveBeenCalledWith('/repo');
    expect(container.querySelector('.folder-item')).toBeNull();
  });

  it('offers a context menu on a row', async () => {
    const tree = createFolderTree(container, deps);
    await tree.open('/repo');
    container
      .querySelector<HTMLElement>('[data-path="/repo/plan.md"]')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    expect(deps.showContextMenu).toHaveBeenCalled();
    const items = (deps.showContextMenu.mock.calls[0] as [Array<{ id: string }>])[0];
    expect(items.map((i) => i.id)).toEqual(['open', 'open-new-window', 'reveal', 'copy-path']);
    expect(deps.onCopyPath).toHaveBeenCalledWith('/repo/plan.md');
  });
});
