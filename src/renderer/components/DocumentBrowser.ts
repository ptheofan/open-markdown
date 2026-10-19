/**
 * DocumentBrowser - Overlay for finding a document among open windows
 *
 * Shows pinned documents with when they last changed, every open document as
 * a thumbnail of its document view, then recent files that are not open
 * anywhere, with a box that filters by name and (for open documents) by
 * content. Any document can be pinned or unpinned from its tile. Everything is in memory, so filtering is
 * instant; the only wait is the capture when the overlay opens.
 */
import type {
  DocumentBrowserSnapshot,
  OpenDocumentEntry,
  PinnedDocumentEntry,
  RecentFileEntry,
} from '@shared/types';

export interface DocumentBrowserCallbacks {
  /** Capture open documents and list recent files. */
  loadSnapshot: () => Promise<DocumentBrowserSnapshot>;
  /** An open document other than the current one was chosen. */
  onSelectOpenDocument: (entry: OpenDocumentEntry) => void;
  /** A recent file, or a pinned one not open anywhere, was chosen. */
  onSelectRecentFile: (entry: { filePath: string }) => void;
  /** Pin a document; resolves to the pins after, or null when it was not pinned. */
  pin: (filePath: string) => Promise<PinnedDocumentEntry[] | null>;
  /** Unpin a document; resolves to the pins after. */
  unpin: (filePath: string) => Promise<PinnedDocumentEntry[]>;
}

const ROOT_CLASS = 'doc-browser';
const VISIBLE_CLASS = 'doc-browser-visible';
const TILE_CLASS = 'doc-browser-tile';
const SELECTED_CLASS = 'doc-browser-tile-selected';
const PIN_CLASS = 'doc-browser-pin';

/** Characters of context shown on either side of a content match */
const SNIPPET_CONTEXT = 40;
/** How much document text the fallback card shows when there is no capture */
const FALLBACK_PREVIEW_CHARS = 600;

type BrowserItem =
  | { kind: 'pinned'; entry: PinnedDocumentEntry }
  | { kind: 'open'; entry: OpenDocumentEntry }
  | { kind: 'recent'; entry: RecentFileEntry };

/**
 * Split a query into lower-case terms. Every term has to match.
 */
function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAll(terms: string[], ...haystacks: string[]): boolean {
  const lowered = haystacks.map((h) => h.toLowerCase());
  return terms.every((term) => lowered.some((h) => h.includes(term)));
}

/**
 * Keep the entries that match the query. Open documents match on file name,
 * path or content; pinned and recent files only on name and path, since
 * their content is not in memory.
 */
export function filterSnapshot(
  snapshot: DocumentBrowserSnapshot,
  query: string
): DocumentBrowserSnapshot {
  const terms = queryTerms(query);
  if (terms.length === 0) return snapshot;

  return {
    pinned: snapshot.pinned.filter((entry) =>
      matchesAll(terms, entry.fileName, entry.filePath)
    ),
    open: snapshot.open.filter((entry) =>
      matchesAll(terms, entry.fileName, entry.filePath, entry.text)
    ),
    recent: snapshot.recent.filter((entry) =>
      matchesAll(terms, entry.fileName, entry.filePath)
    ),
  };
}

/**
 * A short excerpt of the text around the first term that occurs in it, or
 * null when no term does. Shown under a tile so the user sees why a document
 * matched when its name does not.
 */
