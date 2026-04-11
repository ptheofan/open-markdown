/**
 * Renderer Entry Point
 * Initializes and coordinates all UI components
 */
import './index.css';

import {
  createMarkdownViewer,
  createDropZone,
  createToolbar,
  createStatusBar,
  createZoomController,
  createPreferencesPanel,
  createCopyDropdown,
  createChangeGutter,
  createFindBar,
  createRecentFilesDropdown,
  createGoogleDocsLinkDialog,
  createGoogleDocsButton,
  createGoogleDocsConfirmDialog,
  createOpenExternalDropdown,
  Toast,
  type MarkdownViewer,
  type DropZone,
  type Toolbar,
  type StatusBar,
  type ZoomController,
  type PreferencesPanel,
  type CopyDropdown,
  type ChangeGutter,
  type FindBar,
  type RecentFilesDropdown,
  type GoogleDocsLinkDialog,
  type GoogleDocsButton,
  type GoogleDocsConfirmDialog,
  type OpenExternalDropdown,
} from './renderer/components';
import type { EditModeCallbacks } from './renderer/components/EditModeController';
import {
  createDocumentCopyService,
  DiffService,
  FindService,
  type DocumentCopyService,
  type CopyDocumentType,
} from './renderer/services';
import { isDomainError } from '@shared/errors';
import { BUILTIN_PLUGINS } from '@shared/constants';
import { applyTheme as applyThemeCSS } from './themes';

import type {
  ThemeMode,
  FileChangeEvent,
  FileDeleteEvent,
  FullscreenChangeEvent,
  AppPreferences,
  DeepPartial,
  CorePreferences,
  ExternalEditorId,
  ExternalFileOpenEvent,
  RecentFileEntry,
  MermaidDiagramData,
} from '@shared/types';
import type { GoogleAuthState } from '@shared/types/google-docs';
import type { MermaidPlugin } from '@plugins/builtin/MermaidPlugin';
import type { ResolvedTheme } from './themes/types';

/**
 * Application state
 */
interface AppState {
  currentFilePath: string | null;
  currentTheme: ThemeMode;
  currentPreferences: CorePreferences | null;
  isWatching: boolean;
  isFullscreen: boolean;
  isEditMode: boolean;
  hasUnsavedChanges: boolean;
}

/**
 * Main Application class that coordinates all components
 */
class App {
  private markdownViewer: MarkdownViewer | null = null;
  private dropZone: DropZone | null = null;
  private toolbar: Toolbar | null = null;
  private statusBar: StatusBar | null = null;
  private zoomController: ZoomController | null = null;
  private preferencesPanel: PreferencesPanel | null = null;
  private copyDropdown: CopyDropdown | null = null;
  private documentCopyService: DocumentCopyService | null = null;
  private toast: Toast | null = null;
  private diffService: DiffService | null = null;
  private changeGutter: ChangeGutter | null = null;
  private findBar: FindBar | null = null;
  private findService: FindService | null = null;
  private recentFilesDropdown: RecentFilesDropdown | null = null;
  private googleDocsButton: GoogleDocsButton | null = null;
  private googleDocsLinkDialog: GoogleDocsLinkDialog | null = null;
  private googleDocsConfirmDialog: GoogleDocsConfirmDialog | null = null;
  private openExternalDropdown: OpenExternalDropdown | null = null;

