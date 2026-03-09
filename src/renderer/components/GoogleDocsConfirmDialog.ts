// src/renderer/components/GoogleDocsConfirmDialog.ts

export interface GoogleDocsConfirmDialogCallbacks {
  onConfirm?: () => void;
  onCancel?: () => void;
}

export class GoogleDocsConfirmDialog {
  private overlay: HTMLElement;
  private confirmBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private callbacks: GoogleDocsConfirmDialogCallbacks = {};

  constructor(overlay: HTMLElement) {
    this.overlay = overlay;
    this.confirmBtn = overlay.querySelector('#gdocs-confirm-overwrite');
    this.cancelBtn = overlay.querySelector('#gdocs-confirm-cancel');
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.confirmBtn?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onConfirm?.();
    });
    this.cancelBtn?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onCancel?.();
    });
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
        this.callbacks.onCancel?.();
      }
    });
  }

  setCallbacks(callbacks: GoogleDocsConfirmDialogCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  show(): void {
    this.overlay.classList.remove('hidden');
  }

  hide(): void {
    this.overlay.classList.add('hidden');
  }

  destroy(): void {}
}

export function createGoogleDocsConfirmDialog(overlay: HTMLElement): GoogleDocsConfirmDialog {
  return new GoogleDocsConfirmDialog(overlay);
}
