/**
 * OpenExternalDropdown - Toolbar dropdown button for opening files externally
 * (reveal in file manager or open in configured IDE)
 */

/**
 * Callbacks for dropdown interactions
 */
export interface OpenExternalDropdownCallbacks {
  onRevealInFileManager: () => void;
  onOpenInEditor: () => void;
}

/**
 * OpenExternalDropdown component
 * A dropdown button in the toolbar for external file operations
 */
export class OpenExternalDropdown {
  private container: HTMLElement;
  private button: HTMLButtonElement | null = null;
  private menu: HTMLElement | null = null;
  private revealBtn: HTMLButtonElement | null = null;
  private editorBtn: HTMLButtonElement | null = null;
  private callbacks: OpenExternalDropdownCallbacks | null = null;
  private isOpen = false;
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
    this.button = this.container.querySelector('#open-external-btn');
    this.menu = this.container.querySelector('.dropdown-menu');
    this.revealBtn = this.container.querySelector('#reveal-in-file-manager-btn');
    this.editorBtn = this.container.querySelector('#open-in-editor-btn');
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    this.button?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isEnabled) {
        this.toggleMenu();
      }
    });

    this.revealBtn?.addEventListener('click', () => {
      this.closeMenu();
      this.callbacks?.onRevealInFileManager();
    });

    this.editorBtn?.addEventListener('click', () => {
      this.closeMenu();
      this.callbacks?.onOpenInEditor();
    });
  }

  /**
   * Set callbacks
   */
  setCallbacks(callbacks: OpenExternalDropdownCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Enable or disable the dropdown (disabled when no file is open)
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (this.button) {
      this.button.disabled = !enabled;
    }
    if (!enabled) {
      this.closeMenu();
    }
  }

  /**
   * Update the editor menu item label and visibility
   * Pass null to hide the "Open in Editor" option
   */
  setEditorLabel(name: string | null): void {
    if (!this.editorBtn) return;
    if (name) {
      this.editorBtn.textContent = `Open in ${name}`;
      this.editorBtn.classList.remove('hidden');
    } else {
      this.editorBtn.classList.add('hidden');
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
    if (!this.isEnabled) return;

    this.isOpen = true;
    this.menu?.classList.remove('hidden');
    this.container.classList.add('is-open');

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
   * Cleanup event listeners
   */
  destroy(): void {
    document.removeEventListener('click', this.boundHandleOutsideClick);
    document.removeEventListener('keydown', this.boundHandleKeydown);
  }
}

/**
 * Factory function to create an OpenExternalDropdown
 */
export function createOpenExternalDropdown(container: HTMLElement): OpenExternalDropdown {
  return new OpenExternalDropdown(container);
}
