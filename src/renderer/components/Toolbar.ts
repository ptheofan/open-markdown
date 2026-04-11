/**
 * Toolbar - Component for the application toolbar
 */
import type { ThemeMode } from '@shared/types';

/**
 * Toolbar event callbacks
 */
export interface ToolbarCallbacks {
  onOpenFile?: () => void;
  onToggleTheme?: () => void;
  onOpenPreferences?: () => void;
  onToggleEditMode?: () => void;
  onSave?: () => void;
}

/**
 * Toolbar component
 */
export class Toolbar {
  private element: HTMLElement;
  private openFileBtn: HTMLButtonElement | null = null;
  private preferencesBtn: HTMLButtonElement | null = null;
  private themeToggleBtn: HTMLButtonElement | null = null;
  private editModeBtn: HTMLButtonElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private fileNameElement: HTMLElement | null = null;
  private themeIconLight: HTMLElement | null = null;
  private themeIconDark: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks = {};

  constructor(element: HTMLElement) {
    this.element = element;
    this.cacheElements();
    this.setupEventListeners();
  }

  /**
   * Cache DOM element references
   */
  private cacheElements(): void {
    this.openFileBtn = this.element.querySelector('#open-file-btn');
    this.preferencesBtn = this.element.querySelector('#preferences-btn');
    this.themeToggleBtn = this.element.querySelector('#theme-toggle-btn');
    this.editModeBtn = this.element.querySelector('#edit-mode-btn');
    this.saveBtn = this.element.querySelector('#save-btn');
    this.fileNameElement = this.element.querySelector('#file-name');
    this.themeIconLight = this.element.querySelector('#theme-icon-light');
    this.themeIconDark = this.element.querySelector('#theme-icon-dark');
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    this.openFileBtn?.addEventListener('click', () => {
      this.callbacks.onOpenFile?.();
    });

    this.preferencesBtn?.addEventListener('click', () => {
      this.callbacks.onOpenPreferences?.();
    });

    this.themeToggleBtn?.addEventListener('click', () => {
      this.callbacks.onToggleTheme?.();
    });

    this.editModeBtn?.addEventListener('click', () => {
      this.callbacks.onToggleEditMode?.();
    });

    this.saveBtn?.addEventListener('click', () => {
      this.callbacks.onSave?.();
    });
  }

  /**
   * Set toolbar callbacks
   */
  setCallbacks(callbacks: ToolbarCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Update the displayed file name
   */
  setFileName(fileName: string | null): void {
    if (this.fileNameElement) {
      if (fileName) {
        this.fileNameElement.textContent = fileName;
        this.fileNameElement.classList.add('has-file');
        this.fileNameElement.title = fileName;
      } else {
        this.fileNameElement.textContent = 'No file open';
        this.fileNameElement.classList.remove('has-file');
        this.fileNameElement.title = '';
      }
    }
  }

  /**
   * Update the theme toggle icon
   */
  setTheme(theme: ThemeMode): void {
    const isDark = theme === 'dark';

    if (this.themeIconLight && this.themeIconDark) {
      // Show sun icon in dark mode (to switch to light)
      // Show moon icon in light mode (to switch to dark)
      this.themeIconLight.style.display = isDark ? '' : 'none';
      this.themeIconDark.style.display = isDark ? 'none' : '';
    }

    // Update button title
    if (this.themeToggleBtn) {
      this.themeToggleBtn.title = `Switch to ${isDark ? 'light' : 'dark'} theme`;
    }
  }

  /**
   * Update the edit mode toggle button state
   */
  setEditMode(isActive: boolean): void {
    if (this.editModeBtn) {
      if (isActive) {
        this.editModeBtn.classList.add('toolbar-btn-active');
        this.editModeBtn.title = 'Exit edit mode';
      } else {
        this.editModeBtn.classList.remove('toolbar-btn-active');
        this.editModeBtn.title = 'Enter edit mode';
      }
    }
  }

  /**
   * Show or hide the save button (visible when auto-save is off in edit mode)
   */
  setSaveButtonVisible(visible: boolean): void {
    if (this.saveBtn) {
      this.saveBtn.classList.toggle('hidden', !visible);
    }
  }

  /**
   * Set the save button enabled state
   */
  setSaveButtonEnabled(enabled: boolean): void {
    if (this.saveBtn) {
      this.saveBtn.disabled = !enabled;
    }
  }

  /**
   * Enable or disable the toolbar
   */
  setEnabled(enabled: boolean): void {
    const buttons = this.element.querySelectorAll('button');
    buttons.forEach((btn) => {
      (btn).disabled = !enabled;
    });
  }
}

/**
 * Factory function to create a Toolbar
 */
export function createToolbar(element: HTMLElement): Toolbar {
  return new Toolbar(element);
}
