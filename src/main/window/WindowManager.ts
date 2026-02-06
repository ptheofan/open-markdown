/**
 * WindowManager - Manages multiple application windows
 */
import { BrowserWindow } from 'electron';
import path from 'node:path';

import { DEFAULT_WINDOW, APP_CONFIG } from '@shared/constants';
import { IPC_CHANNELS } from '@shared/types/api';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export class WindowManager {
  private windows: Map<number, BrowserWindow> = new Map();
  private windowFilePaths: Map<number, string | null> = new Map();

  createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: DEFAULT_WINDOW.WIDTH,
      height: DEFAULT_WINDOW.HEIGHT,
      minWidth: DEFAULT_WINDOW.MIN_WIDTH,
      minHeight: DEFAULT_WINDOW.MIN_HEIGHT,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 15, y: 15 },
      vibrancy: 'sidebar',
      show: false,
    });

    this.windows.set(win.id, win);
    this.windowFilePaths.set(win.id, null);

    win.once('ready-to-show', () => {
      win.show();
    });

    this.loadContent(win);

    win.on('enter-full-screen', () => {
      win.webContents.send(IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE, {
        isFullscreen: true,
      });
    });

    win.on('leave-full-screen', () => {
      win.webContents.send(IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE, {
        isFullscreen: false,
      });
    });

    win.on('closed', () => {
      this.windows.delete(win.id);
      this.windowFilePaths.delete(win.id);
    });

    if (process.env['NODE_ENV'] !== 'production') {
      win.webContents.openDevTools();
    }

    return win;
  }

  getWindow(id: number): BrowserWindow | undefined {
    return this.windows.get(id);
  }

  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values());
  }

  getWindowByFilePath(filePath: string): BrowserWindow | undefined {
    for (const [id, fp] of this.windowFilePaths) {
      if (fp === filePath) {
        return this.windows.get(id);
      }
    }
    return undefined;
  }

  setWindowFilePath(windowId: number, filePath: string | null): void {
    this.windowFilePaths.set(windowId, filePath);
    const win = this.windows.get(windowId);
    if (win && !win.isDestroyed()) {
      if (filePath) {
        const fileName = path.basename(filePath);
        win.setTitle(fileName);
      } else {
        win.setTitle(APP_CONFIG.NAME);
      }
    }
  }

  getWindowFilePath(windowId: number): string | null {
    return this.windowFilePaths.get(windowId) ?? null;
  }

  getEmptyWindow(): BrowserWindow | undefined {
    for (const [id, filePath] of this.windowFilePaths) {
      if (filePath === null) {
        return this.windows.get(id);
      }
    }
    return undefined;
  }

  destroy(): void {
    this.windows.clear();
    this.windowFilePaths.clear();
  }

  private loadContent(win: BrowserWindow): void {
    if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else if (typeof MAIN_WINDOW_VITE_NAME !== 'undefined') {
      void win.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
      );
    }
  }
}

let windowManagerInstance: WindowManager | null = null;

export function getWindowManager(): WindowManager {
  if (!windowManagerInstance) {
    windowManagerInstance = new WindowManager();
  }
  return windowManagerInstance;
}

export function resetWindowManager(): void {
  if (windowManagerInstance) {
    windowManagerInstance.destroy();
    windowManagerInstance = null;
  }
}
