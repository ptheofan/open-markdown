/**
 * OpenPathBar - Open a document by typing or pasting its path
 *
 * A bar with one text box. The path is resolved in main as the user types,
 * so a relative path shows where it will land before Enter opens it. Esc
 * closes the bar.
 */
import type { PathResolveResult } from '@shared/types';

export interface OpenPathBarCallbacks {
  /** Resolve the typed text against this window's document */
  resolve: (input: string) => Promise<PathResolveResult>;
  /** Open the resolved file in this window */
  onOpen: (filePath: string) => void;
  /** Folder relative paths start from, or null to start from home */
  getBaseDir: () => string | null;
}

const BAR_CLASS = 'open-path-bar';
const VISIBLE_CLASS = 'open-path-bar-visible';
const STATUS_OK_CLASS = 'open-path-status-ok';
const STATUS_ERROR_CLASS = 'open-path-status-error';
const DEBOUNCE_MS = 120;

export class OpenPathBar {
  private readonly element: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly status: HTMLDivElement;
  private readonly callbacks: OpenPathBarCallbacks;
  private readonly handleKeydown: (e: KeyboardEvent) => void;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every resolve so a slow answer cannot overwrite a newer one */
  private resolveSeq = 0;
  private lastResult: PathResolveResult | null = null;
  private lastResolvedInput = '';
  private visible = false;

  constructor(container: HTMLElement, callbacks: OpenPathBarCallbacks) {
    this.callbacks = callbacks;
    this.element = this.createElement();
    this.input = this.element.querySelector(
      '.open-path-input'
    ) as HTMLInputElement;
    this.status = this.element.querySelector(
      '.open-path-status'
    ) as HTMLDivElement;
    this.handleKeydown = (e) => this.onGlobalKeydown(e);
    this.setupEventListeners();
    container.appendChild(this.element);
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    if (this.visible) {
      this.input.focus();
      this.input.select();
      return;
    }

    this.visible = true;
    this.element.classList.add(VISIBLE_CLASS);
    this.showHint();
    document.addEventListener('keydown', this.handleKeydown);
    this.input.focus();
    this.input.select();
  }

  hide(): void {
    if (!this.visible) return;

    this.visible = false;
    this.resolveSeq++;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.element.classList.remove(VISIBLE_CLASS);
    document.removeEventListener('keydown', this.handleKeydown);
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  destroy(): void {
    this.hide();
    this.element.remove();
  }

  private createElement(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = BAR_CLASS;
    el.innerHTML = `
      <div class="open-path-row">
        <span class="open-path-label">Open path</span>
        <input class="open-path-input" type="text" spellcheck="false"
               autocomplete="off" autocorrect="off" autocapitalize="off"
               placeholder="/full/path/to/file.md or a path relative to this document"
               aria-label="Path of the document to open" />
        <button class="open-path-close" title="Close (Escape)">&#x2715;</button>
      </div>
      <div class="open-path-status" aria-live="polite"></div>
    `;
    return el;
  }

  private setupEventListeners(): void {
    // Clicking the bar's chrome should not pull focus away from the box
    this.element.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.target !== this.input) {
        e.preventDefault();
      }
    });

    this.input.addEventListener('input', () => {
      this.scheduleResolve();
    });

    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });

    this.element
      .querySelector('.open-path-close')!
      .addEventListener('click', () => {
        this.hide();
      });
  }

  private onGlobalKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.visible) {
      e.preventDefault();
      this.hide();
    }
  }

  private scheduleResolve(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    if (!this.input.value.trim()) {
      this.resolveSeq++;
      this.lastResult = null;
      this.lastResolvedInput = '';
      this.showHint();
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.resolveNow();
    }, DEBOUNCE_MS);
  }

  /**
   * Ask main where the current text lands and show the answer, unless the
   * text changed again meanwhile.
   */
  private async resolveNow(): Promise<PathResolveResult | null> {
    const input = this.input.value;
    if (!input.trim()) return null;

    const seq = ++this.resolveSeq;
    let result: PathResolveResult;
    try {
      result = await this.callbacks.resolve(input);
    } catch (error) {
      console.error('Failed to resolve path:', error);
      result = { success: false, error: 'Could not resolve that path.' };
    }
    if (seq !== this.resolveSeq) return null;

    this.lastResult = result;
    this.lastResolvedInput = input;
    this.showResult(result);
    return result;
  }

  /**
   * Open what the box resolves to. A pending resolve is run first so Enter
   * right after a paste still opens the right file.
   */
  private async submit(): Promise<void> {
    if (!this.input.value.trim()) return;

    let result = this.lastResult;
    if (!result || this.lastResolvedInput !== this.input.value) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      result = await this.resolveNow();
    }

    if (result?.success && result.filePath) {
      const filePath = result.filePath;
      this.hide();
      this.callbacks.onOpen(filePath);
    }
  }

  private showHint(): void {
    const baseDir = this.callbacks.getBaseDir();
    this.setStatus(
      baseDir
        ? `Relative paths start from ${baseDir}`
        : 'No document open: relative paths start from your home folder',
      null
    );
  }

  private showResult(result: PathResolveResult): void {
    if (result.success && result.filePath) {
      this.setStatus(result.filePath, STATUS_OK_CLASS);
      return;
    }
    const where = result.filePath ? `${result.filePath} — ` : '';
    this.setStatus(
      `${where}${result.error ?? 'Cannot open that path.'}`,
      STATUS_ERROR_CLASS
    );
  }

  private setStatus(text: string, cls: string | null): void {
    this.status.textContent = text;
    this.status.title = text;
    this.status.classList.toggle(STATUS_OK_CLASS, cls === STATUS_OK_CLASS);
    this.status.classList.toggle(
      STATUS_ERROR_CLASS,
      cls === STATUS_ERROR_CLASS
    );
  }
}

export function createOpenPathBar(
  container: HTMLElement,
  callbacks: OpenPathBarCallbacks
): OpenPathBar {
  return new OpenPathBar(container, callbacks);
}
