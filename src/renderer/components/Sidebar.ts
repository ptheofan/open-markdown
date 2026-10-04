/**
 * Sidebar - the column beside the document, holding Files and Outline
 *
 * Each pane says for itself whether it has anything to show: the Files pane
 * when a folder is open, the Outline pane when the outline panel is neither
 * collapsed nor orphaned by an empty window. The sidebar shows whichever
 * panes are available, puts a tab strip above them when there are two, and
 * hides altogether when there are none. Its width can be dragged and is
 * remembered.
 */

export type SidebarTab = 'files' | 'outline';

export interface SidebarOptions {
  /** The <aside> that holds everything */
  root: HTMLElement;
  /** The tab strip inside it */
  tabs: HTMLElement;
  filesPane: HTMLElement;
  outlinePane: HTMLElement;
  /** The document viewer; the outline has nothing to show while it is hidden */
  viewer: HTMLElement;
  onTabChange?: (tab: SidebarTab) => void;
}

const HIDDEN_CLASS = 'sidebar-hidden';
const PANE_ACTIVE_CLASS = 'sidebar-pane-active';
const TAB_ACTIVE_CLASS = 'sidebar-tab-active';
const OUTLINE_COLLAPSED_CLASS = 'outline-panel-collapsed';
const WIDTH_KEY = 'sidebar-width';
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 640;
export const SIDEBAR_DEFAULT_WIDTH = 240;

export class Sidebar {
  private readonly root: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly filesPane: HTMLElement;
  private readonly outlinePane: HTMLElement;
  private readonly viewer: HTMLElement;
  private readonly onTabChange: ((tab: SidebarTab) => void) | null;
  private readonly resizer: HTMLElement;
  private readonly observer: MutationObserver;

  private filesAvailable = false;
  /** The tab the user last asked for; shown whenever it is available */
  private preferred: SidebarTab = 'files';
  private active: SidebarTab | null = null;
  private width = SIDEBAR_DEFAULT_WIDTH;

  private readonly handleTabClick: (e: MouseEvent) => void;
  private readonly handleResizeStart: (e: PointerEvent) => void;

  constructor(options: SidebarOptions) {
    this.root = options.root;
    this.tabs = options.tabs;
    this.filesPane = options.filesPane;
    this.outlinePane = options.outlinePane;
    this.viewer = options.viewer;
    this.onTabChange = options.onTabChange ?? null;

    this.filesPane.classList.add('sidebar-pane');
    this.outlinePane.classList.add('sidebar-pane');

    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(saved) && saved > 0) this.width = saved;
    } catch {
      // Storage unavailable: default width
    }
    this.applyWidth();

    this.resizer = document.createElement('div');
    this.resizer.className = 'sidebar-resizer';
    this.resizer.setAttribute('role', 'separator');
    this.resizer.setAttribute('aria-orientation', 'vertical');
    this.resizer.setAttribute('aria-label', 'Resize sidebar');
    this.root.appendChild(this.resizer);

    this.handleTabClick = (e) => {
      const button = (e.target as Element | null)?.closest<HTMLElement>('[data-sidebar-tab]');
      const tab = button?.dataset.sidebarTab;
      if (tab === 'files' || tab === 'outline') this.activate(tab);
    };
    this.handleResizeStart = (e) => this.onResizeStart(e);
    this.tabs.addEventListener('click', this.handleTabClick);
    this.resizer.addEventListener('pointerdown', this.handleResizeStart);

    // The outline collapses and expands on its own as headings come and go
    this.observer = new MutationObserver(() => this.update());
    this.observer.observe(this.outlinePane, { attributes: true, attributeFilter: ['class'] });
    this.observer.observe(this.viewer, { attributes: true, attributeFilter: ['class'] });

    this.update();
  }

  /** Whether the Files pane has a folder to show */
  setFilesAvailable(available: boolean): void {
    if (this.filesAvailable === available) return;
    this.filesAvailable = available;
    if (available) this.preferred = 'files';
    this.update();
  }

  /** Bring a tab to the front; it stays the preferred one from now on */
  activate(tab: SidebarTab): void {
    this.preferred = tab;
    this.update();
  }

  getActiveTab(): SidebarTab | null {
    return this.active;
  }

  isVisible(): boolean {
    return !this.root.classList.contains(HIDDEN_CLASS);
  }

  getWidth(): number {
    return this.width;
  }

  setWidth(width: number): void {
    this.width = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
    this.applyWidth();
  }

  destroy(): void {
    this.observer.disconnect();
    this.tabs.removeEventListener('click', this.handleTabClick);
    this.resizer.removeEventListener('pointerdown', this.handleResizeStart);
    this.resizer.remove();
  }

  // ---------------------------------------------------------------------------

  private outlineAvailable(): boolean {
    return (
      !this.outlinePane.classList.contains(OUTLINE_COLLAPSED_CLASS) &&
      !this.viewer.classList.contains('hidden')
    );
  }

  private update(): void {
    const outline = this.outlineAvailable();
    const files = this.filesAvailable;

    let active: SidebarTab | null = null;
    if (files && outline) active = this.preferred;
    else if (files) active = 'files';
    else if (outline) active = 'outline';

    this.root.classList.toggle(HIDDEN_CLASS, active === null);
    this.root.setAttribute('aria-hidden', active === null ? 'true' : 'false');
    this.tabs.classList.toggle('hidden', !(files && outline));

    this.filesPane.classList.toggle(PANE_ACTIVE_CLASS, active === 'files');
    this.outlinePane.classList.toggle(PANE_ACTIVE_CLASS, active === 'outline');
    for (const button of this.tabs.querySelectorAll<HTMLElement>('[data-sidebar-tab]')) {
      const isActive = button.dataset.sidebarTab === active;
      button.classList.toggle(TAB_ACTIVE_CLASS, isActive);
      button.setAttribute('aria-selected', String(isActive));
    }

    if (active !== this.active) {
      this.active = active;
      if (active) this.onTabChange?.(active);
    }
  }

  private applyWidth(): void {
    this.root.style.setProperty('--sidebar-width', `${this.width}px`);
  }

  private onResizeStart(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = this.width;
    this.root.classList.add('sidebar-resizing');

    const move = (ev: PointerEvent): void => {
      this.setWidth(startWidth + (ev.clientX - startX));
    };
    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      this.root.classList.remove('sidebar-resizing');
      try {
        localStorage.setItem(WIDTH_KEY, String(this.width));
      } catch {
        // Storage unavailable: the width just does not survive a restart
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }
}

export function createSidebar(options: SidebarOptions): Sidebar {
  return new Sidebar(options);
}
