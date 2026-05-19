/**
 * PreviewableSourceEditor - Drives a "preview above source" editing session
 * for a slice owned by a PreviewablePlugin.
 *
 * Layout it builds inside the passed-in `.slice-content`:
 *
 *   <div class="slice-content">
 *     <div class="preview-source-preview">   ← preview (top, populated initially
 *                                              with the existing rendered content
 *                                              moved from the slice-content)
 *     <div class="preview-source-error" hidden>
 *       <span class="preview-source-error-text"></span>
 *     <textarea class="slice-raw-editor">    ← editor (bottom)
 *
 * Features: debounced 250ms re-render on input, race control via monotonic
 * requestId + scratch container (last keystroke wins), inline error chip
 * for {ok:false} renders, and idempotent commit on Esc/external trigger.
 */
import type { MarkdownSlice } from '../services/MarkdownSlicer';
import type { PreviewablePlugin } from '../../plugins/types/preview';

const DEBOUNCE_MS = 250;

export interface PreviewableSourceEditorCallbacks {
  /** Called once when the session commits, with the slice's new raw markdown. */
  onCommit: (newRaw: string) => void;
}

export class PreviewableSourceEditor {
  private el: HTMLElement;
  private slice: MarkdownSlice;
  private plugin: PreviewablePlugin;
  private callbacks: PreviewableSourceEditorCallbacks;
  private committed = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private latestRenderId = 0;
  private previewEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private errorTextEl!: HTMLElement;
  private textarea!: HTMLTextAreaElement;

  constructor(
    el: HTMLElement,
    slice: MarkdownSlice,
    plugin: PreviewablePlugin,
    callbacks: PreviewableSourceEditorCallbacks,
  ) {
    this.el = el;
    this.slice = slice;
    this.plugin = plugin;
    this.callbacks = callbacks;
  }

  start(): void {
    // Capture the slice-content's current children (the existing rendered
    // preview, e.g. a <div.mermaid-container> with SVG) — we'll move them
    // into the new preview area below.
    const existingChildren = Array.from(this.el.childNodes);

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'preview-source-preview';
    for (const child of existingChildren) this.previewEl.appendChild(child);

    this.errorEl = document.createElement('div');
    this.errorEl.className = 'preview-source-error';
    this.errorEl.hidden = true;
    this.errorTextEl = document.createElement('span');
    this.errorTextEl.className = 'preview-source-error-text';
    this.errorEl.appendChild(this.errorTextEl);

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'slice-raw-editor';
    this.textarea.spellcheck = false;
    this.textarea.value = this.plugin.extractSource(this.slice);

    this.el.replaceChildren(this.previewEl, this.errorEl, this.textarea);
    this.textarea.focus();
    this.textarea.addEventListener('input', this.onInput);
    this.textarea.addEventListener('keydown', this.onKeyDown);
  }

  commit(): void {
    if (this.committed) return;
    this.committed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.textarea.removeEventListener('input', this.onInput);
    this.textarea.removeEventListener('keydown', this.onKeyDown);
    const newRaw = this.plugin.applySourceToRaw(this.slice, this.textarea.value);
    this.callbacks.onCommit(newRaw);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.commit();
    }
  };

  private readonly onInput = (): void => {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runRender();
    }, DEBOUNCE_MS);
  };

  private async runRender(): Promise<void> {
    const myId = ++this.latestRenderId;
    const source = this.textarea.value;
    const scratch = document.createElement('div');
    const result = await this.plugin.renderPreview(source, scratch);
    if (this.committed || myId !== this.latestRenderId) return;
    if (result.ok) {
      this.previewEl.replaceChildren(...Array.from(scratch.childNodes));
      this.errorEl.hidden = true;
    } else {
      this.errorTextEl.textContent = result.error;
      this.errorEl.hidden = false;
    }
  }
}
