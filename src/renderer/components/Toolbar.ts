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
  onSave?: () => void;
  onEnterEditMode?: () => void;
  onCancelEdit?: () => void;
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
  private editSaveArrow: HTMLButtonElement | null = null;
  private editSaveGroup: HTMLElement | null = null;
  private editSaveMenu: HTMLElement | null = null;
  private editSaveLabel: HTMLElement | null = null;
  private editIcon: HTMLElement | null = null;
  private saveIcon: HTMLElement | null = null;
  private cancelEditBtn: HTMLButtonElement | null = null;
  private fileNameElement: HTMLElement | null = null;
  private themeIconLight: HTMLElement | null = null;
  private themeIconDark: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks = {};
  private isEditMode = false;

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
    this.editSaveArrow = this.element.querySelector('#edit-save-arrow');
    this.editSaveGroup = this.element.querySelector('#edit-save-group');
    this.editSaveMenu = this.element.querySelector('#edit-save-menu');
    this.editSaveLabel = this.element.querySelector('#edit-save-label');
    this.editIcon = this.element.querySelector('#edit-icon');
    this.saveIcon = this.element.querySelector('#save-icon');
    this.cancelEditBtn = this.element.querySelector('#cancel-edit-btn');
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

    // Main edit/save button - action depends on mode
    this.editModeBtn?.addEventListener('click', () => {
      if (this.isEditMode) {
        this.callbacks.onSave?.();
      } else {
        this.callbacks.onEnterEditMode?.();
      }
    });

    // Arrow button toggles dropdown
    this.editSaveArrow?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleEditSaveMenu();
    });

    // Cancel button in dropdown
    this.cancelEditBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeEditSaveMenu();
      this.callbacks.onCancelEdit?.();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      this.closeEditSaveMenu();
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
      this.themeIconLight.style.display = isDark ? '' : 'none';
      this.themeIconDark.style.display = isDark ? 'none' : '';
    }

    if (this.themeToggleBtn) {
      this.themeToggleBtn.title = `Switch to ${isDark ? 'light' : 'dark'} theme`;
    }
  }

  /**
   * Switch the edit/save button between Edit and Save states
   */
  setEditMode(isActive: boolean): void {
    this.isEditMode = isActive;

    if (isActive) {
      // Transform into Save button with dropdown arrow
      this.editModeBtn?.classList.add('toolbar-btn-active');
      this.editSaveGroup?.classList.add('is-editing');
      this.editSaveArrow?.classList.remove('hidden');
      if (this.editSaveLabel) this.editSaveLabel.textContent = 'Save';
      if (this.editModeBtn) this.editModeBtn.title = 'Save (Cmd+S)';
      this.editIcon?.classList.add('hidden');
      this.saveIcon?.classList.remove('hidden');
    } else {
      // Revert to Edit button (no dropdown)
      this.editModeBtn?.classList.remove('toolbar-btn-active');
      this.editSaveGroup?.classList.remove('is-editing');
      this.editSaveArrow?.classList.add('hidden');
      this.closeEditSaveMenu();
      if (this.editSaveLabel) this.editSaveLabel.textContent = 'Edit';
      if (this.editModeBtn) this.editModeBtn.title = 'Enter edit mode';
      this.editIcon?.classList.remove('hidden');
      this.saveIcon?.classList.add('hidden');
    }
  }

  /**
   * Toggle the dropdown menu on the save button
   */
  private toggleEditSaveMenu(): void {
    const isOpen = !this.editSaveMenu?.classList.contains('hidden');
    if (isOpen) {
      this.closeEditSaveMenu();
    } else {
      this.editSaveMenu?.classList.remove('hidden');
      this.editSaveGroup?.classList.add('is-open');
    }
  }

  /**
   * Close the dropdown menu
   */
  private closeEditSaveMenu(): void {
    this.editSaveMenu?.classList.add('hidden');
    this.editSaveGroup?.classList.remove('is-open');
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
