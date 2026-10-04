/**
 * FolderTree - the Files pane of the sidebar
 *
 * Lists a folder's markdown files as a tree. Directories load when they are
 * expanded, so opening a large repository is instant; the folder is watched
 * so files that appear, disappear or move show up on their own. The row for
 * the document on screen is highlighted, the keyboard walks the tree, and a
 * filter box narrows the whole folder by fuzzy name match.
 */
import type { ContextMenuItem, FolderEntry, FolderListOptions } from '@shared/types';

import { rankByFuzzy } from '../services/fuzzy';

export interface FolderTreeDeps {
  list: (dirPath: string, options: FolderListOptions) => Promise<FolderEntry[]>;
  /** Every document under the root, relative to it, for the filter */
  listAll: (root: string, options: { showAll: boolean }) => Promise<string[]>;
  watch: (dirPath: string) => Promise<void>;
  unwatch: (dirPath: string) => Promise<void>;
  onOpenFile: (filePath: string, options: { newWindow: boolean }) => void;
  /** The user closed the folder with the header button */
  onClose: () => void;
  /** Native context menu; resolves to the chosen item id */
  showContextMenu?: (items: ContextMenuItem[]) => Promise<string | null>;
  onRevealInFileManager?: (targetPath: string) => void;
  onCopyPath?: (targetPath: string) => void;
}

/** Most rows the filter shows at once */
const FILTER_LIMIT = 200;
/** localStorage key for the "all files" toggle */
const SHOW_ALL_KEY = 'folder-tree-show-all';

const ROW_CLASS = 'folder-item';
const SELECTED_CLASS = 'folder-item-selected';
const CURRENT_CLASS = 'folder-item-current';

const CHEVRON_SVG =
  '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>';
const FOLDER_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31zM2.19 4a1 1 0 0 0-.996 1.09l.637 7a1 1 0 0 0 .995.91h10.348a1 1 0 0 0 .995-.91l.637-7A1 1 0 0 0 13.81 4H2.19zm4.69-1.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707z"/></svg>';
const FILE_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/></svg>';

function baseName(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return slash >= 0 ? p.slice(slash + 1) : p;
}

function parentOf(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return slash > 0 ? p.slice(0, slash) : p;
}

function joinPath(dir: string, rel: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const trimmed = dir.endsWith(sep) ? dir.slice(0, -1) : dir;
  return `${trimmed}${sep}${rel.split('/').join(sep)}`;
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith('/') ? root : `${root}/`) || target.startsWith(`${root}\\`);
}

interface Row {
  path: string;
  kind: 'file' | 'directory';
  name: string;
  depth: number;
  /** Shown under the name while filtering */
  hint?: string;
  expanded?: boolean;
  loading?: boolean;
}

export class FolderTree {
  private readonly container: HTMLElement;
  private readonly deps: FolderTreeDeps;

  private readonly header: HTMLElement;
  private readonly title: HTMLElement;
  private readonly toggleAllButton: HTMLButtonElement;
  private readonly filterInput: HTMLInputElement;
  private readonly tree: HTMLElement;

  private root: string | null = null;
  private readonly children = new Map<string, FolderEntry[]>();
  private readonly expanded = new Set<string>();
  private readonly loading = new Set<string>();
  private currentFile: string | null = null;
  private selectedPath: string | null = null;
  private query = '';
  private allFiles: string[] | null = null;
  private allFilesLoading = false;
  private showAll = false;
  /** Bumped whenever the folder changes, so stale listings are dropped */
  private generation = 0;
  private rows: Row[] = [];

