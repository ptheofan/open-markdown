/**
 * OutlinePanel - Sidebar listing the document's headings.
 *
 * Stays in sync with the rendered content (live reload, edit mode, theme
 * re-renders) through a MutationObserver, highlights the section at the top
 * of the viewport while the document scrolls, and lets the user jump between
 * the panel and the document in both directions.
 */

export interface OutlinePanelOptions {
  /** The panel element itself (its own scroll container) */
  panel: HTMLElement;
  /** The element that scrolls the document (#markdown-viewer) */
  scrollContainer: HTMLElement;
  /** The rendered markdown (#markdown-content) */
  contentContainer: HTMLElement;
  /** Called whenever the panel's visibility changes */
  onVisibilityChange?: (visible: boolean) => void;
}

export interface OutlineEntry {
  element: HTMLElement;
  level: number;
  text: string;
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const ITEM_CLASS = 'outline-item';
const ACTIVE_CLASS = 'outline-item-active';
const EMPTY_CLASS = 'outline-panel-empty';
const COLLAPSED_CLASS = 'outline-panel-collapsed';

/**
 * A heading within this band below the top edge of the viewport "owns" the
 * view, as does any heading above it. The band is the larger of this value
 * and a quarter of the viewport, so a heading that has just scrolled into
 * its reading position counts before it reaches the very edge.
 */
const TOP_TOLERANCE_PX = 8;
const TOP_BAND_FRACTION = 0.25;

/** Fallback when the browser never fires `scrollend` for a programmatic scroll */
const PROGRAMMATIC_SCROLL_TIMEOUT_MS = 1000;

export class OutlinePanel {
  private readonly panel: HTMLElement;
  private readonly scrollContainer: HTMLElement;
  private readonly contentContainer: HTMLElement;
  private readonly onVisibilityChange: ((visible: boolean) => void) | null;

  private readonly list: HTMLElement;
  private entries: OutlineEntry[] = [];
  private items: HTMLElement[] = [];
  private activeIndex = -1;

  /** Index chosen by a click; held until the user scrolls the document */
  private pinnedIndex: number | null = null;
  /** True while a scroll the panel started is still in flight */
  private programmaticScroll = false;
  private programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null;

  private visible = true;
  private refreshScheduled = false;
  private scrollScheduled = false;

  private readonly observer: MutationObserver;
  private readonly handleScroll: () => void;
  private readonly handleScrollEnd: () => void;
  private readonly handleContentClick: (e: MouseEvent) => void;
  private readonly handlePanelClick: (e: MouseEvent) => void;

