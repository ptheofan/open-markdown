/**
 * QuickSwitcher - jump to a document by typing part of its name
 *
 * Lighter than the Document Browser: no thumbnails, just a list of the open
 * documents and then the recent files, narrowed as you type with fuzzy
 * matching on name and path. Arrow keys move, Enter opens, Esc closes.
 */
import { rankByFuzzy } from '../services/fuzzy';

import type { DocumentBrowserSnapshot, OpenDocumentEntry, RecentFileEntry } from '@shared/types';

export interface QuickSwitcherCallbacks {
  /** The open documents and recent files to list */
  loadSnapshot: () => Promise<DocumentBrowserSnapshot>;
  /** An open document was chosen */
  onSelectOpenDocument: (entry: OpenDocumentEntry) => void;
  /** A recent file was chosen */
  onSelectRecentFile: (entry: RecentFileEntry) => void;
}

export type SwitcherItem =
  | { kind: 'open'; entry: OpenDocumentEntry }
  | { kind: 'recent'; entry: RecentFileEntry };

const VISIBLE_CLASS = 'quick-switcher-visible';
const SELECTED_CLASS = 'quick-switcher-item-selected';
const MAX_ITEMS = 40;

/** The text an item is matched on: its name, then its folder */
function searchText(item: SwitcherItem): string {
  return `${item.entry.fileName} ${item.entry.filePath}`;
}

/**
 * Open documents first, then recent files that are not open, ranked by
 * the query. With no query the lists keep their order.
 */
export function rankItems(snapshot: DocumentBrowserSnapshot, query: string): SwitcherItem[] {
  const openPaths = new Set(snapshot.open.map((e) => e.filePath));
  const items: SwitcherItem[] = [
    ...snapshot.open.map((entry): SwitcherItem => ({ kind: 'open', entry })),
    ...snapshot.recent
      .filter((entry) => !openPaths.has(entry.filePath))
      .map((entry): SwitcherItem => ({ kind: 'recent', entry })),
  ];
  return rankByFuzzy(query, items, searchText)
    .map(({ item }) => item)
    .slice(0, MAX_ITEMS);
}

function parentDir(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  return slash > 0 ? filePath.slice(0, slash) : '';
}

export class QuickSwitcher {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly callbacks: QuickSwitcherCallbacks;
  private readonly handleKeydown: (e: KeyboardEvent) => void;

  private snapshot: DocumentBrowserSnapshot = { open: [], recent: [] };
  private items: SwitcherItem[] = [];
  private selectedIndex = 0;
  private visible = false;
  private loadSeq = 0;

  constructor(container: HTMLElement, callbacks: QuickSwitcherCallbacks) {
    this.callbacks = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'quick-switcher';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = `
      <div class="quick-switcher-backdrop"></div>
      <div class="quick-switcher-panel">
        <input class="quick-switcher-input" type="text" placeholder="Switch to document…" spellcheck="false" autocomplete="off" aria-label="Switch to document">
        <ul class="quick-switcher-list" role="listbox"></ul>
        <div class="quick-switcher-hint">↑↓ to move · Enter to open · Esc to close</div>
      </div>
    `;
    this.input = this.root.querySelector('.quick-switcher-input') as HTMLInputElement;
    this.list = this.root.querySelector('.quick-switcher-list') as HTMLElement;
    this.handleKeydown = (e) => this.onKeydown(e);

    this.input.addEventListener('input', () => {
      this.selectedIndex = 0;
      this.render();
    });
    this.root.querySelector('.quick-switcher-backdrop')?.addEventListener('click', () => this.hide());
    this.list.addEventListener('mousedown', (e) => {
      // Keep focus in the box
      e.preventDefault();
    });
    this.list.addEventListener('click', (e) => {
      const item = (e.target as Element).closest<HTMLElement>('[data-index]');
      if (!item) return;
      const index = Number(item.dataset['index']);
      if (Number.isInteger(index)) this.choose(index);
    });

    container.appendChild(this.root);
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    if (this.visible) {
      this.input.focus();
      this.input.select();
      return;
    }
    this.visible = true;
    this.root.classList.add(VISIBLE_CLASS);
    this.root.setAttribute('aria-hidden', 'false');
    this.input.value = '';
    this.selectedIndex = 0;
    this.items = [];
    this.render();
    document.addEventListener('keydown', this.handleKeydown, true);
    this.input.focus();

    const seq = ++this.loadSeq;
    void this.callbacks
      .loadSnapshot()
      .then((snapshot) => {
        if (seq !== this.loadSeq || !this.visible) return;
        this.snapshot = snapshot;
        this.render();
      })
      .catch(() => {
        // Keep whatever was listed last time
      });
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove(VISIBLE_CLASS);
    this.root.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', this.handleKeydown, true);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  /** For tests: what is listed right now */
  getItems(): SwitcherItem[] {
    return [...this.items];
  }

  destroy(): void {
    this.hide();
    this.root.remove();
  }

  private onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        this.choose(this.selectedIndex);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.move(-1);
        break;
    }
  }

  private move(delta: number): void {
    if (this.items.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.items.length) % this.items.length;
    this.updateSelection();
  }

  private choose(index: number): void {
    const item = this.items[index];
    if (!item) return;
    this.hide();
    if (item.kind === 'open') this.callbacks.onSelectOpenDocument(item.entry);
    else this.callbacks.onSelectRecentFile(item.entry);
  }

  private render(): void {
    this.items = rankItems(this.snapshot, this.input.value);
    this.list.replaceChildren();

    if (this.items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'quick-switcher-empty';
      empty.textContent = this.input.value ? 'No matching documents' : 'No documents yet';
      this.list.appendChild(empty);
      return;
    }

    this.items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = `quick-switcher-item quick-switcher-item-${item.kind}`;
      li.dataset['index'] = String(index);
      li.setAttribute('role', 'option');

      const name = document.createElement('span');
      name.className = 'quick-switcher-name';
      name.textContent = item.entry.fileName;

      const badge = document.createElement('span');
      badge.className = 'quick-switcher-badge';
      badge.textContent = item.kind === 'open' ? 'open' : 'recent';

      const dir = document.createElement('span');
      dir.className = 'quick-switcher-path';
      dir.textContent = parentDir(item.entry.filePath);

      li.append(name, badge, dir);
      this.list.appendChild(li);
    });
    if (this.selectedIndex >= this.items.length) this.selectedIndex = 0;
    this.updateSelection();
  }

  private updateSelection(): void {
    const rows = this.list.querySelectorAll<HTMLElement>('.quick-switcher-item');
    rows.forEach((row, i) => {
      const selected = i === this.selectedIndex;
      row.classList.toggle(SELECTED_CLASS, selected);
      row.setAttribute('aria-selected', String(selected));
      if (selected) row.scrollIntoView?.({ block: 'nearest' });
    });
  }
}

export function createQuickSwitcher(container: HTMLElement, callbacks: QuickSwitcherCallbacks): QuickSwitcher {
  return new QuickSwitcher(container, callbacks);
}
