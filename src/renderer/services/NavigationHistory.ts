/**
 * NavigationHistory - the back/forward stack of one window
 *
 * Every document the window shows is an entry; following a link, opening a
 * file, picking a recent one all push. Going back or forward moves a cursor
 * along the entries without discarding the ones ahead, until a new document
 * is opened from somewhere in the middle, which drops the forward entries as
 * a browser does. Each entry keeps the scroll position it was left at, so
 * going back lands where the reader was.
 */

export interface HistoryEntry {
  filePath: string;
  /** Scroll offset of the viewer when the entry was last shown */
  scrollTop: number;
}

export class NavigationHistory {
  private entries: HistoryEntry[] = [];
  private index = -1;

  constructor(private readonly limit = 100) {}

  /** The entry on show, or null before anything was opened */
  current(): HistoryEntry | null {
    return this.entries[this.index] ?? null;
  }

  canGoBack(): boolean {
    return this.index > 0;
  }

  canGoForward(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  /**
   * Record a document as the new current entry. Entries ahead of the cursor
   * are dropped. Opening the document already on show changes nothing.
   */
  push(filePath: string): void {
    const current = this.current();
    if (current && current.filePath === filePath) return;

    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ filePath, scrollTop: 0 });
    if (this.entries.length > this.limit) {
      this.entries.shift();
    }
    this.index = this.entries.length - 1;
  }

  /** Remember where the current entry is scrolled to */
  rememberScroll(scrollTop: number): void {
    const current = this.current();
    if (current) current.scrollTop = scrollTop;
  }

  /** Step back; null when there is nothing behind */
  back(): HistoryEntry | null {
    if (!this.canGoBack()) return null;
    this.index -= 1;
    return this.current();
  }

  /** Step forward; null when there is nothing ahead */
  forward(): HistoryEntry | null {
    if (!this.canGoForward()) return null;
    this.index += 1;
    return this.current();
  }

  /**
   * A document that no longer exists leaves the stack, so Back does not run
   * into it. The cursor stays on the nearest surviving entry.
   */
  remove(filePath: string): void {
    const kept: HistoryEntry[] = [];
    let newIndex = -1;
    this.entries.forEach((entry, i) => {
      if (entry.filePath === filePath) {
        if (i <= this.index) newIndex = Math.max(-1, kept.length - 1);
        return;
      }
      kept.push(entry);
      if (i === this.index) newIndex = kept.length - 1;
    });
    this.entries = kept;
    this.index = newIndex === -1 && kept.length > 0 ? Math.min(this.index, kept.length - 1) : newIndex;
    if (this.index >= this.entries.length) this.index = this.entries.length - 1;
  }

  /** For tests and the document browser: the stack as it stands */
  snapshot(): { entries: HistoryEntry[]; index: number } {
    return { entries: this.entries.map((e) => ({ ...e })), index: this.index };
  }
}