export function findSnippet(text: string, query: string): string | null {
  const terms = queryTerms(query);
  const lowered = text.toLowerCase();

  let best = -1;
  let bestLength = 0;
  for (const term of terms) {
    const at = lowered.indexOf(term);
    if (at !== -1 && (best === -1 || at < best)) {
      best = at;
      bestLength = term.length;
    }
  }
  if (best === -1) return null;

  const start = Math.max(0, best - SNIPPET_CONTEXT);
  const end = Math.min(text.length, best + bestLength + SNIPPET_CONTEXT);
  const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${excerpt}${end < text.length ? '…' : ''}`;
}

/**
 * The folder part of a path, for the line under a file name.
 */
function parentDir(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  return slash > 0 ? filePath.slice(0, slash) : '';
}

/**
 * When a pinned file last changed: the date and time, and how long ago.
 */
export function formatModified(isoString: string | null, now = new Date()): string {
  if (!isoString) return 'Cannot be read';
  const date = new Date(isoString);
  const absolute = date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `Modified ${absolute} · ${formatTimeAgo(isoString, now)}`;
}

export function formatTimeAgo(isoString: string, now = new Date()): string {
  const date = new Date(isoString);
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export class DocumentBrowser {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly body: HTMLDivElement;
  private readonly callbacks: DocumentBrowserCallbacks;
  private readonly handleKeydown: (e: KeyboardEvent) => void;

  private snapshot: DocumentBrowserSnapshot | null = null;
  private items: BrowserItem[] = [];
  private tiles: HTMLElement[] = [];
  private selectedIndex = 0;
  private visible = false;
  /** Bumped on every show() so a slow capture cannot reopen a closed overlay */
  private loadSeq = 0;

  constructor(container: HTMLElement, callbacks: DocumentBrowserCallbacks) {
    this.callbacks = callbacks;
    this.root = this.createElement();
    this.input = this.root.querySelector(
      '.doc-browser-input'
    ) as HTMLInputElement;
    this.body = this.root.querySelector('.doc-browser-body') as HTMLDivElement;
    this.handleKeydown = (e) => this.onKeydown(e);
    this.setupEventListeners();
    container.appendChild(this.root);
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Capture the open documents, then show the overlay. The capture happens
   * first so this window's own thumbnail does not contain the overlay.
   */
  async show(): Promise<void> {
    if (this.visible) {
      this.input.focus();
      this.input.select();
      return;
    }

    const seq = ++this.loadSeq;
    let snapshot: DocumentBrowserSnapshot;
    try {
      snapshot = await this.callbacks.loadSnapshot();
    } catch (error) {
      console.error('Failed to load document browser snapshot:', error);
      snapshot = { pinned: [], open: [], recent: [] };
    }
    if (seq !== this.loadSeq) return;

    this.snapshot = snapshot;
    this.visible = true;
    this.input.value = '';
    this.root.classList.add(VISIBLE_CLASS);
    document.addEventListener('keydown', this.handleKeydown, true);
    this.render();
    this.input.focus();
  }

  hide(): void {
    this.loadSeq++;
    if (!this.visible) return;

    this.visible = false;
    this.root.classList.remove(VISIBLE_CLASS);
    document.removeEventListener('keydown', this.handleKeydown, true);
    this.snapshot = null;
    this.items = [];
    this.tiles = [];
    this.body.innerHTML = '';
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      void this.show();
    }
  }

  destroy(): void {
    this.hide();
    this.root.remove();
  }

  private createElement(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = ROOT_CLASS;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Open documents');
    el.innerHTML = `
      <div class="doc-browser-backdrop"></div>
      <div class="doc-browser-panel">
        <div class="doc-browser-header">
          <input class="doc-browser-input" type="text" spellcheck="false"
                 placeholder="Filter by file name or content…" aria-label="Filter documents" />
          <span class="doc-browser-hint">↑↓ ←→ to move · Enter to open · Esc to close</span>
        </div>
        <div class="doc-browser-body"></div>
      </div>
    `;
    return el;
  }

  private setupEventListeners(): void {
    this.root
      .querySelector('.doc-browser-backdrop')
      ?.addEventListener('click', () => {
        this.hide();
      });

    this.input.addEventListener('input', () => {
      this.render();
    });

    this.body.addEventListener('click', (e: MouseEvent) => {
      const pin = (e.target as HTMLElement).closest<HTMLElement>(`.${PIN_CLASS}`);
      if (pin) {
        e.stopPropagation();
        const filePath = pin.dataset.path;
        if (filePath) void this.togglePin(filePath, pin.dataset.pinned === 'true');
        return;
      }
      const tile = (e.target as HTMLElement).closest<HTMLElement>(
        `.${TILE_CLASS}`
      );
      if (!tile) return;
      const index = Number(tile.dataset.index);
      if (Number.isNaN(index)) return;
      this.select(index);
      this.activate(index);
    });

    // Clicking a tile should not pull focus away from the filter box
    this.body.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(`.${TILE_CLASS}`)) {
        e.preventDefault();
      }
    });
  }

  private onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        return;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        this.activate(this.selectedIndex);
        return;
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        this.select(this.selectedIndex + 1);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        this.select(this.selectedIndex - 1);
        return;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.moveVertical(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.moveVertical(-1);
        return;
      default:
        return;
    }
  }

  private render(keepSelection = 0): void {
    if (!this.snapshot) return;

    const query = this.input.value;
    const filtered = filterSnapshot(this.snapshot, query);

    this.items = [
      ...filtered.pinned.map((entry): BrowserItem => ({ kind: 'pinned', entry })),
      ...filtered.open.map((entry): BrowserItem => ({ kind: 'open', entry })),
      ...filtered.recent.map(
        (entry): BrowserItem => ({ kind: 'recent', entry })
      ),
    ];
    this.tiles = [];
    this.body.innerHTML = '';

    const hasAnything =
      this.snapshot.pinned.length > 0 ||
      this.snapshot.open.length > 0 ||
      this.snapshot.recent.length > 0;
    if (!hasAnything) {
      this.body.appendChild(
        this.message('No documents open and nothing opened recently.')
      );
      return;
    }
    if (this.items.length === 0) {
      this.body.appendChild(
        this.message(`No documents match “${query.trim()}”.`)
      );
      return;
    }

    let index = 0;
    if (filtered.pinned.length > 0) {
      const grid = this.section(
        'Pinned',
        filtered.pinned.length,
        'doc-browser-grid-pinned'
      );
      for (const entry of filtered.pinned) {
        grid.appendChild(this.pinnedTile(entry, index++));
      }
    }
    if (filtered.open.length > 0) {
      const grid = this.section(
        'Open documents',
        filtered.open.length,
        'doc-browser-grid-open'
      );
      for (const entry of filtered.open) {
        grid.appendChild(this.openTile(entry, index++, query));
      }
    }
    if (filtered.recent.length > 0) {
      const grid = this.section(
        'Recently opened',
        filtered.recent.length,
        'doc-browser-grid-recent'
      );
      for (const entry of filtered.recent) {
        grid.appendChild(this.recentTile(entry, index++));
      }
    }

    this.selectedIndex = -1;
    this.select(Math.min(keepSelection, this.items.length - 1));
  }

  private message(text: string): HTMLElement {
    const el = document.createElement('p');
    el.className = 'doc-browser-empty';
    el.textContent = text;
    return el;
  }

  private section(
    title: string,
    count: number,
    gridClass: string
  ): HTMLElement {
    const section = document.createElement('section');
    section.className = 'doc-browser-section';

    const heading = document.createElement('h2');
    heading.className = 'doc-browser-section-title';
    heading.textContent = title;
    const badge = document.createElement('span');
    badge.className = 'doc-browser-section-count';
    badge.textContent = String(count);
    heading.appendChild(badge);

    const grid = document.createElement('div');
    grid.className = `doc-browser-grid ${gridClass}`;

    section.appendChild(heading);
    section.appendChild(grid);
    this.body.appendChild(section);
    return grid;
  }

  private tileBase(
    index: number,
    kind: BrowserItem['kind'],
    title: string
  ): HTMLButtonElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `${TILE_CLASS} doc-browser-tile-${kind}`;
    tile.dataset.index = String(index);
    tile.title = title;
    this.tiles[index] = tile;
    return tile;
  }

  /**
   * The pin toggle in a tile's corner. A span, since a tile is a button and
   * buttons cannot nest.
   */
  private pinButton(filePath: string): HTMLElement {
    const pinned = this.snapshot?.pinned.some((p) => p.filePath === filePath) ?? false;
    const el = document.createElement('span');
    el.className = `${PIN_CLASS}${pinned ? ' doc-browser-pin-on' : ''}`;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', pinned ? 'Unpin' : 'Pin');
    el.title = pinned ? 'Unpin' : 'Pin to the top';
    el.dataset.path = filePath;
    el.dataset.pinned = String(pinned);
    el.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M9.8 1.5 14.5 6.2l-1.4.6-2.6 2.6.3 3.3-1.2 1.2-2.9-2.9-3.6 3.6-.7-.7 3.6-3.6L3.1 7.4l1.2-1.2 3.3.3 2.6-2.6z"/></svg>';
    return el;
  }

  private pinnedTile(entry: PinnedDocumentEntry, index: number): HTMLElement {
    const tile = this.tileBase(index, 'pinned', entry.filePath);
    tile.appendChild(this.pinButton(entry.filePath));

    const nameRow = document.createElement('div');
    nameRow.className = 'doc-browser-tile-name-row';
    const name = document.createElement('span');
    name.className = 'doc-browser-tile-name';
    name.textContent = entry.fileName;
    nameRow.appendChild(name);
    if (entry.windowId !== null) {
      const badge = document.createElement('span');
      badge.className = 'doc-browser-badge';
      badge.textContent = 'Open';
      nameRow.appendChild(badge);
    }

    const dir = document.createElement('span');
    dir.className = 'doc-browser-tile-path';
    dir.textContent = parentDir(entry.filePath);

    const when = document.createElement('span');
    when.className = `doc-browser-tile-time${entry.modifiedAt ? '' : ' doc-browser-tile-missing'}`;
    when.textContent = formatModified(entry.modifiedAt);

    tile.appendChild(nameRow);
    tile.appendChild(dir);
    tile.appendChild(when);
    return tile;
  }

  /**
   * Pin or unpin, then redraw with the new pins and the filter kept. A file
   * pinned from Recent leaves Recent; one unpinned shows there next time.
   */
  private async togglePin(filePath: string, pinned: boolean): Promise<void> {
    let next: PinnedDocumentEntry[] | null;
    try {
      next = pinned
        ? await this.callbacks.unpin(filePath)
        : await this.callbacks.pin(filePath);
    } catch (error) {
      console.error('Failed to change pin:', error);
      return;
    }
    if (!next || !this.snapshot || !this.visible) return;

    const pinnedPaths = new Set(next.map((p) => p.filePath));
    this.snapshot = {
      ...this.snapshot,
      pinned: next,
      recent: this.snapshot.recent.filter((r) => !pinnedPaths.has(r.filePath)),
    };
    this.render(this.selectedIndex);
    this.input.focus();
  }

  private openTile(
    entry: OpenDocumentEntry,
    index: number,
    query: string
  ): HTMLElement {
    const tile = this.tileBase(index, 'open', entry.filePath);
    tile.appendChild(this.pinButton(entry.filePath));

    const thumb = document.createElement('div');
    thumb.className = 'doc-browser-thumb';
    if (entry.thumbnail) {
      const img = document.createElement('img');
      img.className = 'doc-browser-thumb-image';
      img.src = entry.thumbnail;
      img.alt = '';
      img.draggable = false;
      thumb.appendChild(img);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'doc-browser-thumb-fallback';
      fallback.textContent =
        entry.text.slice(0, FALLBACK_PREVIEW_CHARS) || entry.fileName;
      thumb.appendChild(fallback);
    }
    tile.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'doc-browser-tile-meta';

    const nameRow = document.createElement('div');
    nameRow.className = 'doc-browser-tile-name-row';
    const name = document.createElement('span');
    name.className = 'doc-browser-tile-name';
    name.textContent = entry.fileName;
    nameRow.appendChild(name);
    if (entry.isCurrent) {
      const badge = document.createElement('span');
      badge.className = 'doc-browser-badge';
      badge.textContent = 'This window';
      nameRow.appendChild(badge);
    }
    meta.appendChild(nameRow);

    const dir = document.createElement('span');
    dir.className = 'doc-browser-tile-path';
    dir.textContent = parentDir(entry.filePath);
    meta.appendChild(dir);

    // Explain a content-only match: the name says nothing, the excerpt does
    const terms = queryTerms(query);
    if (
      terms.length > 0 &&
      !matchesAll(terms, entry.fileName, entry.filePath)
    ) {
      const snippet = findSnippet(entry.text, query);
      if (snippet) {
        const el = document.createElement('span');
        el.className = 'doc-browser-tile-snippet';
        el.textContent = snippet;
        meta.appendChild(el);
      }
    }

    tile.appendChild(meta);
    return tile;
  }

  private recentTile(entry: RecentFileEntry, index: number): HTMLElement {
    const tile = this.tileBase(index, 'recent', entry.filePath);
    tile.appendChild(this.pinButton(entry.filePath));

    const name = document.createElement('span');
    name.className = 'doc-browser-tile-name';
    name.textContent = entry.fileName;

    const dir = document.createElement('span');
    dir.className = 'doc-browser-tile-path';
    dir.textContent = parentDir(entry.filePath);

    const when = document.createElement('span');
    when.className = 'doc-browser-tile-time';
    when.textContent = formatTimeAgo(entry.openedAt);

    tile.appendChild(name);
    tile.appendChild(dir);
    tile.appendChild(when);
    return tile;
  }

  private select(index: number): void {
    if (this.items.length === 0) {
      this.selectedIndex = 0;
      return;
    }
    const clamped = Math.max(0, Math.min(this.items.length - 1, index));
    if (clamped === this.selectedIndex) return;

    this.tiles[this.selectedIndex]?.classList.remove(SELECTED_CLASS);
    this.selectedIndex = clamped;
    const tile = this.tiles[clamped];
    tile?.classList.add(SELECTED_CLASS);
    tile?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Move a row up or down inside the current section; past its edge, step
   * into the neighbouring section.
   */
  private moveVertical(direction: 1 | -1): void {
    const tile = this.tiles[this.selectedIndex];
    if (!tile) return;

    const grid = tile.parentElement;
    if (!grid) return;
    const siblings = Array.from(grid.children) as HTMLElement[];
    const firstTop = siblings[0]?.offsetTop ?? 0;
    const columns = Math.max(
      1,
      siblings.filter((s) => s.offsetTop === firstTop).length
    );
    const position = siblings.indexOf(tile);
    const target = position + direction * columns;

    if (target >= 0 && target < siblings.length) {
      this.select(this.selectedIndex - position + target);
      return;
    }

    if (direction > 0) {
      const nextFirst = this.selectedIndex - position + siblings.length;
      if (nextFirst < this.items.length) this.select(nextFirst);
    } else {
      const prevLast = this.selectedIndex - position - 1;
      if (prevLast >= 0) this.select(prevLast);
    }
  }

  private activate(index: number): void {
    const item = this.items[index];
    if (!item) return;
    const openDocuments = this.snapshot?.open ?? [];

    this.hide();
    if (item.kind === 'open') {
      if (!item.entry.isCurrent) {
        this.callbacks.onSelectOpenDocument(item.entry);
      }
    } else if (item.kind === 'pinned') {
      const { windowId } = item.entry;
      const open = openDocuments.find((o) => o.windowId === windowId);
      if (windowId !== null && open) {
        if (!open.isCurrent) this.callbacks.onSelectOpenDocument(open);
      } else {
        this.callbacks.onSelectRecentFile(item.entry);
      }
    } else {
      this.callbacks.onSelectRecentFile(item.entry);
    }
  }
}

export function createDocumentBrowser(
  container: HTMLElement,
  callbacks: DocumentBrowserCallbacks
): DocumentBrowser {
  return new DocumentBrowser(container, callbacks);
}
