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
    this.el.focus();
  }

  /** Serialize the current DOM, hand it to the caller, and end the session. */
  commit(): void {
    if (this.committed) return;
    this.committed = true;
    const markdown = serializeInline(this.el);
    this.el.removeAttribute('contenteditable');
    this.callbacks.onCommit(markdown);
  }

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
