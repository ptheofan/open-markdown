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
  type MarkdownViewer,
  type DropZone,
  type Toolbar,
  type StatusBar,
  type ZoomController,
} from './renderer/components';
import { applyTheme as applyThemeCSS } from './themes';

import type { ThemeMode, FileChangeEvent, FileDeleteEvent, FullscreenChangeEvent } from '@shared/types';
import type { ResolvedTheme } from './themes/types';

/**
 * Application state
 */
interface AppState {
  currentFilePath: string | null;
  currentTheme: ThemeMode;
  isWatching: boolean;
  isFullscreen: boolean;
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

  private state: AppState = {
    currentFilePath: null,
    currentTheme: 'system',
    isWatching: false,
    isFullscreen: false,
  };

  private cleanupFunctions: Array<() => void> = [];

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    try {
      await this.initializeComponents();
      await this.initializeTheme();
      await this.initializeFullscreenState();
      this.setupEventListeners();
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
   * Initialize all UI components
   */
  private async initializeComponents(): Promise<void> {
    // Get DOM elements
    const viewerContainer = document.getElementById('markdown-content');
    const viewerElement = document.getElementById('markdown-viewer');
    const dropZoneElement = document.getElementById('drop-zone');
    const toolbarElement = document.getElementById('toolbar');
    const statusBarElement = document.getElementById('status-bar');

    if (!viewerContainer || !viewerElement || !dropZoneElement || !toolbarElement || !statusBarElement) {
      throw new Error('Required DOM elements not found');
    }

    // Create components
    this.markdownViewer = createMarkdownViewer(viewerContainer);
    this.dropZone = createDropZone(dropZoneElement);
    this.toolbar = createToolbar(toolbarElement);
    this.statusBar = createStatusBar(statusBarElement);

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

    // Apply theme CSS variables
    applyThemeCSS(resolvedTheme, pluginDeclarations);

    // Update toolbar theme indicator
    this.toolbar?.setTheme(resolvedTheme);

    // Update theme-aware plugins (like Mermaid)
    await this.markdownViewer?.setTheme(resolvedTheme);
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
          applyThemeCSS(event.theme, pluginDeclarations);
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
  }

  /**
   * Show the markdown viewer
   */
  private showViewer(): void {
    const viewerElement = document.getElementById('markdown-viewer');
    const dropZoneElement = document.getElementById('drop-zone');

    if (viewerElement) viewerElement.classList.remove('hidden');
    if (dropZoneElement) dropZoneElement.classList.add('hidden');
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

      // Show viewer
      this.showViewer();

      // Start watching
      await this.startWatching(filePath);
    } catch (error) {
      console.error('Failed to load file:', error);
      this.showError(`Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

    try {
      // Update modified time
      this.statusBar?.setModifiedTime(new Date());

      // Re-render content
      await this.markdownViewer?.render(event.content, event.filePath);
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

    // Show drop zone
    this.showWelcomeScreen();

    // Show notification
    this.showError('The file has been deleted');
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
   * Cleanup resources
   */
  destroy(): void {
    // Run cleanup functions
    this.cleanupFunctions.forEach((cleanup) => cleanup());
    this.cleanupFunctions = [];

    // Destroy components
    this.dropZone?.destroy();
    this.zoomController?.destroy();
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
