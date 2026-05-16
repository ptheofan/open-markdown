/**
 * InlineEditor - Manages one segment's WYSIWYG editing session.
 *
 * Makes a slice's `.slice-content` element `contenteditable`, owns the caret
 * and keyboard shortcuts, toggles inline marks via DOM Range manipulation, and
 * on commit hands the serialized markdown back to the caller. It deliberately
 * knows nothing about slices or markdown blocks — `EditModeController` adapts
 * between this and the slice model.
 */
import { serializeInline } from '../services/inlineMarkdownSerializer';

export interface InlineEditorCallbacks {
  /** Called once when the session commits, with the segment's inline markdown. */
  onCommit: (markdown: string) => void;
  /** Called when the user requests link insertion (Cmd+K). Optional. */
  onRequestLink?: () => void;
  /**
   * Called when Enter is pressed inside the editor. `beforeMd` is everything
   * to the left of the caret, `afterMd` everything to the right. The editor
   * has already torn down its session; the caller is responsible for splitting
   * the slice and opening a new edit on the new content. If absent, Enter
   * falls back to browser default behaviour.
   */
  onSplit?: (beforeMd: string, afterMd: string) => void;
  /**
   * Called when the user presses ArrowUp on the first visual line, or
   * ArrowDown on the last visual line — i.e. would otherwise have nowhere
   * to go inside this slice. The caller commits the current session and
   * opens editing on the adjacent slice. If absent, falls back to browser
   * default (caret stays put or scrolls).
   */
  onNavigate?: (direction: 'up' | 'down') => void;
}

/** The inline marks the editor can toggle. */
export type InlineMark = 'bold' | 'italic' | 'strikethrough' | 'code';

/** Maps a mark to the element tag it is represented by in the DOM. */
const MARK_TAG: Record<InlineMark, string> = {
  bold: 'STRONG',
  italic: 'EM',
  strikethrough: 'DEL',
  code: 'CODE',
};

/** Tags treated as equivalent to the canonical tag for a mark. */
const MARK_ALIASES: Record<InlineMark, string[]> = {
  bold: ['STRONG', 'B'],
  italic: ['EM', 'I'],
  strikethrough: ['DEL', 'S'],
  code: ['CODE'],
};

export class InlineEditor {
  private el: HTMLElement;
  private callbacks: InlineEditorCallbacks;
  private committed = false;

  constructor(el: HTMLElement, callbacks: InlineEditorCallbacks) {
    this.el = el;
    this.callbacks = callbacks;
  }

  /** Begin the session: make the element editable and focus it. */
  start(): void {
    this.el.setAttribute('contenteditable', 'true');
    this.el.spellcheck = false;
    this.el.addEventListener('keydown', this.onKeyDown);
    this.el.focus();
  }

  /** Serialize the current DOM, hand it to the caller, and end the session. */
  commit(): void {
    if (this.committed) return;
    this.committed = true;
    this.el.removeEventListener('keydown', this.onKeyDown);
    const markdown = serializeInline(this.el);
    this.el.removeAttribute('contenteditable');
    this.callbacks.onCommit(markdown);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.commit();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && this.callbacks.onSplit) {
      e.preventDefault();
      this.splitAtCaret();
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      this.insertLineBreak();
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.callbacks.onNavigate) {
      const dir = e.key === 'ArrowUp' ? 'up' : 'down';
      if (this.isCaretOnEdgeLine(dir)) {
        e.preventDefault();
        this.callbacks.onNavigate(dir);
        return;
      }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    const key = e.key.toLowerCase();
    if (key === 'b') {
      e.preventDefault();
      this.toggleMark('bold');
    } else if (key === 'i') {
      e.preventDefault();
      this.toggleMark('italic');
    } else if (key === 'e') {
      e.preventDefault();
      this.toggleMark('code');
    } else if (key === 'x' && e.shiftKey) {
      e.preventDefault();
      this.toggleMark('strikethrough');
    } else if (key === 'k') {
      e.preventDefault();
      this.callbacks.onRequestLink?.();
    }
  };

