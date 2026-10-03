/**
 * @vitest-environment jsdom
 *
 * The document browser lists open documents and recent files, filters them
 * as the user types, and is driven from the keyboard.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  createDocumentBrowser,
  filterSnapshot,
  findSnippet,
  formatTimeAgo,
  type DocumentBrowser,
  type DocumentBrowserCallbacks,
} from '@renderer/components/DocumentBrowser';
import type { DocumentBrowserSnapshot } from '@shared/types';

const snapshot: DocumentBrowserSnapshot = {
  open: [
    {
      windowId: 1,
      filePath: '/docs/readme.md',
      fileName: 'readme.md',
      thumbnail: 'data:image/jpeg;base64,AAAA',
      isCurrent: true,
      text: 'Installation guide for the project',
    },
    {
      windowId: 2,
      filePath: '/docs/notes/meeting.md',
      fileName: 'meeting.md',
      thumbnail: null,
      isCurrent: false,
      text: 'Agenda: budget review and roadmap',
    },
  ],
  recent: [
    { filePath: '/docs/archive/budget.md', fileName: 'budget.md', openedAt: new Date().toISOString() },
    { filePath: '/docs/todo.md', fileName: 'todo.md', openedAt: new Date().toISOString() },
  ],
};

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const tiles = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.doc-browser-tile'));
const tileNames = (): string[] =>
  tiles().map((t) => t.querySelector('.doc-browser-tile-name')?.textContent ?? '');
const selectedName = (): string | null =>
  document
    .querySelector('.doc-browser-tile-selected .doc-browser-tile-name')
    ?.textContent ?? null;

describe('filterSnapshot', () => {
  it('should return everything for an empty query', () => {
    expect(filterSnapshot(snapshot, '   ')).toBe(snapshot);
  });

  it('should match open documents on name, path or content', () => {
    expect(filterSnapshot(snapshot, 'README').open.map((e) => e.fileName)).toEqual(['readme.md']);
    expect(filterSnapshot(snapshot, 'notes/').open.map((e) => e.fileName)).toEqual(['meeting.md']);
    expect(filterSnapshot(snapshot, 'roadmap').open.map((e) => e.fileName)).toEqual(['meeting.md']);
  });

  it('should match recent files on name and path only', () => {
    expect(filterSnapshot(snapshot, 'budget').recent.map((e) => e.fileName)).toEqual(['budget.md']);
    expect(filterSnapshot(snapshot, 'archive').recent.map((e) => e.fileName)).toEqual(['budget.md']);
    expect(filterSnapshot(snapshot, 'agenda').recent).toEqual([]);
  });

  it('should require every term to match', () => {
    expect(filterSnapshot(snapshot, 'budget review').open.map((e) => e.fileName)).toEqual(['meeting.md']);
    expect(filterSnapshot(snapshot, 'budget installation').open).toEqual([]);
  });
});

describe('findSnippet', () => {
  it('should return null when no term occurs', () => {
    expect(findSnippet('nothing here', 'zebra')).toBeNull();
  });

  it('should show the earliest match with context and ellipses', () => {
    const text = `${'a'.repeat(100)} needle ${'b'.repeat(100)}`;
    const snippet = findSnippet(text, 'needle');
    expect(snippet).toMatch(/^…a+ needle b+…$/);
    expect(snippet!.length).toBeLessThan(100);
  });

  it('should collapse whitespace', () => {
    expect(findSnippet('one\n\n  two   three', 'two')).toBe('one two three');
  });
});

describe('formatTimeAgo', () => {
  const now = new Date('2026-10-03T12:00:00Z');

  it('should describe recent times in minutes, hours and days', () => {
    expect(formatTimeAgo('2026-10-03T11:59:40Z', now)).toBe('just now');
    expect(formatTimeAgo('2026-10-03T11:30:00Z', now)).toBe('30m ago');
    expect(formatTimeAgo('2026-10-03T07:00:00Z', now)).toBe('5h ago');
    expect(formatTimeAgo('2026-10-01T12:00:00Z', now)).toBe('2d ago');
  });

  it('should fall back to the date after a week', () => {
    const result = formatTimeAgo('2026-09-01T12:00:00Z', now);
    expect(result).toBe(new Date('2026-09-01T12:00:00Z').toLocaleDateString());
  });
});

describe('DocumentBrowser', () => {
  let browser: DocumentBrowser;
  let callbacks: {
    loadSnapshot: ReturnType<typeof vi.fn>;
    onSelectOpenDocument: ReturnType<typeof vi.fn>;
    onSelectRecentFile: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom has no layout, so no scrollIntoView either
    Element.prototype.scrollIntoView = vi.fn();
    callbacks = {
      loadSnapshot: vi.fn(() => Promise.resolve(snapshot)),
      onSelectOpenDocument: vi.fn(),
      onSelectRecentFile: vi.fn(),
    };
    browser = createDocumentBrowser(document.body, callbacks as unknown as DocumentBrowserCallbacks);
  });

  afterEach(() => {
    browser.destroy();
  });

  it('should stay hidden until shown', () => {
    expect(browser.isVisible()).toBe(false);
    expect(document.querySelector('.doc-browser-visible')).toBeNull();
  });

  it('should load the snapshot, then show both sections with the filter box focused', async () => {
    await browser.show();

    expect(callbacks.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(browser.isVisible()).toBe(true);
    expect(document.querySelector('.doc-browser-visible')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.doc-browser-input'));

    const titles = Array.from(document.querySelectorAll('.doc-browser-section-title')).map(
      (el) => el.firstChild?.textContent
    );
    expect(titles).toEqual(['Open documents', 'Recently opened']);
    expect(tileNames()).toEqual(['readme.md', 'meeting.md', 'budget.md', 'todo.md']);
  });

  it('should show the thumbnail when there is one and the text when there is not', async () => {
    await browser.show();

    const [withImage, withoutImage] = tiles();
    expect(withImage?.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
    expect(withoutImage?.querySelector('img')).toBeNull();
    expect(withoutImage?.querySelector('.doc-browser-thumb-fallback')?.textContent).toContain('Agenda');
  });

  it('should mark the current window', async () => {
    await browser.show();

    const badges = tiles().map((t) => t.querySelector('.doc-browser-badge')?.textContent ?? null);
    expect(badges).toEqual(['This window', null, null, null]);
  });

  it('should select the first tile and move with the arrow keys', async () => {
    await browser.show();
    expect(selectedName()).toBe('readme.md');

    press('ArrowRight');
    expect(selectedName()).toBe('meeting.md');

    press('ArrowLeft');
    press('ArrowLeft');
    expect(selectedName()).toBe('readme.md');

    // jsdom lays every tile on one row, so Down leaves the section
    press('ArrowDown');
    expect(selectedName()).toBe('budget.md');

    press('ArrowUp');
    expect(selectedName()).toBe('meeting.md');
  });

  it('should bring the chosen open document to the front on Enter and close', async () => {
    await browser.show();
    press('ArrowRight');
    press('Enter');

    expect(callbacks.onSelectOpenDocument).toHaveBeenCalledWith(
      expect.objectContaining({ windowId: 2 })
    );
    expect(browser.isVisible()).toBe(false);
  });

  it('should just close when the current window is chosen', async () => {
    await browser.show();
    press('Enter');

    expect(callbacks.onSelectOpenDocument).not.toHaveBeenCalled();
    expect(callbacks.onSelectRecentFile).not.toHaveBeenCalled();
    expect(browser.isVisible()).toBe(false);
  });

  it('should open a recent file when its tile is clicked', async () => {
    await browser.show();

    tiles()[3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(callbacks.onSelectRecentFile).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/docs/todo.md' })
    );
    expect(browser.isVisible()).toBe(false);
  });

  it('should filter both sections as the user types', async () => {
    await browser.show();
    const input = document.querySelector('.doc-browser-input') as HTMLInputElement;

    type(input, 'budget');

    expect(tileNames()).toEqual(['meeting.md', 'budget.md']);
    expect(selectedName()).toBe('meeting.md');
  });

  it('should explain a content-only match with an excerpt', async () => {
    await browser.show();
    const input = document.querySelector('.doc-browser-input') as HTMLInputElement;

    type(input, 'roadmap');

    const snippet = tiles()[0]?.querySelector('.doc-browser-tile-snippet')?.textContent;
    expect(snippet).toContain('roadmap');

    type(input, 'meeting');
    expect(tiles()[0]?.querySelector('.doc-browser-tile-snippet')).toBeNull();
  });

  it('should say so when nothing matches', async () => {
    await browser.show();
    const input = document.querySelector('.doc-browser-input') as HTMLInputElement;

    type(input, 'zzz');

    expect(tiles()).toEqual([]);
    expect(document.querySelector('.doc-browser-empty')?.textContent).toContain('zzz');

    press('Enter');
    expect(browser.isVisible()).toBe(true);
  });

  it('should say so when there is nothing to show at all', async () => {
    callbacks.loadSnapshot.mockResolvedValue({ open: [], recent: [] });

    await browser.show();

    expect(document.querySelector('.doc-browser-empty')?.textContent).toContain('No documents open');
  });

  it('should close on Escape and on a backdrop click', async () => {
    await browser.show();
    press('Escape');
    expect(browser.isVisible()).toBe(false);

    await browser.show();
    document.querySelector('.doc-browser-backdrop')?.dispatchEvent(new MouseEvent('click'));
    expect(browser.isVisible()).toBe(false);
  });

  it('should not react to keys once hidden', async () => {
    await browser.show();
    browser.hide();

    press('Enter');

    expect(callbacks.onSelectOpenDocument).not.toHaveBeenCalled();
  });

  it('should not reopen when hidden while the snapshot is still loading', async () => {
    let resolve!: (value: DocumentBrowserSnapshot) => void;
    callbacks.loadSnapshot.mockReturnValue(
      new Promise<DocumentBrowserSnapshot>((r) => {
        resolve = r;
      })
    );

    const showing = browser.show();
    browser.hide();
    resolve(snapshot);
    await showing;

    expect(browser.isVisible()).toBe(false);
  });

  it('should refocus the filter box instead of reloading when already shown', async () => {
    await browser.show();
    (document.querySelector('.doc-browser-input') as HTMLInputElement).blur();

    await browser.show();

    expect(callbacks.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.querySelector('.doc-browser-input'));
  });

  it('should show an empty browser when loading fails', async () => {
    callbacks.loadSnapshot.mockRejectedValue(new Error('no'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await browser.show();

    expect(browser.isVisible()).toBe(true);
    expect(document.querySelector('.doc-browser-empty')).not.toBeNull();
    consoleError.mockRestore();
  });

  it('should toggle', async () => {
    browser.toggle();
    await vi.waitFor(() => expect(browser.isVisible()).toBe(true));

    browser.toggle();
    expect(browser.isVisible()).toBe(false);
  });

  it('should remove its element on destroy', async () => {
    await browser.show();
    browser.destroy();

    expect(document.querySelector('.doc-browser')).toBeNull();
  });
});