  private state: AppState = {
    currentFilePath: null,
    currentTheme: 'system',
    currentPreferences: null,
    isWatching: false,
    isFullscreen: false,
    isEditMode: false,
    hasUnsavedChanges: false,
  };

  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  private cleanupFunctions: Array<() => void> = [];
  private contentRenderTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    try {
      await this.initializeComponents();
      await this.initializeTheme();
      await this.initializePreferences();
      await this.initializeFullscreenState();
      this.setupEventListeners();
      window.electronAPI.app.signalReady();
      await this.initializeRecentFiles();
      this.showWelcomeScreen();
    } catch (error) {
      console.error('Failed to initialize app:', error);
      this.showError('Failed to initialize application');
    }
  }

  /**
   * Initialize fullscreen state
   */
  private async initializeFullscreenState(): Promise<void> {
    try {
      const isFullscreen = await window.electronAPI.window.getFullscreen();
      this.state.isFullscreen = isFullscreen;
      this.updateToolbarForFullscreen(isFullscreen);
    } catch (error) {
      console.error('Failed to get fullscreen state:', error);
    }
  }

  /**
   * Initialize recent files dropdown with stored data
   */
  private async initializeRecentFiles(): Promise<void> {
    try {
      const files = await window.electronAPI.recentFiles.get();
      this.recentFilesDropdown?.updateRecentFiles(files);
    } catch (error) {
      console.error('Failed to load recent files:', error);
    }
  }

  /**
   * Initialize all UI components
   */
  private async initializeComponents(): Promise<void> {
    // Get DOM elements
    const viewerContainer = document.getElementById('markdown-content');
    const viewerElement = document.getElementById('markdown-viewer');
    const dropZoneElement = document.getElementById('drop-zone');
    const toolbarElement = document.getElementById('toolbar');
    const statusBarElement = document.getElementById('status-bar');
    const copyDropdownElement = document.getElementById('copy-dropdown');

    if (!viewerContainer || !viewerElement || !dropZoneElement || !toolbarElement || !statusBarElement) {
      throw new Error('Required DOM elements not found');
    }

    // Create components
    this.markdownViewer = createMarkdownViewer(viewerContainer);
    this.dropZone = createDropZone(dropZoneElement);
    this.toolbar = createToolbar(toolbarElement);
    this.statusBar = createStatusBar(statusBarElement);
    this.toast = new Toast();
    this.diffService = new DiffService();
    this.changeGutter = createChangeGutter({
      scrollContainer: viewerElement,
      contentContainer: viewerContainer,
      onReset: () => this.handleResetBaseline(),
    });

    this.findService = new FindService(viewerContainer);

    this.findBar = createFindBar(viewerElement, {
      onFind: (text, { matchCase }) => {
        const result = this.findService!.find(text, { matchCase });
        this.findBar!.updateResult(result);
      },
      onFindNext: (_text, { forward }) => {
        const result = this.findService!.findNext(forward);
        this.findBar!.updateResult(result);
      },
      onStopFinding: () => {
        this.findService!.clear();
      },
    });

    // Create copy dropdown if element exists
    if (copyDropdownElement) {
      this.copyDropdown = createCopyDropdown(copyDropdownElement);
      this.documentCopyService = createDocumentCopyService(window.electronAPI.clipboard);

      this.copyDropdown.setCallbacks({
        onSelect: (type: CopyDocumentType) => {
          void this.handleCopyDocument(type);
        },
      });
    }

    // Create recent files dropdown
    const recentFilesElement = document.getElementById('open-file-dropdown');
    if (recentFilesElement) {
      this.recentFilesDropdown = createRecentFilesDropdown(recentFilesElement);
      this.recentFilesDropdown.setCallbacks({
        onSelectRecentFile: (filePath: string) => {
          void this.loadFile(filePath);
        },
        onClearRecentFiles: () => {
          void window.electronAPI.recentFiles.clear();
        },
      });
    }

    // Create Google Docs button
    const gdocsSyncBtn = document.getElementById('gdocs-sync-btn') as HTMLButtonElement | null;
    if (gdocsSyncBtn) {
      this.googleDocsButton = createGoogleDocsButton(gdocsSyncBtn);
      this.googleDocsButton.setCallbacks({
        onLinkRequest: () => this.googleDocsLinkDialog?.show(),
        onSignInRequest: () => { void this.handleGoogleDocsSignIn(); },
        onSyncRequest: () => { void this.showSyncVerificationDialog(); },
      });
    }

    // Create Google Docs link dialog
    const gdocsDialogEl = document.getElementById('gdocs-link-dialog');
    if (gdocsDialogEl) {
      this.googleDocsLinkDialog = createGoogleDocsLinkDialog(gdocsDialogEl);
      this.googleDocsLinkDialog.setCallbacks({
        onLink: (url: string) => { void this.handleGoogleDocsLinkAndSync(url); },
      });
    }

    // Create Google Docs confirm dialog
    const gdocsConfirmEl = document.getElementById('gdocs-confirm-dialog');
    if (gdocsConfirmEl) {
      this.googleDocsConfirmDialog = createGoogleDocsConfirmDialog(gdocsConfirmEl);
    }

    // Create open external dropdown
    const openExternalElement = document.getElementById('open-external-dropdown');
    if (openExternalElement) {
      this.openExternalDropdown = createOpenExternalDropdown(openExternalElement);
      this.openExternalDropdown.setCallbacks({
        onRevealInFileManager: () => {
          if (this.state.currentFilePath) {
            void window.electronAPI.shell.revealInFileManager(this.state.currentFilePath);
          }
        },
        onOpenInEditor: () => {
          if (this.state.currentFilePath) {
            void window.electronAPI.shell.openInEditor(this.state.currentFilePath).then((result) => {
              if (!result.success) {
                this.toast?.error(result.error ?? 'Failed to open editor');
              }
            });
          }
        },
      });
    }


    // Create zoom controller for the markdown content
    // Target: markdown-content (the element to scale)
    // Scroll container: markdown-viewer (the scrollable wrapper)
    this.zoomController = createZoomController(viewerContainer, viewerElement, {
      minZoom: 0.5,
      maxZoom: 3.0,
      zoomStep: 0.1,
    });

    // Update status bar when zoom changes
    this.zoomController.setOnZoomChange((zoomLevel) => {
      this.statusBar?.setZoomLevel(zoomLevel);
    });

    // Initialize the markdown viewer
    await this.markdownViewer.initialize();

    // Set up component callbacks
    this.toolbar.setCallbacks({
      onOpenFile: () => {
        void this.handleOpenFile();
      },
      onToggleTheme: () => {
        void this.handleToggleTheme();
      },
      onOpenPreferences: () => {
        this.handleOpenPreferences();
      },
      onEnterEditMode: () => {
        void this.handleEnterEditMode();
      },
      onSave: () => {
        void this.handleSaveAndExitEditMode();
      },
      onCancelEdit: () => {
        void this.handleCancelEdit();
      },
    });

    this.dropZone.setOnFileDrop((filePath) => {
      void this.handleFileDrop(filePath);
    });
    this.dropZone.setOnOpenLinkClick(() => {
      void this.handleOpenFile();
    });
  }

  /**
   * Initialize theme from preferences
   */
  private async initializeTheme(): Promise<void> {
    try {
      const theme = await window.electronAPI.theme.getCurrent();
      this.state.currentTheme = theme;
      await this.applyTheme(theme);
    } catch (error) {
      console.error('Failed to get theme:', error);
      // Default to system theme
      void this.applyTheme('system');
    }
  }

  /**
   * Initialize preferences panel
   */
  private async initializePreferences(): Promise<void> {
    try {
      // Create preferences panel
      this.preferencesPanel = createPreferencesPanel();

      // Set up callbacks
      this.preferencesPanel.setCallbacks({
        onPreferencesChange: (updates: DeepPartial<AppPreferences>) => {
          void this.handlePreferencesChange(updates);
        },
      });

      // Load initial preferences and re-apply theme so typography/colors take effect
      const preferences = await window.electronAPI.preferences.get();
      this.state.currentPreferences = preferences.core;
      this.state.currentTheme = preferences.core.theme.mode;
      this.preferencesPanel.updateValues(preferences);
      this.updateExternalEditorLabel(preferences.core.externalEditor.editor);
      await this.applyTheme(this.state.currentTheme);

      // Load plugin preference schemas
      const pluginSchemas = this.markdownViewer?.getPluginPreferencesSchemas();
      if (pluginSchemas) {
        this.preferencesPanel.setPluginSchemas(pluginSchemas);
      }

      // Notify plugins of their initial preferences
      if (this.markdownViewer) {
        this.markdownViewer.notifyAllPluginsPreferencesChange(preferences.plugins);
      }

      // Subscribe to preference changes from other windows
      const cleanupPreferencesChange = window.electronAPI.preferences.onChange(
        (prefs: AppPreferences) => {
          this.state.currentPreferences = prefs.core;
          this.preferencesPanel?.updateValues(prefs);

          // Update external editor label
          this.updateExternalEditorLabel(prefs.core.externalEditor.editor);

          // Notify plugins of preference changes
          this.markdownViewer?.notifyAllPluginsPreferencesChange(prefs.plugins);

          // Re-apply theme with updated preferences
          void this.applyTheme(this.state.currentTheme);
        }
      );
      this.cleanupFunctions.push(cleanupPreferencesChange);
    } catch (error) {
      console.error('Failed to initialize preferences:', error);
    }
  }

  /**
   * Apply theme to the document
   */
  private async applyTheme(theme: ThemeMode): Promise<void> {
    let resolvedTheme: ResolvedTheme;

    if (theme === 'system') {
      try {
        resolvedTheme = await window.electronAPI.theme.getSystem();
      } catch {
        resolvedTheme = 'light';
      }
    } else {
      resolvedTheme = theme;
    }

    // Get plugin theme declarations
    const pluginDeclarations = this.markdownViewer?.getPluginThemeDeclarations() ?? {};

    // Apply theme CSS variables immediately (cheap)
    applyThemeCSS(
      resolvedTheme,
      pluginDeclarations,
      this.state.currentPreferences ?? undefined
    );

    // Update toolbar theme indicator
    this.toolbar?.setTheme(resolvedTheme);

    // Debounce expensive content re-render (diagrams like Mermaid)
    if (this.contentRenderTimer) clearTimeout(this.contentRenderTimer);
    this.contentRenderTimer = setTimeout(() => {
      void this.markdownViewer?.setTheme(resolvedTheme);
    }, 300);
  }

  /**
   * Set up event listeners for IPC events
   */
  private setupEventListeners(): void {
    // File change listener
    const cleanupFileChange = window.electronAPI.file.onFileChange(
      (event: FileChangeEvent) => {
        void this.handleFileChange(event);
      }
    );
    this.cleanupFunctions.push(cleanupFileChange);

    // File delete listener
    const cleanupFileDelete = window.electronAPI.file.onFileDelete(
      (event: FileDeleteEvent) => this.handleFileDelete(event)
    );
    this.cleanupFunctions.push(cleanupFileDelete);

    // System theme change listener
    const cleanupThemeChange = window.electronAPI.theme.onSystemChange(
      (event) => {
        if (this.state.currentTheme === 'system') {
          const pluginDeclarations = this.markdownViewer?.getPluginThemeDeclarations() ?? {};
          applyThemeCSS(
            event.theme,
            pluginDeclarations,
            this.state.currentPreferences ?? undefined
          );
          this.toolbar?.setTheme(event.theme);
        }
      }
    );
    this.cleanupFunctions.push(cleanupThemeChange);

    // Fullscreen change listener
    const cleanupFullscreenChange = window.electronAPI.window.onFullscreenChange(
      (event: FullscreenChangeEvent) => {
        this.state.isFullscreen = event.isFullscreen;
        this.updateToolbarForFullscreen(event.isFullscreen);
      }
    );
    this.cleanupFunctions.push(cleanupFullscreenChange);

    // External file open listener (from Finder, command line)
    const cleanupExternalOpen = window.electronAPI.fileAssociation.onExternalOpen(
      (event: ExternalFileOpenEvent) => {
        void this.loadFile(event.filePath);
      }
    );
    this.cleanupFunctions.push(cleanupExternalOpen);

    // Recent files change listener (cross-window sync)
    const cleanupRecentFiles = window.electronAPI.recentFiles.onChange(
      (files: RecentFileEntry[]) => {
        this.recentFilesDropdown?.updateRecentFiles(files);
      }
    );
    this.cleanupFunctions.push(cleanupRecentFiles);

    // Menu action listener (from application menu)
    const cleanupMenuAction = window.electronAPI.menu.onAction(
      (action: string) => {
        switch (action) {
          case 'find':
            this.findBar?.show();
            break;
          case 'open-file':
            void this.handleOpenFile();
            break;
          case 'open-preferences':
            this.handleOpenPreferences();
            break;
          case 'zoom-in':
            this.zoomController?.zoomIn();
            break;
          case 'zoom-out':
            this.zoomController?.zoomOut();
            break;
          case 'zoom-reset':
            this.zoomController?.resetZoom();
            break;
          case 'save':
            if (this.state.isEditMode) {
              void this.handleSaveAndExitEditMode();
            }
            break;
          case 'toggle-edit-mode':
            if (this.state.isEditMode) {
              void this.handleSaveAndExitEditMode();
            } else {
              void this.handleEnterEditMode();
            }
            break;
        }
      }
    );
    this.cleanupFunctions.push(cleanupMenuAction);

    // Google Docs auth change listener
    const cleanupGDocsAuth = window.electronAPI.googleDocs.onAuthChange(
      (_state: GoogleAuthState) => {
        void this.updateGoogleDocsButtonState();
      }
    );
    this.cleanupFunctions.push(cleanupGDocsAuth);

    // Google Docs sync status listener
    const cleanupGDocsSync = window.electronAPI.googleDocs.onSyncStatus(
      (status: { syncing: boolean; error?: string }) => {
        if (status.syncing) {
          this.googleDocsButton?.setState('syncing');
        } else if (status.error) {
          this.toast?.error(`Sync failed: ${status.error}`);
          this.googleDocsButton?.setState('ready');
        }
      }
    );
    this.cleanupFunctions.push(cleanupGDocsSync);
  }

  /**
   * Update toolbar layout based on fullscreen state
   */
  private updateToolbarForFullscreen(isFullscreen: boolean): void {
    const toolbarElement = document.getElementById('toolbar');
    if (toolbarElement) {
      if (isFullscreen) {
        toolbarElement.classList.add('fullscreen');
      } else {
        toolbarElement.classList.remove('fullscreen');
      }
    }
  }

  /**
   * Show the welcome/drop zone screen
   */
  private showWelcomeScreen(): void {
    const viewerElement = document.getElementById('markdown-viewer');
    const dropZoneElement = document.getElementById('drop-zone');

    if (viewerElement) viewerElement.classList.add('hidden');
    if (dropZoneElement) dropZoneElement.classList.remove('hidden');

    // Disable copy dropdown when no document
    this.copyDropdown?.setEnabled(false);
    this.googleDocsButton?.setEnabled(false);

    // Hide open external dropdown
    this.openExternalDropdown?.setEnabled(false);

    // Disable edit mode button
    const editModeBtn = document.getElementById('edit-mode-btn') as HTMLButtonElement | null;
    if (editModeBtn) editModeBtn.disabled = true;
  }

  /**
   * Show the markdown viewer
   */
  private showViewer(): void {
    const viewerElement = document.getElementById('markdown-viewer');
    const dropZoneElement = document.getElementById('drop-zone');

    if (viewerElement) viewerElement.classList.remove('hidden');
    if (dropZoneElement) dropZoneElement.classList.add('hidden');

    // Enable copy dropdown when document is loaded
    this.copyDropdown?.setEnabled(true);
    this.googleDocsButton?.setEnabled(true);

    // Show open external dropdown
    this.openExternalDropdown?.setEnabled(true);

    // Enable edit mode button
    const editModeBtn2 = document.getElementById('edit-mode-btn') as HTMLButtonElement | null;
    if (editModeBtn2) editModeBtn2.disabled = false;
  }

  /**
   * Handle open file button click
   */
  private async handleOpenFile(): Promise<void> {
    try {
      const result = await window.electronAPI.file.openDialog();

      if (result.cancelled || !result.filePath) {
        return;
      }

      await this.loadFile(result.filePath);
    } catch (error) {
      console.error('Failed to open file:', error);
      this.showError('Failed to open file');
    }
  }

  /**
   * Handle file drop
   */
  private async handleFileDrop(filePath: string): Promise<void> {
    await this.loadFile(filePath);
  }

  /**
   * Load and display a markdown file
   */
  private async loadFile(filePath: string): Promise<void> {
    try {
      // Exit edit mode if active
      if (this.state.isEditMode) {
        await this.exitEditMode();
      }

      // Stop watching previous file
      if (this.state.currentFilePath && this.state.isWatching) {
        await this.stopWatching();
      }

      // Read file content
      const result = await window.electronAPI.file.read(filePath);

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to read file');
      }

      // Update state
      this.state.currentFilePath = filePath;

      // Update UI
      const fileName = filePath.split('/').pop() ?? 'Unknown';
      this.toolbar?.setFileName(fileName);
      this.statusBar?.setFilePath(filePath);
      this.statusBar?.setModifiedTime(
        result.stats?.modifiedAt ? new Date(result.stats.modifiedAt) : null
      );

      // Render markdown
      await this.markdownViewer?.render(result.content ?? '', filePath);
      this.diffService?.setBaseline(result.content ?? '');
      this.changeGutter?.clearIndicators();

      // Show viewer
      this.showViewer();

      // Start watching
      await this.startWatching(filePath);

      // Update Google Docs button state for this file
      await this.updateGoogleDocsButtonState();

      // Track in recent files (non-fatal)
      try {
        await window.electronAPI.recentFiles.add(filePath);
      } catch {
        // Non-fatal: don't break file loading if recent files tracking fails
      }
    } catch (error) {
      console.error('Failed to load file:', error);
      this.showError(`Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // Remove stale entry if file can't be read
      try {
        await window.electronAPI.recentFiles.remove(filePath);
      } catch {
        // Non-fatal
      }
    }
  }

  /**
   * Start watching a file for changes
   */
  private async startWatching(filePath: string): Promise<void> {
    try {
      await window.electronAPI.file.watch(filePath);
      this.state.isWatching = true;
      this.statusBar?.setWatching(true);
    } catch (error) {
      console.error('Failed to start watching:', error);
      this.state.isWatching = false;
      this.statusBar?.setWatching(false);
    }
  }

  /**
   * Stop watching the current file
   */
  private async stopWatching(): Promise<void> {
    if (!this.state.currentFilePath) return;

    try {
      await window.electronAPI.file.unwatch(this.state.currentFilePath);
      this.state.isWatching = false;
      this.statusBar?.setWatching(false);
    } catch (error) {
      console.error('Failed to stop watching:', error);
    }
  }

  /**
   * Handle file change event (auto-refresh)
   */
  private async handleFileChange(event: FileChangeEvent): Promise<void> {
    if (event.filePath !== this.state.currentFilePath) return;

    // In edit mode, ignore external changes to avoid conflicts
    if (this.state.isEditMode) return;

    try {
      // Update modified time
      this.statusBar?.setModifiedTime(new Date());

      // Re-render content
      await this.markdownViewer?.render(event.content, event.filePath);

      if (this.diffService && this.changeGutter) {
        const diff = this.diffService.computeDiff(event.content);
        this.changeGutter.applyChanges(diff);
      }

      if (this.findService && this.findBar) {
        const result = this.findService.rerun();
        if (result) this.findBar.updateResult(result);
      }
    } catch (error) {
      console.error('Failed to refresh content:', error);
    }
  }

  /**
   * Handle file delete event
   */
  private handleFileDelete(event: FileDeleteEvent): void {
    if (event.filePath !== this.state.currentFilePath) return;

    // Clear state
    this.state.currentFilePath = null;
    this.state.isWatching = false;

    // Update UI
    this.toolbar?.setFileName(null);
    this.statusBar?.clear();
    this.markdownViewer?.clear();
    this.diffService?.clearBaseline();
    this.changeGutter?.clearIndicators();
    this.findService?.clear();

    // Show drop zone
    this.showWelcomeScreen();

    // Show notification
    this.showError('The file has been deleted');
  }

  private handleResetBaseline(): void {
    const content = this.markdownViewer?.getState().content;
    if (content !== undefined && this.diffService) {
      this.diffService.setBaseline(content);
    }
    this.changeGutter?.clearIndicators();
  }

  /**
   * Handle theme toggle
   */
  private async handleToggleTheme(): Promise<void> {
    try {
      // Get current resolved theme
      let currentResolved: 'light' | 'dark';
      if (this.state.currentTheme === 'system') {
        currentResolved = await window.electronAPI.theme.getSystem();
      } else {
        currentResolved = this.state.currentTheme;
      }

      // Toggle to opposite
      const newTheme: ThemeMode = currentResolved === 'dark' ? 'light' : 'dark';

      // Save preference
      await window.electronAPI.theme.set(newTheme);

      // Update state and apply
      this.state.currentTheme = newTheme;
      await this.applyTheme(newTheme);
    } catch (error) {
      console.error('Failed to toggle theme:', error);
    }
  }

  /**
   * Handle open preferences panel
   */
  private handleOpenPreferences(): void {
    this.preferencesPanel?.open();
  }

  /**
   * Enter edit mode
   */
  private async handleEnterEditMode(): Promise<void> {
    if (!this.markdownViewer || !this.state.currentFilePath) return;

    const callbacks: EditModeCallbacks = {
      onContentChange: (_markdown: string) => {
        this.state.hasUnsavedChanges = true;
      },
    };
    await this.markdownViewer.enterEditMode(callbacks);
    this.state.isEditMode = true;
    this.toolbar?.setEditMode(true);
  }

  /**
   * Save changes and exit edit mode
   */
  private async handleSaveAndExitEditMode(): Promise<void> {
    if (!this.markdownViewer) return;

    // Save before exiting
    if (this.state.hasUnsavedChanges) {
      await this.saveFile();
    }

    await this.exitEditMode();
  }

  /**
   * Cancel edit mode - discard unsaved changes and re-render from disk
   */
  private async handleCancelEdit(): Promise<void> {
    if (!this.markdownViewer || !this.state.currentFilePath) return;

    // Discard changes - exit without saving
    this.state.hasUnsavedChanges = false;
    await this.exitEditMode();

    // Re-read from disk to restore original content
    const result = await window.electronAPI.file.read(this.state.currentFilePath);
    if (result.success && result.content != null) {
      await this.markdownViewer.render(result.content, this.state.currentFilePath);
    }
  }

  /**
   * Common exit-edit-mode cleanup
   */
  private async exitEditMode(): Promise<void> {
    if (!this.markdownViewer) return;

    await this.markdownViewer.exitEditMode();
    this.state.isEditMode = false;
    this.state.hasUnsavedChanges = false;
    this.toolbar?.setEditMode(false);

    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Save the current markdown content to file
   */
  private async saveFile(): Promise<void> {
    if (!this.state.currentFilePath || !this.markdownViewer) return;

    const markdown = this.markdownViewer.getCurrentMarkdown();

    try {
      const result = await window.electronAPI.file.write(
        this.state.currentFilePath,
        markdown
      );

      if (result.success) {
        this.state.hasUnsavedChanges = false;
        this.statusBar?.setModifiedTime(new Date());
      } else {
        this.toast?.error(`Save failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
      this.toast?.error('Failed to save file');
    }
  }

  /**
   * Handle copy document action from dropdown
   */
  private async handleCopyDocument(type: CopyDocumentType): Promise<void> {
    if (!this.markdownViewer || !this.documentCopyService) {
      return;
    }

    const viewerContainer = document.getElementById('markdown-content');
    const viewerElement = document.getElementById('markdown-viewer');

    if (!viewerContainer || !viewerElement) {
      this.toast?.error('Document elements not found');
      return;
    }

    // Set loading state
    this.copyDropdown?.setLoading(true);

    try {
      const options = {
        contentElement: viewerContainer,
        scrollContainer: viewerElement,
        pluginManager: this.markdownViewer.getPluginManager(),
        zoomLevel: this.zoomController?.getZoom() ?? 1.0,
      };

      if (type === 'google-docs') {
        const result = await this.documentCopyService.copyForGoogleDocs(options);
        if (result.success) {
          const diagramText = result.diagramCount && result.diagramCount > 0
            ? ` (${result.diagramCount} diagram${result.diagramCount > 1 ? 's' : ''})`
            : '';
          this.toast?.success(`Copied for Google Docs${diagramText}`);
        }
      } else if (type === 'image') {
        const result = await this.documentCopyService.copyAsImage(options);
        if (result.success) {
          const dimensions = result.dimensions
            ? ` (${result.dimensions.width}x${result.dimensions.height})`
            : '';
          this.toast?.success(`Image copied to clipboard${dimensions}`);
        }
      }
    } catch (error) {
      const message = isDomainError(error)
        ? error.toUserMessage()
        : error instanceof Error
          ? error.message
          : 'Failed to copy document';
      this.toast?.error(message);
    } finally {
      this.copyDropdown?.setLoading(false);
    }
  }

  /**
   * Handle preferences change from panel
   */
  private async handlePreferencesChange(
    updates: DeepPartial<AppPreferences>
  ): Promise<void> {
    try {
      const updatedPrefs = await window.electronAPI.preferences.set(updates);
      this.preferencesPanel?.updateValues(updatedPrefs);

      // Update current preferences state (PreferencesService is the single source of truth)
      this.state.currentPreferences = updatedPrefs.core;
      this.state.currentTheme = updatedPrefs.core.theme.mode;

      // Update external editor label
      this.updateExternalEditorLabel(updatedPrefs.core.externalEditor.editor);

      // Notify plugins of preference changes
      if (updates.plugins) {
        for (const pluginId of Object.keys(updates.plugins)) {
          this.markdownViewer?.notifyPluginPreferencesChange(
            pluginId,
            updatedPrefs.plugins[pluginId]
          );
        }
      }

      // Re-apply theme with updated preferences for live preview
      await this.applyTheme(this.state.currentTheme);
    } catch (error) {
      console.error('Failed to update preferences:', error);
    }
  }

  /**
   * Update Google Docs button state based on auth and link status
   */
  private async updateGoogleDocsButtonState(): Promise<void> {
    const statusGdocs = document.getElementById('status-gdocs');
    const statusGdocsText = document.getElementById('status-gdocs-text');

    if (!this.state.currentFilePath) {
      this.googleDocsButton?.setState('unlinked');
      if (statusGdocs) statusGdocs.classList.add('hidden');
      return;
    }

    try {
      const link = await window.electronAPI.googleDocs.getLink(this.state.currentFilePath);
      if (!link) {
        this.googleDocsButton?.setState('unlinked');
        if (statusGdocs) statusGdocs.classList.add('hidden');
        return;
      }

      // Update status bar indicator for linked file
      if (statusGdocs && statusGdocsText) {
        statusGdocs.classList.remove('hidden');
        statusGdocsText.textContent = `Linked · Last synced ${link.lastSyncedAt ? this.formatTimeAgo(link.lastSyncedAt) : 'never'}`;
      }

      const authState = await window.electronAPI.googleDocs.getAuthStatus();
      if (!authState.isAuthenticated) {
        this.googleDocsButton?.setState('needs-auth');
        return;
      }

      this.googleDocsButton?.setState('ready');
    } catch (error) {
      console.error('Failed to update Google Docs button state:', error);
      this.googleDocsButton?.setState('unlinked');
      if (statusGdocs) statusGdocs.classList.add('hidden');
    }
  }

  /**
   * Format a time ago string from an ISO date string
   */
  private formatTimeAgo(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  }

  /**
   * Show the link dialog pre-filled with the current linked doc URL
   * so the user can verify or change it before syncing.
   */
  private async showSyncVerificationDialog(): Promise<void> {
    if (!this.state.currentFilePath) return;

    let existingUrl = '';
    try {
      const link = await window.electronAPI.googleDocs.getLink(this.state.currentFilePath);
      if (link?.docId) {
        existingUrl = `https://docs.google.com/document/d/${link.docId}/edit`;
      }
    } catch {
      // No link yet — dialog will show empty
    }

    this.googleDocsLinkDialog?.show(existingUrl);
  }

  /**
   * Handle Google Docs link + sync: link the doc then immediately sync.
   */
  private async handleGoogleDocsLinkAndSync(url: string): Promise<void> {
    if (!this.state.currentFilePath) return;

    try {
      await window.electronAPI.googleDocs.link(this.state.currentFilePath, url);
      this.googleDocsLinkDialog?.hide();
      await this.updateGoogleDocsButtonState();
      await this.handleGoogleDocsSync();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to link';
      this.googleDocsLinkDialog?.showError(message);
    }
  }

  /**
   * Handle Google Docs sign in
   */
  private async handleGoogleDocsSignIn(): Promise<void> {
    try {
      await window.electronAPI.googleDocs.signIn();
      this.toast?.success('Signed in to Google');
      await this.updateGoogleDocsButtonState();
    } catch (error) {
      console.error('Google sign in failed:', error);
      this.toast?.error('Failed to sign in to Google');
    }
  }

  /**
   * Extract mermaid diagram data (PNG + live URL) from the rendered viewer.
   * Used to pass diagram images to the Google Docs sync service.
   */
  private async extractMermaidData(): Promise<MermaidDiagramData[]> {
    const viewer = document.getElementById('markdown-content');
    if (!viewer || !this.markdownViewer) return [];

    const pluginManager = this.markdownViewer.getPluginManager();
    const mermaidPlugin = pluginManager.getPlugin<MermaidPlugin>(BUILTIN_PLUGINS.MERMAID);
    if (!mermaidPlugin) return [];

    const containers = viewer.querySelectorAll('.mermaid-container[data-mermaid-source]');
    const diagrams: MermaidDiagramData[] = [];

    for (const container of containers) {
      const encodedSource = container.getAttribute('data-mermaid-source');
      if (!encodedSource) continue;

      try {
        const code = mermaidPlugin.decodeFromAttribute(encodedSource);
        const pngBase64 = await mermaidPlugin.renderToPng(container as HTMLElement);
        const liveUrl = mermaidPlugin.generateMermaidLiveUrl(code);
        diagrams.push({ code, pngBase64, liveUrl });
      } catch (error) {
        console.warn('Failed to extract mermaid diagram:', error);
      }
    }

    return diagrams;
  }

  /**
   * Handle Google Docs sync
   */
  private async handleGoogleDocsSync(): Promise<void> {
    if (!this.state.currentFilePath) return;

    const content = this.markdownViewer?.getState().content;
    if (content === undefined) return;

    this.googleDocsButton?.setState('syncing');

    try {
      // Extract mermaid diagrams from the rendered viewer
      const mermaidData = await this.extractMermaidData();

      const result = await window.electronAPI.googleDocs.sync(
        this.state.currentFilePath,
        content,
        mermaidData.length > 0 ? mermaidData : undefined,
      );

      if (result.externalEditsDetected) {
        this.googleDocsButton?.setState('ready');

        // Show confirmation dialog and wait for user response
        this.googleDocsConfirmDialog?.setCallbacks({
          onConfirm: () => { void this.handleGoogleDocsSyncOverwrite(content, mermaidData); },
          onCancel: () => { /* do nothing, button already set to ready */ },
        });
        this.googleDocsConfirmDialog?.show();
        return;
      } else if (result.success) {
        this.toast?.success('Synced to Google Docs');
        await this.updateGoogleDocsButtonState();
      } else {
        console.error('Google Docs sync error result:', result);
        this.toast?.error(result.error ?? 'Sync failed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';

      // Session expired — re-authenticate then retry the sync
      if (message.includes('Session expired')) {
        console.warn('Google Docs session expired, triggering re-authentication');
        try {
          await this.handleGoogleDocsSignIn();
          // Retry sync after successful re-auth
          await this.handleGoogleDocsSync();
        } catch {
          this.googleDocsButton?.setState('ready');
        }
        return;
      }

      console.error('Google Docs sync exception:', error);
      this.toast?.error(message);
      this.googleDocsButton?.setState('ready');
      return;
    }
    this.googleDocsButton?.setState('ready');
  }

  /**
   * Handle Google Docs sync overwrite after confirmation
   */
  private async handleGoogleDocsSyncOverwrite(content: string, mermaidData?: MermaidDiagramData[]): Promise<void> {
    if (!this.state.currentFilePath) return;

    this.googleDocsButton?.setState('syncing');

    try {
      const result = await window.electronAPI.googleDocs.syncConfirmOverwrite(
        this.state.currentFilePath,
        content,
        mermaidData && mermaidData.length > 0 ? mermaidData : undefined,
      );
      if (result.success) {
        this.toast?.success('Synced to Google Docs (overwritten)');
      } else {
        this.toast?.error(result.error ?? 'Sync failed');
      }
    } catch (error) {
      console.error('Google Docs overwrite sync failed:', error);
      this.toast?.error('Sync failed');
    } finally {
      this.googleDocsButton?.setState('ready');
      await this.updateGoogleDocsButtonState();
    }
  }

  /**
   * Show an error message
   */
  private showError(message: string): void {
    // Create temporary error display
    const errorDiv = document.createElement('div');
    errorDiv.className = 'app-error-toast';
    errorDiv.textContent = message;
    errorDiv.style.cssText = `
      position: fixed;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--error-bg);
      color: var(--error-text);
      padding: 12px 24px;
      border-radius: 6px;
      border: 1px solid var(--error-border);
      z-index: 1000;
      animation: fadeInOut 3s ease-in-out forwards;
    `;

    // Add animation keyframes if not already present
    if (!document.getElementById('app-error-animations')) {
      const style = document.createElement('style');
      style.id = 'app-error-animations';
      style.textContent = `
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
          15% { opacity: 1; transform: translateX(-50%) translateY(0); }
          85% { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(errorDiv);

    // Remove after animation
    setTimeout(() => {
      errorDiv.remove();
    }, 3000);
  }

  /**
   * Map editor ID to display name for the dropdown label
   */
  private static readonly EDITOR_LABELS: Record<Exclude<ExternalEditorId, 'none'>, string> = {
    vscode: 'VS Code',
    cursor: 'Cursor',
    webstorm: 'WebStorm',
    sublime: 'Sublime Text',
    zed: 'Zed',
    custom: 'External Editor',
  };

  /**
   * Update the open external dropdown's editor label based on preference
   */
  private updateExternalEditorLabel(editor: ExternalEditorId): void {
    if (editor === 'none') {
      this.openExternalDropdown?.setEditorLabel(null);
    } else {
      this.openExternalDropdown?.setEditorLabel(App.EDITOR_LABELS[editor]);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    // Run cleanup functions
    this.cleanupFunctions.forEach((cleanup) => cleanup());
    this.cleanupFunctions = [];

    // Destroy components
    this.dropZone?.destroy();
    this.zoomController?.destroy();
    this.copyDropdown?.destroy();
    this.changeGutter?.destroy();
    this.findBar?.destroy();
    this.recentFilesDropdown?.destroy();
    this.googleDocsButton?.destroy();
    this.googleDocsLinkDialog?.destroy();
    this.googleDocsConfirmDialog?.destroy();
    this.openExternalDropdown?.destroy();
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.initialize().catch((error) => {
    console.error('App initialization failed:', error);
  });

  // Store app instance for debugging
  (window as Window & { __app?: App }).__app = app;
});
