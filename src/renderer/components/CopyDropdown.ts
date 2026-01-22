/**
 * CopyDropdown - Dropdown button for document copy options
 */
import type { CopyDocumentType } from '../services/DocumentCopyService';

/**
 * Callbacks for dropdown interactions
 */
export interface CopyDropdownCallbacks {
  onSelect: (type: CopyDocumentType) => void;
}

/**
 * CopyDropdown component
 * A dropdown button with copy options for the document
 */
export class CopyDropdown {
  private container: HTMLElement;
  private button: HTMLButtonElement | null = null;
  private menu: HTMLElement | null = null;
  private dropdownIcon: HTMLElement | null = null;
  private spinner: HTMLElement | null = null;
  private callbacks: CopyDropdownCallbacks | null = null;
  private isOpen = false;
  private isLoading = false;
  private isEnabled = false;

  private boundHandleOutsideClick: (e: MouseEvent) => void;
  private boundHandleKeydown: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
    this.boundHandleKeydown = this.handleKeydown.bind(this);
    this.cacheElements();
    this.setupEventListeners();
  }

  /**
   * Cache DOM element references
   */
  private cacheElements(): void {
    this.button = this.container.querySelector('#copy-dropdown-btn');
    this.menu = this.container.querySelector('.dropdown-menu');
    this.dropdownIcon = this.container.querySelector('.dropdown-icon');
    this.spinner = this.container.querySelector('.spinner');
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    // Toggle menu on button click
    this.button?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.isLoading && this.isEnabled) {
        this.toggleMenu();
      }
    });

    // Handle menu item clicks
    this.menu?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const item = target.closest('[data-copy-type]');
      if (item instanceof HTMLElement) {
        const copyType = item.getAttribute('data-copy-type') as CopyDocumentType;
        if (copyType) {
          this.handleSelect(copyType);
        }
      }
    });
  }

  /**
   * Set the callback for copy type selection
   */
  setCallbacks(callbacks: CopyDropdownCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Enable or disable the dropdown
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (this.button) {
      this.button.disabled = !enabled || this.isLoading;
    }
    if (!enabled) {
      this.closeMenu();
    }
  }

  /**
   * Set loading state (spinner + disabled during operation)
   */
  setLoading(loading: boolean): void {
    this.isLoading = loading;

    if (this.button) {
      this.button.disabled = loading || !this.isEnabled;
    }

    if (this.dropdownIcon) {
      this.dropdownIcon.classList.toggle('hidden', loading);
    }

    if (this.spinner) {
      this.spinner.classList.toggle('hidden', !loading);
    }

    if (loading) {
      this.closeMenu();
    }
  }

  /**
   * Toggle the dropdown menu open/closed
   */
  private toggleMenu(): void {
    if (this.isOpen) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  }

  /**
   * Open the dropdown menu
   */
  private openMenu(): void {
    if (this.isLoading || !this.isEnabled) return;

    this.isOpen = true;
    this.menu?.classList.remove('hidden');
    this.container.classList.add('is-open');

    // Add listeners for closing
    document.addEventListener('click', this.boundHandleOutsideClick);
    document.addEventListener('keydown', this.boundHandleKeydown);
  }

  /**
   * Close the dropdown menu
   */
  private closeMenu(): void {
    this.isOpen = false;
    this.menu?.classList.add('hidden');
    this.container.classList.remove('is-open');

    // Remove listeners
    document.removeEventListener('click', this.boundHandleOutsideClick);
    document.removeEventListener('keydown', this.boundHandleKeydown);
  }

  /**
   * Handle clicks outside the dropdown
   */
  private handleOutsideClick(e: MouseEvent): void {
    if (!this.container.contains(e.target as Node)) {
      this.closeMenu();
    }
  }

  /**
   * Handle keyboard events
   */
  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.closeMenu();
      this.button?.focus();
    }
  }

  /**
   * Handle menu item selection
   */
  private handleSelect(type: CopyDocumentType): void {
    this.closeMenu();
    this.callbacks?.onSelect(type);
  }

  /**
   * Cleanup event listeners
   */
  destroy(): void {
    document.removeEventListener('click', this.boundHandleOutsideClick);
    document.removeEventListener('keydown', this.boundHandleKeydown);
  }
}

/**
 * Factory function to create a CopyDropdown
 */
export function createCopyDropdown(container: HTMLElement): CopyDropdown {
  return new CopyDropdown(container);
}