  /** Toggle an inline mark over the current selection. */
  toggleMark(mark: InlineMark): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.commonAncestorContainer)) return;

    if (this.isMarkActive(mark)) {
      this.unwrapMark(range, mark);
    } else {
      this.wrapMark(range, mark);
    }
    this.el.focus();
  }

  /** True when the whole selection sits inside an element for `mark`. */
  isMarkActive(mark: InlineMark): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const aliases = MARK_ALIASES[mark];
    let node: Node | null = this.deepestStart(range);
    while (node && node !== this.el) {
      if (node.nodeType === Node.ELEMENT_NODE
          && aliases.includes((node as Element).tagName)) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  // commonAncestorContainer can be a parent above the mark element when the
  // selection covers all of an element's contents (selectNodeContents). Descend
  // into the deepest node actually inside the selection so the ancestor walk
  // starts from somewhere the mark element can be reached upward.
  /**
   * Split the editor's DOM at the caret. Serializes the two halves to markdown
   * and hands them to `onSplit`. Ends this editor session (without firing
   * onCommit again) — the caller drives the slice split and re-opens editing.
   */
  private splitAtCaret(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.commonAncestorContainer)) return;

    range.deleteContents();

    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    afterRange.setEnd(this.el, this.el.childNodes.length);
    const afterFrag = afterRange.extractContents();

    const afterWrapper = document.createElement('div');
    afterWrapper.appendChild(afterFrag);
    const afterMd = serializeInline(afterWrapper);
    const beforeMd = serializeInline(this.el);

    this.committed = true;
    this.el.removeEventListener('keydown', this.onKeyDown);
    this.el.removeAttribute('contenteditable');

    this.callbacks.onSplit?.(beforeMd, afterMd);
  }

  /**
   * Is the caret on the first (for 'up') or last (for 'down') visual line of
   * the editor? Used to decide whether ArrowUp/Down should stay inside the
   * slice or cross the boundary to an adjacent slice.
   *
   * In jsdom all bounding rects are zero, so both checks return true — that's
   * fine for unit tests that exercise the cross-slice path; the geometric
   * branching matters only in a real layout engine.
   */
  private isCaretOnEdgeLine(dir: 'up' | 'down'): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.commonAncestorContainer)) return false;

    // Range.getBoundingClientRect is on the DOM spec but missing from older
    // jsdom builds — fall back to a zero-rect (which makes both edge checks
    // pass, the behaviour we want under jsdom-driven tests anyway).
    const caretRect = typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : { top: 0, bottom: 0 } as DOMRect;
    const elRect = this.el.getBoundingClientRect();
    const threshold = 4;

    return dir === 'up'
      ? caretRect.top - elRect.top < threshold
      : elRect.bottom - caretRect.bottom < threshold;
  }

  /** Insert a <br> at the caret (Shift+Enter — soft line break inside the slice). */
  private insertLineBreak(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.commonAncestorContainer)) return;

    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);

    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private deepestStart(range: Range): Node {
    let node: Node = range.startContainer;
    let offset = range.startOffset;
    while (node.nodeType === Node.ELEMENT_NODE) {
      const child = node.childNodes[offset];
      if (!child) break;
      node = child;
      offset = 0;
    }
    return node;
  }

  private wrapMark(range: Range, mark: InlineMark): void {
    const wrapper = document.createElement(MARK_TAG[mark]);
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    const sel = window.getSelection()!;
    const newRange = document.createRange();
    newRange.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  /**
   * Wrap the current selection in an anchor pointing at `href`. An empty
   * `href` unwraps an existing anchor over the selection instead.
   */
  applyLink(href: string): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.commonAncestorContainer)) return;

    const existing = this.findAncestorTag(range, 'A') as HTMLAnchorElement | null;
    if (existing) {
      const parent = existing.parentNode!;
      while (existing.firstChild) {
        parent.insertBefore(existing.firstChild, existing);
      }
      parent.removeChild(existing);
    }
    if (!href) return;

    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    anchor.appendChild(range.extractContents());
    range.insertNode(anchor);
    this.el.focus();
  }

  private findAncestorTag(range: Range, tag: string): Element | null {
    let node: Node | null = this.deepestStart(range);
    while (node && node !== this.el) {
      if (node.nodeType === Node.ELEMENT_NODE
          && (node as Element).tagName === tag) {
        return node as Element;
      }
      node = node.parentNode;
    }
    return null;
  }

  private unwrapMark(range: Range, mark: InlineMark): void {
    const aliases = MARK_ALIASES[mark];
    let node: Node | null = this.deepestStart(range);
    while (node && node !== this.el) {
      if (node.nodeType === Node.ELEMENT_NODE
          && aliases.includes((node as Element).tagName)) {
        const markEl = node as HTMLElement;
        const parent = markEl.parentNode!;
        while (markEl.firstChild) {
          parent.insertBefore(markEl.firstChild, markEl);
        }
        parent.removeChild(markEl);
        return;
      }
      node = node.parentNode;
    }
  }
}
