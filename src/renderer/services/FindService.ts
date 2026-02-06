export interface FindResult {
  activeMatchOrdinal: number;
  matches: number;
}

export class FindService {
  private readonly container: HTMLElement;
  private ranges: Range[] = [];
  private activeIndex = -1;
  private currentText = '';
  private currentMatchCase = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  find(text: string, options: { matchCase?: boolean } = {}): FindResult {
    this.clear();

    if (!text) {
      return { activeMatchOrdinal: 0, matches: 0 };
    }

    this.currentText = text;
    this.currentMatchCase = options.matchCase ?? false;

    const searchText = this.currentMatchCase ? text : text.toLowerCase();

    const walker = document.createTreeWalker(
      this.container,
      NodeFilter.SHOW_TEXT,
    );

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const content = node.textContent ?? '';
      const nodeText = this.currentMatchCase ? content : content.toLowerCase();

      let startPos = 0;
      let index: number;
      while ((index = nodeText.indexOf(searchText, startPos)) !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        this.ranges.push(range);
        startPos = index + text.length;
      }
    }

    if (this.ranges.length > 0) {
      this.activeIndex = 0;
      this.highlightMatches();
      this.scrollToActive();
    }

    return {
      activeMatchOrdinal: this.ranges.length > 0 ? 1 : 0,
      matches: this.ranges.length,
    };
  }

  findNext(forward = true): FindResult {
    if (this.ranges.length === 0) {
      return { activeMatchOrdinal: 0, matches: 0 };
    }

    if (forward) {
      this.activeIndex = (this.activeIndex + 1) % this.ranges.length;
    } else {
      this.activeIndex =
        (this.activeIndex - 1 + this.ranges.length) % this.ranges.length;
    }

    this.highlightMatches();
    this.scrollToActive();

    return {
      activeMatchOrdinal: this.activeIndex + 1,
      matches: this.ranges.length,
    };
  }

  clear(): void {
    CSS.highlights.delete('find-matches');
    CSS.highlights.delete('find-active-match');
    this.ranges = [];
    this.activeIndex = -1;
    this.currentText = '';
    this.currentMatchCase = false;
  }

  rerun(): FindResult | null {
    if (!this.currentText) {
      return null;
    }

    const text = this.currentText;
    const matchCase = this.currentMatchCase;
    return this.find(text, { matchCase });
  }

  private highlightMatches(): void {
    CSS.highlights.set('find-matches', new Highlight(...this.ranges));

    if (this.activeIndex >= 0 && this.activeIndex < this.ranges.length) {
      CSS.highlights.set(
        'find-active-match',
        new Highlight(this.ranges[this.activeIndex]!),
      );
    }
  }

  private scrollToActive(): void {
    if (this.activeIndex >= 0 && this.activeIndex < this.ranges.length) {
      this.ranges[this.activeIndex]!.startContainer.parentElement?.scrollIntoView(
        { block: 'center', behavior: 'smooth' },
      );
    }
  }
}
