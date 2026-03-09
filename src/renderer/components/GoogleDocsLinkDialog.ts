/**
 * GoogleDocsLinkDialog - Modal for pasting a Google Doc URL to link
 */

/**
 * Callbacks for dialog interactions
 */
export interface GoogleDocsLinkDialogCallbacks {
  onLink?: (url: string) => void;
  onCancel?: () => void;
}

/**
 * GoogleDocsLinkDialog component
 * A modal dialog for linking a local file to a Google Doc by URL
 */
export class GoogleDocsLinkDialog {
  private overlay: HTMLElement;
  private urlInput: HTMLInputElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private errorEl: HTMLElement | null = null;
  private callbacks: GoogleDocsLinkDialogCallbacks = {};

  constructor(overlay: HTMLElement) {
    this.overlay = overlay;
    this.cacheElements();
    this.setupEventListeners();
  }

  /**
   * Cache DOM element references
   */
  private cacheElements(): void {
    this.urlInput = this.overlay.querySelector('#gdocs-url-input');
    this.confirmBtn = this.overlay.querySelector('#gdocs-link-confirm');
    this.cancelBtn = this.overlay.querySelector('#gdocs-link-cancel');
    this.errorEl = this.overlay.querySelector('#gdocs-link-error');
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    this.confirmBtn?.addEventListener('click', () => this.handleConfirm());
    this.cancelBtn?.addEventListener('click', () => this.hide());
    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
    this.urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleConfirm();
      if (e.key === 'Escape') this.hide();
    });
    // Clear error on input
    this.urlInput?.addEventListener('input', () => this.hideError());
  }

  /**
   * Handle confirm button click / Enter key
   */
  private handleConfirm(): void {
    const url = this.urlInput?.value.trim() ?? '';
    if (!url) {
      this.showError('Please enter a Google Docs URL');
      return;
    }
    if (!url.includes('docs.google.com/document/d/')) {
      this.showError('Invalid URL. Expected: https://docs.google.com/document/d/...');
      return;
    }
    this.callbacks.onLink?.(url);
  }

  /**
   * Set the callbacks for dialog interactions
   */
  setCallbacks(callbacks: GoogleDocsLinkDialogCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Show the dialog
   */
  show(): void {
    this.overlay.classList.remove('hidden');
    this.urlInput?.focus();
    this.hideError();
  }

  /**
   * Hide the dialog and reset state
   */
  hide(): void {
    this.overlay.classList.add('hidden');
    if (this.urlInput) this.urlInput.value = '';
    this.hideError();
    this.callbacks.onCancel?.();
  }

  /**
   * Show an error message
   */
  showError(message: string): void {
    if (this.errorEl) {
      this.errorEl.textContent = message;
      this.errorEl.classList.remove('hidden');
    }
  }

  /**
   * Hide the error message
   */
  hideError(): void {
    if (this.errorEl) {
      this.errorEl.textContent = '';
      this.errorEl.classList.add('hidden');
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Event listeners are on elements inside overlay, will be GC'd with overlay
  }
}

/**
 * Factory function to create a GoogleDocsLinkDialog
 */
export function createGoogleDocsLinkDialog(overlay: HTMLElement): GoogleDocsLinkDialog {
  return new GoogleDocsLinkDialog(overlay);
}
