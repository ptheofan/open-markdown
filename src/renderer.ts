/**
 * Renderer Entry Point
 * Initializes and coordinates all UI components
 */
import './index.css';

import { joinBlocks } from '@shared/markdown/blocks';
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
  createOpenExternalDropdown,
  createGoogleDocsButton,
  createSyncProgressBar,
  createSyncReviewDialog,
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
  type OpenExternalDropdown,
  type GoogleDocsButton,
  type SyncProgressBar,
  type SyncReviewDialog,
  type SyncReviewOutcome,
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
import { applyTheme as applyThemeCSS, generateCompleteThemeCSS } from './themes';

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
  TableColumnWidths,
} from '@shared/types';
import type {
  GoogleAuthState,
  GoogleDocsResolveResult,
  SyncChange,
  SyncDirection,
  SyncResolveMode,
} from '@shared/types/google-docs';
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
  private openExternalDropdown: OpenExternalDropdown | null = null;
  private googleDocsButton: GoogleDocsButton | null = null;
  private syncProgressBar: SyncProgressBar | null = null;
  private syncReviewDialog: SyncReviewDialog | null = null;

  /** Bumped on every sync-status change, to spot a stale refresh. */
  private syncStatusSeq = 0;

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

    this.setupLinkHover(viewerContainer);

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

    // Create the Google Docs panel
    const gdocsGroup = document.getElementById('gdocs-group');
    const gdocsSyncBtn = document.getElementById('gdocs-sync-btn') as HTMLButtonElement | null;
    const gdocsPullBtn = document.getElementById('gdocs-pull-btn') as HTMLButtonElement | null;
    const gdocsTargetBtn = document.getElementById('gdocs-target-btn') as HTMLButtonElement | null;
    const gdocsBusy = document.getElementById('gdocs-busy');
    if (gdocsGroup && gdocsSyncBtn && gdocsPullBtn && gdocsTargetBtn && gdocsBusy) {
      this.googleDocsButton = createGoogleDocsButton({
        group: gdocsGroup,
        push: gdocsSyncBtn,
        pull: gdocsPullBtn,
        target: gdocsTargetBtn,
        busy: gdocsBusy,
      });
      this.syncProgressBar = createSyncProgressBar();
      this.googleDocsButton.setCallbacks({
        onLinkRequest: () => { void this.handleGoogleDocsPickAndSync(); },
        onSignInRequest: () => { void this.handleGoogleDocsSignIn(); },
        onSyncRequest: (direction) => { void this.handleGoogleDocsSync(direction); },
        onShowProgressRequest: () => { this.syncProgressBar?.show(); },
      });
    }

    // Asks how to reconcile when the file and the Doc have both changed.
    this.syncReviewDialog = createSyncReviewDialog();

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

    this.markdownViewer.setOnOpenLocalFile((filePath, fragment) => {
      void this.loadFile(filePath).then(() => {
        if (fragment) {
          this.markdownViewer?.scrollToHeading(fragment);
        }
      });
    });

    this.dropZone.setOnFileDrop((filePath) => {
      void this.handleFileDrop(filePath);
    });
    this.dropZone.setOnOpenLinkClick(() => {
      void this.handleOpenFile();
    });
  }

  /**
   * Show the target URL in the status bar while hovering over a link
   */
  private setupLinkHover(container: HTMLElement): void {
    const updateFromTarget = (target: EventTarget | null): void => {
      const anchor =
        target instanceof Element ? target.closest('a[href]') : null;
      const href = anchor?.getAttribute('href') ?? null;
      this.statusBar?.setLinkUrl(href);
    };

    container.addEventListener('mouseover', (e) => {
      updateFromTarget(e.target);
    });
    container.addEventListener('mouseout', (e) => {
      updateFromTarget(e.relatedTarget);
    });
    container.addEventListener('mouseleave', () => {
      this.statusBar?.setLinkUrl(null);
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
      this.applyExperimentalFeatures(preferences.core.experimental);
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

          // Apply experimental feature visibility
          this.applyExperimentalFeatures(prefs.core.experimental);

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

    // Google Docs sync progress listener
    const cleanupGDocsProgress = window.electronAPI.googleDocs.onSyncProgress((update) => {
      // Only redraws when on screen; a dismissed bar still tracks the sync so
      // reopening it shows where the sync is now, not where it was dismissed.
      this.syncProgressBar?.update(update);
    });
    this.cleanupFunctions.push(cleanupGDocsProgress);

    // Google Docs sync status listener
    const cleanupGDocsSync = window.electronAPI.googleDocs.onSyncStatus(
      (status: { syncing: boolean; error?: string }) => {
        const seq = ++this.syncStatusSeq;
        if (status.syncing) {
          this.googleDocsButton?.setState('syncing');
          this.syncProgressBar?.show();
        } else {
          this.syncProgressBar?.finish();
          // Recompute from the link store: a sync that dropped an unreachable
          // link must leave the button offering 'link', not 'sync'. The error
          // itself is reported by whoever invoked the sync, not here, so it is
          // not toasted twice.
          void this.updateGoogleDocsButtonState().then(() => {
            // One user action is two round trips -- preview then apply -- so
            // this refresh can land after the next one has already started.
            // Without the check it would quietly clear that spinner.
            if (seq !== this.syncStatusSeq) this.googleDocsButton?.setState('syncing');
          });
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

    // Hide open external dropdown
    this.openExternalDropdown?.setEnabled(false);

    // Disable edit mode button
    const editModeBtn = document.getElementById('edit-mode-btn') as HTMLButtonElement | null;
    if (editModeBtn) editModeBtn.disabled = true;
    this.googleDocsButton?.setEnabled(false);
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

    // Show open external dropdown
    this.openExternalDropdown?.setEnabled(true);

    // Enable edit mode button
    const editModeBtn = document.getElementById('edit-mode-btn') as HTMLButtonElement | null;
    if (editModeBtn) editModeBtn.disabled = false;
    this.googleDocsButton?.setEnabled(true);
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

    // Commit whatever is still being typed BEFORE asking whether there is
    // anything to save. The commit is what both updates the markdown and
    // marks the document dirty, so checking first meant an edit the user
    // never clicked away from looked like no change at all: nothing was
    // written, exiting committed it into the view regardless, and the edit
    // was gone the next time the file was opened.
    this.markdownViewer.flushPendingEdits();

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
   * Apply experimental feature flags to the UI.
   * Google Docs sync is gated behind an experimental toggle — when disabled,
   * the sync button is hidden from the toolbar entirely.
   */
  private applyExperimentalFeatures(
    experimental: CorePreferences['experimental']
  ): void {
    this.googleDocsButton?.setVisible(experimental.googleDocsSync);
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
   * Link the current file to a Google Doc chosen in the Google Picker, then sync.
   *
   * The picker runs through Google's consent screen, so it signs the user in as
   * a side effect -- there is no separate sign-in step to sequence here.
   */
  private async handleGoogleDocsPickAndSync(): Promise<void> {
    if (!this.state.currentFilePath) return;

    try {
      const before = await window.electronAPI.googleDocs.getLink(this.state.currentFilePath);
      const link = await window.electronAPI.googleDocs.pickAndLink(this.state.currentFilePath);
      await this.updateGoogleDocsButtonState();
      if (!link) {
        // Either the user closed the picker, or Google returned no selection.
        // Say so rather than appearing to do nothing at all.
        this.toast?.success('No document selected — nothing was linked.');
        return;
      }
      if (before) {
        // Re-pointing an already-linked file: which way to reconcile with the
        // new document is the user's call, so stop here rather than pushing
        // over whatever they just chose.
        this.toast?.success(
          before.docId === link.docId
            ? 'Still linked to the same document.'
            : 'Linked to the new document — push or pull to sync it.',
        );
        return;
      }
      await this.handleGoogleDocsSync('push');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to link';
      this.toast?.error(message);
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
  /**
   * Measure how wide each table's columns actually are in the rendered view.
   *
   * Reported as fractions of the table's own width, not pixels: the document's
   * text column is a different size from this window, so only the proportions
   * are meaningful. Tables are returned in document order, which is how the
   * sync matches them to the markdown's tables.
   */
  private extractTableColumnWidths(): TableColumnWidths[] {
    const viewer = document.getElementById('markdown-content');
    if (!viewer) return [];

    const widths: TableColumnWidths[] = [];

    for (const table of viewer.querySelectorAll('table')) {
      // The widest row governs the layout; the first row may be a short header.
      const row = table.querySelector('tr');
      const cells = row ? Array.from(row.children) : [];

      const measured = cells.map((cell) => cell.getBoundingClientRect().width);
      const total = measured.reduce((sum, w) => sum + w, 0);

      // A table that has not been laid out yet measures zero — skip it rather
      // than send fractions that would collapse every column.
      if (measured.length === 0 || total <= 0) {
        widths.push({ fractions: [] });
        continue;
      }

      widths.push({ fractions: measured.map((w) => w / total) });
    }

    return widths;
  }

  private async extractMermaidData(): Promise<MermaidDiagramData[]> {
    const viewer = document.getElementById('markdown-content');
    if (!viewer || !this.markdownViewer) return [];

    const pluginManager = this.markdownViewer.getPluginManager();
    const mermaidPlugin = pluginManager.getPlugin<MermaidPlugin>(BUILTIN_PLUGINS.MERMAID);
    if (!mermaidPlugin) return [];

    const containers = viewer.querySelectorAll('.mermaid-container[data-mermaid-source]');
    const diagrams: MermaidDiagramData[] = [];
    const surface = this.createLightExportSurface();

    try {
      for (const container of containers) {
        const encodedSource = container.getAttribute('data-mermaid-source');
        if (!encodedSource) continue;

        try {
          const code = mermaidPlugin.decodeFromAttribute(encodedSource);
          // Re-rendered light rather than captured from screen: a Google Doc
          // page is white, and the diagram on screen is whatever theme the
          // app happens to be in.
          const pngBase64 = await mermaidPlugin.renderToPngForExport(code, surface.host);
          const liveUrl = await mermaidPlugin.generateMermaidLiveUrl(code);
          diagrams.push({ code, pngBase64, liveUrl });
        } catch (error) {
          console.warn('Failed to extract mermaid diagram:', error);
        }
      }
    } finally {
      surface.dispose();
    }

    return diagrams;
  }

  /**
   * An off-screen element carrying the light palette.
   *
   * Diagrams resolve their colours from CSS variables on the document root,
   * so rendering one for export inside the running app would pick up the
   * app's theme however the diagram itself was themed. The real theme
   * generator produces the light values -- rescoped from :root to this
   * element, so the visible UI is untouched.
   */
  private createLightExportSurface(): { host: HTMLElement; dispose: () => void } {
    const declarations = this.markdownViewer?.getPluginThemeDeclarations() ?? {};
    const css = generateCompleteThemeCSS(
      'light',
      declarations,
      this.state.currentPreferences ?? undefined,
    );

    const style = document.createElement('style');
    style.textContent = css.replace(':root', '.gdocs-export-surface');
    document.head.appendChild(style);

    const host = document.createElement('div');
    host.className = 'gdocs-export-surface';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);

    return {
      host,
      dispose: () => {
        host.remove();
        style.remove();
      },
    };
  }

  /**
   * Carry a sync in the direction the user asked for.
   *
   * Two trips to the main process. 'preview' works out every difference and
   * touches nothing; 'apply' writes the markdown that came out of it. In
   * between, the merge view opens only when something of the user's is at
   * stake -- their own edits during a pull, the Doc's during a push. When the
   * chosen direction has nothing to carry, that is said out loud rather than
   * passing for success.
   */
  private async handleGoogleDocsSync(
    direction: SyncDirection,
    allowReauth = true,
  ): Promise<void> {
    if (!this.state.currentFilePath) return;

    const content = this.markdownViewer?.getState().content;
    if (content === undefined) return;

    this.googleDocsButton?.setState('syncing');

    try {
      // Extract mermaid diagrams from the rendered viewer
      const mermaidData = await this.extractMermaidData();
      const tableWidths = this.extractTableColumnWidths();

      await this.runSync(direction, content, mermaidData, tableWidths);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';

      // Both auth failures mean the same thing to the UI — the user must sign in
      // before this sync can proceed. 'Session expired' comes from a revoked or
      // expired refresh token; 'Not authenticated' from having no stored tokens
      // at all. Only the former used to be handled, so a never-signed-in user
      // landed in the generic branch below and the button was reset to 'ready',
      // leaving no way to reach the sign-in flow (Preferences only offers sign
      // out). allowReauth stops the post-sign-in retry from recursing.
      if (allowReauth && (message.includes('Session expired') || message.includes('Not authenticated'))) {
        console.warn('Google Docs authentication required, triggering sign-in');
        try {
          await this.handleGoogleDocsSignIn();
          // handleGoogleDocsSignIn swallows its own errors, so re-read the auth
          // state rather than assuming success.
          const authState = await window.electronAPI.googleDocs.getAuthStatus();
          if (!authState.isAuthenticated) {
            this.googleDocsButton?.setState('needs-auth');
            return;
          }
          // Retry sync after successful re-auth
          await this.handleGoogleDocsSync(direction, false);
        } catch {
          this.googleDocsButton?.setState('needs-auth');
        }
        return;
      }

      console.error('Google Docs sync exception:', error);
      this.toast?.error(message);
      await this.updateGoogleDocsButtonState();
      return;
    }
    await this.updateGoogleDocsButtonState();
  }

  /** Preview, review if anything is at stake, then apply. */
  private async runSync(
    direction: SyncDirection,
    content: string,
    mermaidData?: MermaidDiagramData[],
    tableWidths?: TableColumnWidths[],
  ): Promise<void> {
    const noun = direction === 'pull' ? 'pull' : 'push';
    const preview = await this.resolveSync('preview', direction, content, mermaidData, tableWidths);
    if (preview === null) return;
    if (!preview.success) {
      this.toast?.error(preview.error ?? 'Sync failed');
      await this.updateGoogleDocsButtonState();
      return;
    }

    if (preview.nothingToDo === true) {
      this.toast?.success(`Nothing to ${noun}`);
      await this.updateGoogleDocsButtonState();
      return;
    }

    const changes = preview.changes ?? [];
    const blocks = preview.blocks ?? [];
    // Nothing to review means nothing was overridden, so only the target side
    // is written -- a pull that takes the Doc wholesale sends it no requests.
    const settled = preview.needsReview === true
      ? await this.reviewChanges(changes, blocks, direction, content)
      : { markdown: joinBlocks(blocks), deviates: false };
    if (settled == null) return;

    this.googleDocsButton?.setState('syncing');
    const applied = await this.resolveSync(
      'apply', direction, settled.markdown, mermaidData, tableWidths, settled.deviates,
    );
    if (applied === null) return;
    if (!applied.success) {
      this.toast?.error(applied.error ?? 'Sync failed');
      await this.updateGoogleDocsButtonState();
      return;
    }

    if (applied.markdown != null && applied.markdown !== content) {
      await this.applyPulledMarkdown(applied.markdown);
    }
    this.toast?.success(direction === 'pull' ? 'Pulled from Google Docs' : 'Pushed to Google Docs');
    await this.updateGoogleDocsButtonState();
  }

  /** Hand the differences to the merge view, with the button idle. */
  private async reviewChanges(
    changes: SyncChange[],
    blocks: string[],
    direction: SyncDirection,
    original: string,
  ): Promise<SyncReviewOutcome | null> {
    this.googleDocsButton?.setState('ready');
    return (await this.syncReviewDialog?.review(changes, blocks, direction, original)) ?? null;
  }

  private async resolveSync(
    mode: SyncResolveMode,
    direction: SyncDirection,
    content: string,
    mermaidData?: MermaidDiagramData[],
    tableWidths?: TableColumnWidths[],
    alsoWriteSource?: boolean,
  ): Promise<GoogleDocsResolveResult | null> {
    if (!this.state.currentFilePath) return null;
    try {
      return await window.electronAPI.googleDocs.syncResolve(
        this.state.currentFilePath,
        mode,
        direction,
        content,
        mermaidData && mermaidData.length > 0 ? mermaidData : undefined,
        tableWidths && tableWidths.length > 0 ? tableWidths : undefined,
        alsoWriteSource,
      );
    } catch (error) {
      console.error('Google Docs resolve failed:', error);
      this.toast?.error(error instanceof Error ? error.message : 'Sync failed');
      await this.updateGoogleDocsButtonState();
      return null;
    }
  }

  /**
   * Show markdown that the main process already wrote to disk.
   *
   * The write happens in main, before it records the sync, so the file can
   * never end up behind what we have recorded. The watcher also sees that
   * write, but its handler ignores changes while edit mode is open, so the
   * viewer is re-rendered here directly.
   */
  private async applyPulledMarkdown(markdown: string): Promise<void> {
    const filePath = this.state.currentFilePath;
    if (!filePath) return;

    await this.markdownViewer?.render(markdown, filePath);
    this.state.hasUnsavedChanges = false;
    this.statusBar?.setModifiedTime(new Date());
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
    this.openExternalDropdown?.destroy();
    this.googleDocsButton?.destroy();
    this.syncProgressBar?.destroy();
    this.syncReviewDialog?.destroy();
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
