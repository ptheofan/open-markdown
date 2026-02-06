/**
 * RecentFilesDropdown - Dropdown for recently opened files
 *
 * Manages the chevron arrow button and dropdown menu within
 * the open-file split-button container.
 */
import type { RecentFileEntry } from '@shared/types';

export interface RecentFilesDropdownCallbacks {
  onSelectRecentFile: (filePath: string) => void;
  onClearRecentFiles: () => void;
}

export class RecentFilesDropdown {
  private container: HTMLElement;
  private arrowButton: HTMLButtonElement | null = null;
  private menu: HTMLElement | null = null;
  private emptyState: HTMLElement | null = null;
  private callbacks: RecentFilesDropdownCallbacks | null = null;
  private isOpen = false;

  private boundHandleOutsideClick: (e: MouseEvent) => void;
  private boundHandleKeydown: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
    this.boundHandleKeydown = this.handleKeydown.bind(this);
    this.cacheElements();
    this.setupEventListeners();
  }

  private cacheElements(): void {
    this.arrowButton = this.container.querySelector('#open-recent-btn');
    this.menu = this.container.querySelector('.dropdown-menu');
    this.emptyState = this.container.querySelector('.dropdown-empty');
  }

  private setupEventListeners(): void {
    this.arrowButton?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    this.menu?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const recentItem = target.closest('[data-recent-path]');
      if (recentItem instanceof HTMLElement) {
        const filePath = recentItem.getAttribute('data-recent-path');
        if (filePath) {
          this.closeMenu();
          if (e.metaKey || e.ctrlKey) {
            void window.electronAPI.window.openNew(filePath);
          } else {
            this.callbacks?.onSelectRecentFile(filePath);
          }
        }
        return;
      }

      const clearBtn = target.closest('.dropdown-footer-btn');
      if (clearBtn) {
        this.closeMenu();
        this.callbacks?.onClearRecentFiles();
      }
    });
  }

  setCallbacks(callbacks: RecentFilesDropdownCallbacks): void {
    this.callbacks = callbacks;
  }

  updateRecentFiles(files: RecentFileEntry[]): void {
    if (!this.menu || !this.emptyState) return;

    // Remove existing items and footer
    const existingItems = this.menu.querySelectorAll('.dropdown-item-recent, .dropdown-footer');
    existingItems.forEach((el) => el.remove());

    if (files.length === 0) {
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');

    // Add file items
    for (const file of files) {
      const button = document.createElement('button');
      button.className = 'dropdown-item-recent';
      button.setAttribute('data-recent-path', file.filePath);
      button.title = file.filePath;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'recent-file-name';
      nameSpan.textContent = file.fileName;

      const dirPath = file.filePath.substring(0, file.filePath.length - file.fileName.length - 1);
      const pathSpan = document.createElement('span');
      pathSpan.className = 'recent-file-path';
      pathSpan.textContent = dirPath;

      button.appendChild(nameSpan);
      button.appendChild(pathSpan);
      this.menu.appendChild(button);
    }

    // Add clear footer
    const footer = document.createElement('div');
    footer.className = 'dropdown-footer';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'dropdown-footer-btn';
    clearBtn.textContent = 'Clear Recent Files';

    footer.appendChild(clearBtn);
    this.menu.appendChild(footer);
  }

  private toggleMenu(): void {
    if (this.isOpen) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  }

  private openMenu(): void {
    this.isOpen = true;
    this.menu?.classList.remove('hidden');
    this.container.classList.add('is-open');

    document.addEventListener('click', this.boundHandleOutsideClick);
    document.addEventListener('keydown', this.boundHandleKeydown);
  }

  private closeMenu(): void {
    this.isOpen = false;
    this.menu?.classList.add('hidden');
    this.container.classList.remove('is-open');

    document.removeEventListener('click', this.boundHandleOutsideClick);
    document.removeEventListener('keydown', this.boundHandleKeydown);
  }

  private handleOutsideClick(e: MouseEvent): void {
    if (!this.container.contains(e.target as Node)) {
      this.closeMenu();
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.closeMenu();
      this.arrowButton?.focus();
    }
  }

  destroy(): void {
    document.removeEventListener('click', this.boundHandleOutsideClick);
    document.removeEventListener('keydown', this.boundHandleKeydown);
  }
}

export function createRecentFilesDropdown(container: HTMLElement): RecentFilesDropdown {
  return new RecentFilesDropdown(container);
}
