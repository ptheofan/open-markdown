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
}
