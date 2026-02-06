/**
 * Main window management
 */
import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

import { DEFAULT_WINDOW } from '@shared/constants';
import { IPC_CHANNELS } from '@shared/types/api';

/**
 * Main application window
 */
export class MainWindow {
  private window: BrowserWindow | null = null;

  /**
   * Get the browser window instance
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Create the main application window
   */
  create(): BrowserWindow {
    this.window = new BrowserWindow({
      width: DEFAULT_WINDOW.WIDTH,
      height: DEFAULT_WINDOW.HEIGHT,
      minWidth: DEFAULT_WINDOW.MIN_WIDTH,
      minHeight: DEFAULT_WINDOW.MIN_HEIGHT,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // Required for some Electron APIs
      },
      titleBarStyle: 'hiddenInset', // macOS native title bar
      trafficLightPosition: { x: 15, y: 15 },
      vibrancy: 'sidebar', // macOS native sidebar vibrancy
      show: false, // Don't show until ready
    });

    // Show window when ready to avoid flash
    this.window.once('ready-to-show', () => {
      this.window?.show();
    });

    // Load the app
    this.loadContent();

    // Handle window close
    this.window.on('closed', () => {
      this.window = null;
    });

    // Handle fullscreen changes
    this.window.on('enter-full-screen', () => {
      this.window?.webContents.send(IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE, {
        isFullscreen: true,
      });
    });

    this.window.on('leave-full-screen', () => {
      this.window?.webContents.send(IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE, {
        isFullscreen: false,
      });
    });

    // Forward found-in-page results to renderer
    this.window.webContents.on('found-in-page', (_event, result) => {
      this.window?.webContents.send(IPC_CHANNELS.FIND.ON_RESULT, {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });

    // Register IPC handler for getting fullscreen state
    ipcMain.handle(IPC_CHANNELS.WINDOW.GET_FULLSCREEN, () => {
      return this.window?.isFullScreen() ?? false;
    });

    return this.window;
  }

  /**
   * Load the window content (dev server or production file)
   */
  private loadContent(): void {
    if (!this.window) return;

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      void this.window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      void this.window.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
      );
    }
  }

  /**
   * Open DevTools in development mode
   */
  openDevTools(): void {
    if (process.env['NODE_ENV'] === 'development' || !app) {
      this.window?.webContents.openDevTools();
    }
  }

  /**
   * Focus the window
   */
  focus(): void {
    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore();
      }
      this.window.focus();
    }
  }

  /**
   * Check if window exists
   */
  exists(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /**
   * Send message to renderer
   */
  send(channel: string, ...args: unknown[]): void {
    this.window?.webContents.send(channel, ...args);
  }
}

// Import app for type checking only
import { app } from 'electron';

/**
 * Singleton instance
 */
let mainWindowInstance: MainWindow | null = null;

/**
 * Get the MainWindow singleton instance
 */
export function getMainWindow(): MainWindow {
  if (!mainWindowInstance) {
    mainWindowInstance = new MainWindow();
  }
  return mainWindowInstance;
}