  private readonly handleTreeKeydown: (e: KeyboardEvent) => void;
  private readonly handleTreeClick: (e: MouseEvent) => void;
  private readonly handleTreeContextMenu: (e: MouseEvent) => void;
  private readonly handleFilterInput: () => void;
  private readonly handleFilterKeydown: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement, deps: FolderTreeDeps) {
    this.container = container;
    this.deps = deps;
    this.container.classList.add('folder-panel');

    try {
      this.showAll = localStorage.getItem(SHOW_ALL_KEY) === '1';
    } catch {
      // Storage unavailable: start with documents only
    }

    this.header = document.createElement('div');
    this.header.className = 'folder-header';

    this.title = document.createElement('span');
    this.title.className = 'folder-title';
    this.header.appendChild(this.title);

    this.toggleAllButton = document.createElement('button');
    this.toggleAllButton.type = 'button';
    this.toggleAllButton.className = 'folder-header-btn';
    this.toggleAllButton.dataset.folderToggleAll = '';
    this.toggleAllButton.textContent = 'All';
    this.toggleAllButton.addEventListener('click', () => {
      this.setShowAll(!this.showAll);
    });
    this.header.appendChild(this.toggleAllButton);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'folder-header-btn';
    closeButton.dataset.folderClose = '';
    closeButton.title = 'Close folder';
    closeButton.setAttribute('aria-label', 'Close folder');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => {
      this.deps.onClose();
    });
    this.header.appendChild(closeButton);

    this.filterInput = document.createElement('input');
    this.filterInput.type = 'search';
    this.filterInput.className = 'folder-filter';
    this.filterInput.placeholder = 'Filter files…';
    this.filterInput.setAttribute('aria-label', 'Filter files');
    this.filterInput.spellcheck = false;

    this.tree = document.createElement('div');
    this.tree.className = 'folder-tree';
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Files');
    this.tree.tabIndex = 0;

    this.container.appendChild(this.header);
    this.container.appendChild(this.filterInput);
    this.container.appendChild(this.tree);

    this.handleTreeKeydown = (e) => this.onTreeKeydown(e);
    this.handleTreeClick = (e) => this.onTreeClick(e);
    this.handleTreeContextMenu = (e) => this.onTreeContextMenu(e);
    this.handleFilterInput = () => {
      this.query = this.filterInput.value.trim();
      this.selectedPath = null;
      void this.ensureAllFiles();
      this.render();
    };
    this.handleFilterKeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        this.onTreeKeydown(e);
      } else if (e.key === 'Escape' && this.query) {
        e.preventDefault();
        this.filterInput.value = '';
        this.handleFilterInput();
      }
    };

    this.tree.addEventListener('keydown', this.handleTreeKeydown);
    this.tree.addEventListener('click', this.handleTreeClick);
    this.tree.addEventListener('contextmenu', this.handleTreeContextMenu);
    this.filterInput.addEventListener('input', this.handleFilterInput);
    this.filterInput.addEventListener('keydown', this.handleFilterKeydown);

    this.updateToggleAll();
  }

  // ---------------------------------------------------------------------------
  // Public API

  /** Show a folder, replacing any folder shown before */
  async open(root: string): Promise<void> {
    if (this.root === root) return;
    await this.close({ silent: true });

    this.generation++;
    this.root = root;
    this.title.textContent = baseName(root) || root;
    this.title.title = root;
    this.expanded.add(root);
    this.render();
    await this.load(root);
    if (this.currentFile) await this.revealCurrent();
  }

  /** Stop showing the folder and release its watchers */
  async close(options: { silent?: boolean } = {}): Promise<void> {
    if (!this.root) return;
    const watched = [...this.expanded];
    this.generation++;
    this.root = null;
    this.children.clear();
    this.expanded.clear();
    this.loading.clear();
    this.allFiles = null;
    this.selectedPath = null;
    this.query = '';
    this.filterInput.value = '';
    this.render();
    await Promise.all(watched.map((dir) => this.deps.unwatch(dir).catch(() => undefined)));
    if (!options.silent) this.deps.onClose();
  }

  isOpen(): boolean {
    return this.root !== null;
  }

  getRoot(): string | null {
    return this.root;
  }

  getShowAll(): boolean {
    return this.showAll;
  }

  /** Include files that are not markdown and hidden entries */
  setShowAll(showAll: boolean): void {
    if (this.showAll === showAll) return;
    this.showAll = showAll;
    try {
      localStorage.setItem(SHOW_ALL_KEY, showAll ? '1' : '0');
    } catch {
      // Storage unavailable: the choice just does not survive a restart
    }
    this.updateToggleAll();
    this.allFiles = null;
    void this.ensureAllFiles();
    void this.reloadExpanded();
  }

  /** Highlight the document on screen and open the folders down to it */
  setCurrentFile(filePath: string | null): void {
    this.currentFile = filePath;
    this.selectedPath = filePath;
    if (filePath && this.root && isWithin(this.root, filePath)) {
      void this.revealCurrent();
    } else {
      this.render();
    }
  }

  /** Put the keyboard in the filter box */
  focus(): void {
    this.filterInput.focus();
    this.filterInput.select();
  }

  /** A watched directory changed on disk: list it again */
  handleChange(dirPath: string): void {
    if (!this.root) return;
    this.allFiles = null;
    if (this.expanded.has(dirPath)) {
      void this.load(dirPath);
    }
    if (this.query) void this.ensureAllFiles();
  }

  /** Paths of the rows on screen, top to bottom */
  getVisiblePaths(): string[] {
    return this.rows.map((row) => row.path);
  }

  destroy(): void {
    void this.close({ silent: true });
    this.tree.removeEventListener('keydown', this.handleTreeKeydown);
    this.tree.removeEventListener('click', this.handleTreeClick);
    this.tree.removeEventListener('contextmenu', this.handleTreeContextMenu);
    this.filterInput.removeEventListener('input', this.handleFilterInput);
    this.filterInput.removeEventListener('keydown', this.handleFilterKeydown);
    this.header.remove();
    this.filterInput.remove();
    this.tree.remove();
    this.container.classList.remove('folder-panel');
  }

  // ---------------------------------------------------------------------------
  // Loading

  private async load(dirPath: string): Promise<void> {
    const root = this.root;
    if (!root) return;
    const generation = this.generation;
    this.loading.add(dirPath);
    this.render();

    let entries: FolderEntry[] = [];
    try {
      entries = await this.deps.list(dirPath, { root, showAll: this.showAll });
    } catch {
      entries = [];
    }
    if (generation !== this.generation || !this.expanded.has(dirPath)) return;

    this.children.set(dirPath, entries);
    this.loading.delete(dirPath);
    this.render();
    void this.deps.watch(dirPath).catch(() => undefined);
  }

  private async reloadExpanded(): Promise<void> {
    for (const dir of [...this.expanded]) {
      await this.load(dir);
    }
  }

  private async ensureAllFiles(): Promise<void> {
    if (!this.query || !this.root || this.allFiles || this.allFilesLoading) return;
    const root = this.root;
    const generation = this.generation;
    this.allFilesLoading = true;
    try {
      const files = await this.deps.listAll(root, { showAll: this.showAll });
      if (generation === this.generation && this.root === root) {
        this.allFiles = files;
      }
    } catch {
      if (generation === this.generation) this.allFiles = [];
    } finally {
      this.allFilesLoading = false;
    }
    this.render();
  }

  private async expand(dirPath: string): Promise<void> {
    if (this.expanded.has(dirPath)) return;
    this.expanded.add(dirPath);
    await this.load(dirPath);
  }

  private collapse(dirPath: string): void {
    if (!this.expanded.has(dirPath)) return;
    this.expanded.delete(dirPath);
    // Every folder below it is closed too, so no watcher outlives its row
    for (const dir of [...this.expanded]) {
      if (isWithin(dirPath, dir)) {
        this.expanded.delete(dir);
        this.children.delete(dir);
        void this.deps.unwatch(dir).catch(() => undefined);
      }
    }
    this.children.delete(dirPath);
    this.loading.delete(dirPath);
    void this.deps.unwatch(dirPath).catch(() => undefined);
    this.render();
  }

  /** Expand the folders between the root and the current file, then show it */
  private async revealCurrent(): Promise<void> {
    const root = this.root;
    const target = this.currentFile;
    if (!root || !target || !isWithin(root, target)) return;
    const generation = this.generation;

    let dir = parentOf(target);
    const chain: string[] = [];
    while (isWithin(root, dir) && dir !== root) {
      chain.unshift(dir);
      const next = parentOf(dir);
      if (next === dir) break;
      dir = next;
    }
    for (const ancestor of chain) {
      if (generation !== this.generation) return;
      await this.expand(ancestor);
    }
    if (generation !== this.generation) return;
    this.render();
    this.scrollRowIntoView(CURRENT_CLASS);
  }

  /** jsdom has no scrollIntoView, so the call is guarded */
  private scrollRowIntoView(className: string): void {
    const row = this.tree.querySelector<HTMLElement>(`.${className}`);
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering

  private buildRows(): Row[] {
    const root = this.root;
    if (!root) return [];

    if (this.query) {
      if (!this.allFiles) return [];
      return rankByFuzzy(this.query, this.allFiles, (p) => p)
        .slice(0, FILTER_LIMIT)
        .map(({ item }) => ({
          path: joinPath(root, item),
          kind: 'file' as const,
          name: baseName(item),
          depth: 0,
          hint: item.includes('/') ? item.slice(0, item.lastIndexOf('/')) : '',
        }));
    }

    const rows: Row[] = [];
    const visit = (dirPath: string, depth: number): void => {
      if (this.loading.has(dirPath) && !this.children.has(dirPath)) {
        rows.push({ path: `${dirPath}\u0000loading`, kind: 'file', name: 'Loading…', depth, loading: true });
        return;
      }
      for (const entry of this.children.get(dirPath) ?? []) {
        if (entry.kind === 'directory') {
          const expanded = this.expanded.has(entry.path);
          rows.push({ path: entry.path, kind: 'directory', name: entry.name, depth, expanded });
          if (expanded) visit(entry.path, depth + 1);
        } else {
          rows.push({ path: entry.path, kind: 'file', name: entry.name, depth });
        }
      }
    };
    visit(root, 0);
    return rows;
  }

  private render(): void {
    this.rows = this.buildRows();
    this.tree.textContent = '';
    this.container.classList.toggle('folder-panel-open', this.root !== null);

    if (!this.root) return;

    if (this.rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'folder-empty';
      if (this.query) {
        empty.textContent = this.allFiles ? 'No matching files' : 'Searching…';
      } else if (this.loading.has(this.root)) {
        empty.textContent = 'Loading…';
      } else {
        empty.textContent = this.showAll ? 'Empty folder' : 'No markdown files';
      }
      this.tree.appendChild(empty);
      return;
    }

    if (this.selectedPath && !this.rows.some((row) => row.path === this.selectedPath)) {
      this.selectedPath = null;
    }

    for (const row of this.rows) {
      const item = document.createElement('div');
      item.className = ROW_CLASS;
      item.dataset.path = row.path;
      item.dataset.kind = row.kind;
      item.style.setProperty('--depth', String(row.depth));
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-level', String(row.depth + 1));
      if (row.loading) {
        item.classList.add('folder-item-loading');
        item.setAttribute('aria-disabled', 'true');
      }
      if (row.kind === 'directory') {
        item.setAttribute('aria-expanded', row.expanded ? 'true' : 'false');
      }
      if (row.path === this.currentFile) item.classList.add(CURRENT_CLASS);
      if (row.path === this.selectedPath) {
        item.classList.add(SELECTED_CLASS);
        item.setAttribute('aria-selected', 'true');
      }

      const chevron = document.createElement('span');
      chevron.className = 'folder-item-chevron';
      if (row.kind === 'directory') chevron.innerHTML = CHEVRON_SVG;
      item.appendChild(chevron);

      const icon = document.createElement('span');
      icon.className = 'folder-item-icon';
      if (!row.loading) icon.innerHTML = row.kind === 'directory' ? FOLDER_SVG : FILE_SVG;
      item.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'folder-item-name';
      name.textContent = row.name;
      item.appendChild(name);
      item.title = row.loading ? '' : row.path;

      if (row.hint) {
        const hint = document.createElement('span');
        hint.className = 'folder-item-path';
        hint.textContent = row.hint;
        item.appendChild(hint);
      }

      this.tree.appendChild(item);
    }
  }

  private updateToggleAll(): void {
    this.toggleAllButton.classList.toggle('folder-header-btn-active', this.showAll);
    this.toggleAllButton.setAttribute('aria-pressed', String(this.showAll));
    this.toggleAllButton.title = this.showAll ? 'Show markdown files only' : 'Show all files';
  }

  // ---------------------------------------------------------------------------
  // Interaction

  private rowAt(target: EventTarget | null): Row | null {
    if (!(target instanceof Element)) return null;
    const item = target.closest<HTMLElement>(`.${ROW_CLASS}`);
    const rowPath = item?.dataset.path;
    if (!rowPath) return null;
    return this.rows.find((row) => row.path === rowPath) ?? null;
  }

  private onTreeClick(e: MouseEvent): void {
    const row = this.rowAt(e.target);
    if (!row || row.loading) return;
    this.selectedPath = row.path;
    if (row.kind === 'directory') {
      if (row.expanded) this.collapse(row.path);
      else void this.expand(row.path);
    } else {
      this.deps.onOpenFile(row.path, { newWindow: e.metaKey || e.ctrlKey });
      this.render();
    }
  }

  private onTreeContextMenu(e: MouseEvent): void {
    const row = this.rowAt(e.target);
    if (!row || row.loading || !this.deps.showContextMenu) return;
    e.preventDefault();
    this.selectedPath = row.path;
    this.render();

    const items: ContextMenuItem[] = [];
    if (row.kind === 'file') {
      items.push({ id: 'open', label: 'Open', enabled: true });
      items.push({ id: 'open-new-window', label: 'Open in New Window', enabled: true });
    }
    items.push({ id: 'reveal', label: 'Reveal in File Manager', enabled: !!this.deps.onRevealInFileManager });
    items.push({ id: 'copy-path', label: 'Copy Path', enabled: !!this.deps.onCopyPath });

    void this.deps.showContextMenu(items).then((choice) => {
      switch (choice) {
        case 'open':
          this.deps.onOpenFile(row.path, { newWindow: false });
          break;
        case 'open-new-window':
          this.deps.onOpenFile(row.path, { newWindow: true });
          break;
        case 'reveal':
          this.deps.onRevealInFileManager?.(row.path);
          break;
        case 'copy-path':
          this.deps.onCopyPath?.(row.path);
          break;
        default:
          break;
      }
    });
  }

  private onTreeKeydown(e: KeyboardEvent): void {
    const selectable = this.rows.filter((row) => !row.loading);
    if (selectable.length === 0) return;
    const index = selectable.findIndex((row) => row.path === this.selectedPath);
    const current = index >= 0 ? selectable[index] : undefined;

    const select = (row: Row | undefined): void => {
      if (!row) return;
      this.selectedPath = row.path;
      this.render();
      this.scrollRowIntoView(SELECTED_CLASS);
    };

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        select(selectable[index < 0 ? 0 : Math.min(index + 1, selectable.length - 1)]);
        break;
      case 'ArrowUp':
        e.preventDefault();
        select(selectable[index < 0 ? selectable.length - 1 : Math.max(index - 1, 0)]);
        break;
      case 'Home':
        e.preventDefault();
        select(selectable[0]);
        break;
      case 'End':
        e.preventDefault();
        select(selectable[selectable.length - 1]);
        break;
      case 'ArrowRight':
        if (!current || current.kind !== 'directory') return;
        e.preventDefault();
        if (current.expanded) select(selectable[index + 1]);
        else void this.expand(current.path);
        break;
      case 'ArrowLeft': {
        if (!current) return;
        e.preventDefault();
        if (current.kind === 'directory' && current.expanded) {
          this.collapse(current.path);
          return;
        }
        const parent = parentOf(current.path);
        select(selectable.find((row) => row.path === parent));
        break;
      }
      case 'Enter':
      case ' ':
        if (!current) {
          if (e.key === 'Enter') {
            e.preventDefault();
            select(selectable[0]);
          }
          return;
        }
        e.preventDefault();
        if (current.kind === 'directory') {
          if (current.expanded) this.collapse(current.path);
          else void this.expand(current.path);
        } else {
          this.deps.onOpenFile(current.path, { newWindow: e.metaKey || e.ctrlKey });
        }
        break;
      default:
        break;
    }
  }
}

export function createFolderTree(container: HTMLElement, deps: FolderTreeDeps): FolderTree {
  return new FolderTree(container, deps);
}
