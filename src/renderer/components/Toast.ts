/**
 * Toast - Simple toast notification component
 */

export type ToastType = 'success' | 'error';

interface ToastOptions {
  duration?: number;
}

/**
 * Toast notification component
 * Auto-dismisses after specified duration
 */
export class Toast {
  private container: HTMLElement;

  constructor() {
    this.container = this.createContainer();
  }

  /**
   * Create and attach the toast container to the DOM
   */
  private createContainer(): HTMLElement {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * Show a success toast
   */
  success(message: string, options?: ToastOptions): void {
    this.show(message, 'success', options?.duration ?? 2000);
  }

  /**
   * Show an error toast
   */
  error(message: string, options?: ToastOptions): void {
    this.show(message, 'error', options?.duration ?? 4000);
  }

  /**
   * Show a toast notification
   */
  private show(message: string, type: ToastType, duration: number): void {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Add to container
    this.container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    // Auto-dismiss
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-hiding');

      // Remove from DOM after animation
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 200);
    }, duration);
  }
}