  constructor(options: OutlinePanelOptions) {
    this.panel = options.panel;
    this.scrollContainer = options.scrollContainer;
    this.contentContainer = options.contentContainer;
    this.onVisibilityChange = options.onVisibilityChange ?? null;

    this.list = document.createElement('nav');
    this.list.className = 'outline-list';
    this.list.setAttribute('aria-label', 'Document outline');
    this.panel.appendChild(this.list);

    this.handleScroll = () => this.onScroll();
    this.handleScrollEnd = () => this.endProgrammaticScroll();
    this.handleContentClick = (e) => this.onContentClick(e);
    this.handlePanelClick = (e) => this.onPanelClick(e);

    this.scrollContainer.addEventListener('scroll', this.handleScroll, {
      passive: true,
    });
    this.scrollContainer.addEventListener('scrollend', this.handleScrollEnd);
    this.contentContainer.addEventListener('click', this.handleContentClick);
    this.list.addEventListener('click', this.handlePanelClick);

    this.observer = new MutationObserver(() => this.scheduleRefresh());
    this.observer.observe(this.contentContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    this.refresh();
  }

  /**
   * Rebuild the outline from the headings currently in the document
   */
  refresh(): void {
    this.refreshScheduled = false;

    const headings = Array.from(
      this.contentContainer.querySelectorAll<HTMLElement>(HEADING_SELECTOR)
    );
    this.entries = headings
      .map((element) => ({
        element,
        level: Number(element.tagName.slice(1)),
        text: (element.textContent ?? '').trim(),
      }))
      .filter((entry) => entry.text.length > 0);

    const minLevel = this.entries.reduce(
      (min, entry) => Math.min(min, entry.level),
      6
    );

    this.list.textContent = '';
    this.items = this.entries.map((entry, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = ITEM_CLASS;
      item.dataset.index = String(index);
      item.dataset.level = String(entry.level);
      item.style.setProperty('--outline-depth', String(entry.level - minLevel));
      item.textContent = entry.text;
      item.title = entry.text;
      this.list.appendChild(item);
      return item;
    });

    this.activeIndex = -1;
    this.pinnedIndex = null;
    this.panel.classList.toggle(EMPTY_CLASS, this.entries.length === 0);
    this.applyLayout();
    this.updateActiveFromScroll();
  }

  /**
   * Headings currently listed, in document order
   */
  getEntries(): readonly OutlineEntry[] {
    return this.entries;
  }

  /**
   * Index of the highlighted entry, or -1 when there is none
   */
  getActiveIndex(): number {
    return this.activeIndex;
  }

  /**
   * Show or hide the panel. A hidden panel keeps tracking the document so it
   * is up to date the moment it is shown again.
   */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.applyLayout();
    this.onVisibilityChange?.(visible);
    if (visible) this.updateActiveFromScroll();
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  /**
   * Highlight the section that contains `node` and bring it into view in the
   * panel. Used when the user clicks somewhere in the document body.
   */
  activateSectionContaining(node: Node): void {
    const index = this.findSectionIndex(node);
    if (index < 0) return;
    this.pinnedIndex = index;
    this.setActive(index);
  }

  /**
   * Scroll the document so the heading at `index` sits at the top of the view
   */
  scrollToEntry(index: number): void {
    const entry = this.entries[index];
    if (!entry) return;

    this.pinnedIndex = index;
    this.setActive(index);

    // Land the heading where the document's own top padding would put it,
    // not flush against the edge.
    const padding =
      parseFloat(getComputedStyle(this.scrollContainer).paddingTop) || 0;
    const containerTop = this.scrollContainer.getBoundingClientRect().top;
    const headingTop = entry.element.getBoundingClientRect().top;
    const target =
      this.scrollContainer.scrollTop + (headingTop - containerTop) - padding;

    this.beginProgrammaticScroll();
    this.scrollContainer.scrollTo({
      top: Math.max(0, target),
      behavior: 'smooth',
    });
  }

  destroy(): void {
    this.observer.disconnect();
    this.scrollContainer.removeEventListener('scroll', this.handleScroll);
    this.scrollContainer.removeEventListener('scrollend', this.handleScrollEnd);
    this.contentContainer.removeEventListener('click', this.handleContentClick);
    this.list.removeEventListener('click', this.handlePanelClick);
    if (this.programmaticScrollTimer)
      clearTimeout(this.programmaticScrollTimer);
    this.list.remove();
  }

  // ---------------------------------------------------------------------------

  private applyLayout(): void {
    const shown = this.visible && this.entries.length > 0;
    this.panel.classList.toggle(COLLAPSED_CLASS, !shown);
    this.panel.setAttribute('aria-hidden', shown ? 'false' : 'true');
  }

  private scheduleRefresh(): void {
    if (this.refreshScheduled) return;
    this.refreshScheduled = true;
    requestAnimationFrame(() => {
      if (this.refreshScheduled) this.refresh();
    });
  }

  private onScroll(): void {
    if (this.programmaticScroll) return;
    // The user took over: whatever was pinned by a click no longer applies.
    this.pinnedIndex = null;
    if (this.scrollScheduled) return;
    this.scrollScheduled = true;
    requestAnimationFrame(() => {
      this.scrollScheduled = false;
      this.updateActiveFromScroll();
    });
  }

  private beginProgrammaticScroll(): void {
    this.programmaticScroll = true;
    if (this.programmaticScrollTimer)
      clearTimeout(this.programmaticScrollTimer);
    this.programmaticScrollTimer = setTimeout(
      () => this.endProgrammaticScroll(),
      PROGRAMMATIC_SCROLL_TIMEOUT_MS
    );
  }

  private endProgrammaticScroll(): void {
    this.programmaticScroll = false;
    if (this.programmaticScrollTimer) {
      clearTimeout(this.programmaticScrollTimer);
      this.programmaticScrollTimer = null;
    }
  }

  /**
   * Highlight the heading whose section is at the top of the viewport: the
   * last heading at or above the top edge, or the first heading when all of
   * them are still below it. Bounding rects are used (not offsetTop) so zoom,
   * which scales the content with a CSS transform, is accounted for.
   */
  private updateActiveFromScroll(): void {
    if (this.pinnedIndex !== null) {
      this.setActive(this.pinnedIndex);
      return;
    }
    if (this.entries.length === 0) {
      this.setActive(-1);
      return;
    }

    const containerTop = this.scrollContainer.getBoundingClientRect().top;
    const band = Math.max(
      TOP_TOLERANCE_PX,
      this.scrollContainer.clientHeight * TOP_BAND_FRACTION
    );
    let active = 0;
    for (const [i, entry] of this.entries.entries()) {
      const top = entry.element.getBoundingClientRect().top - containerTop;
      if (top <= band) {
        active = i;
      } else {
        break;
      }
    }
    this.setActive(active);
  }

  private setActive(index: number): void {
    if (index === this.activeIndex) return;
    this.items[this.activeIndex]?.classList.remove(ACTIVE_CLASS);
    this.items[this.activeIndex]?.removeAttribute('aria-current');
    this.activeIndex = index;
    const item = this.items[index];
    if (!item) return;
    item.classList.add(ACTIVE_CLASS);
    item.setAttribute('aria-current', 'true');
    this.revealItem(item);
  }

  /**
   * Scroll the panel (and only the panel) so `item` is in view
   */
  private revealItem(item: HTMLElement): void {
    const panelTop = this.panel.scrollTop;
    const panelBottom = panelTop + this.panel.clientHeight;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;

    if (itemTop < panelTop) {
      this.panel.scrollTop = itemTop;
    } else if (itemBottom > panelBottom) {
      this.panel.scrollTop = itemBottom - this.panel.clientHeight;
    }
  }

  /**
   * The entry whose section contains `node`: the last heading that is, or
   * comes before, the node in document order. -1 when the node precedes
   * every heading.
   */
  private findSectionIndex(node: Node): number {
    let index = -1;
    for (const [i, entry] of this.entries.entries()) {
      const heading = entry.element;
      if (heading === node || heading.contains(node)) return i;
      const position = heading.compareDocumentPosition(node);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }

  private onContentClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Node)) return;
    this.activateSectionContaining(target);
  }

  private onPanelClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const item = target?.closest<HTMLElement>(`.${ITEM_CLASS}`);
    if (!item) return;
    e.preventDefault();
    const index = Number(item.dataset.index);
    if (Number.isInteger(index)) this.scrollToEntry(index);
  }
}

export function createOutlinePanel(options: OutlinePanelOptions): OutlinePanel {
  return new OutlinePanel(options);
}
