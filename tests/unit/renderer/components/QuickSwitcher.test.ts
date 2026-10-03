/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createQuickSwitcher, rankItems } from '@renderer/components/QuickSwitcher';
import type { DocumentBrowserSnapshot } from '@shared/types';

const SNAPSHOT: DocumentBrowserSnapshot = {
  open: [
    { windowId: 1, filePath: '/repo/docs/plan.md', fileName: 'plan.md', text: '', isCurrent: true } as never,
    { windowId: 2, filePath: '/repo/README.md', fileName: 'README.md', text: '', isCurrent: false } as never,
  ],
  recent: [
    { filePath: '/repo/README.md', fileName: 'README.md', openedAt: '2026-01-01T00:00:00Z' },
    { filePath: '/notes/planning.md', fileName: 'planning.md', openedAt: '2026-01-01T00:00:00Z' },
    { filePath: '/notes/other.md', fileName: 'other.md', openedAt: '2026-01-01T00:00:00Z' },
  ],
};

describe('rankItems', () => {
  it('lists open documents first and leaves out recent files that are open', () => {
    const items = rankItems(SNAPSHOT, '');
    expect(items.map((i) => `${i.kind}:${i.entry.fileName}`)).toEqual([
      'open:plan.md',
      'open:README.md',
      'recent:planning.md',
      'recent:other.md',
    ]);
  });

  it('narrows by fuzzy match on name and path', () => {
    const items = rankItems(SNAPSHOT, 'plan');
    expect(items.map((i) => i.entry.fileName)).toEqual(['plan.md', 'planning.md']);
    expect(rankItems(SNAPSHOT, 'zzz')).toEqual([]);
  });
});

describe('QuickSwitcher', () => {
  let loadSnapshot: ReturnType<typeof vi.fn>;
  let onOpen: ReturnType<typeof vi.fn>;
  let onRecent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    loadSnapshot = vi.fn().mockResolvedValue(SNAPSHOT);
    onOpen = vi.fn();
    onRecent = vi.fn();
  });

  function create() {
    return createQuickSwitcher(document.body, {
      loadSnapshot,
      onSelectOpenDocument: onOpen,
      onSelectRecentFile: onRecent,
    });
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) await Promise.resolve();
  }

  it('is hidden until shown, then lists documents and focuses the box', async () => {
    const switcher = create();
    expect(document.querySelector('.quick-switcher-visible')).toBeNull();

    switcher.show();
    await settle();
    expect(document.querySelector('.quick-switcher-visible')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.quick-switcher-input'));
    expect(document.querySelectorAll('.quick-switcher-item')).toHaveLength(4);
    expect(document.querySelector('.quick-switcher-item-selected')?.textContent).toContain('plan.md');
  });

  it('filters as the user types and opens the selection on Enter', async () => {
    const switcher = create();
    switcher.show();
    await settle();

    const input = document.querySelector<HTMLInputElement>('.quick-switcher-input')!;
    input.value = 'other';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.quick-switcher-item')).toHaveLength(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onRecent).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'other.md' }));
    expect(switcher.isVisible()).toBe(false);
  });

  it('moves with the arrow keys and wraps', async () => {
    const switcher = create();
    switcher.show();
    await settle();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.querySelector('.quick-switcher-item-selected')?.textContent).toContain('README.md');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(document.querySelector('.quick-switcher-item-selected')?.textContent).toContain('other.md');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ windowId: 1 }));
  });

  it('closes on Escape and on the backdrop', async () => {
    const switcher = create();
    switcher.show();
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(switcher.isVisible()).toBe(false);

    switcher.show();
    document.querySelector<HTMLElement>('.quick-switcher-backdrop')!.click();
    expect(switcher.isVisible()).toBe(false);
  });

  it('opens a clicked row', async () => {
    const switcher = create();
    switcher.show();
    await settle();
    document.querySelectorAll<HTMLElement>('.quick-switcher-item')[1]!.click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ windowId: 2 }));
  });

  it('says so when nothing matches', async () => {
    const switcher = create();
    switcher.show();
    await settle();
    const input = document.querySelector<HTMLInputElement>('.quick-switcher-input')!;
    input.value = 'nothing-like-this';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.quick-switcher-empty')?.textContent).toBe('No matching documents');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onRecent).not.toHaveBeenCalled();
  });
});
