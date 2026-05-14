/**
 * WindowManager - Manages multiple application windows
 */
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';

import { DEFAULT_WINDOW, APP_CONFIG } from '@shared/constants';
import { IPC_CHANNELS } from '@shared/types/api';
import type { WindowState } from '@shared/types';
import type { PreferencesService } from '../services/PreferencesService';
import { getPreferencesService } from '../services/PreferencesService';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const IS_DEV = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && !!MAIN_WINDOW_VITE_DEV_SERVER_URL;

/** Debounce delay for persisting window bounds during resize/move (ms) */
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 500;

export class WindowManager {
  private windows: Map<number, BrowserWindow> = new Map();
  private windowFilePaths: Map<number, string | null> = new Map();
  private saveTimers: Map<number, NodeJS.Timeout> = new Map();
  private preferencesService?: PreferencesService;

  constructor(preferencesService?: PreferencesService) {
    this.preferencesService = preferencesService;
  }

  createWindow(): BrowserWindow {
    const savedState = this.getSavedWindowState();

    const win = new BrowserWindow({
      width: savedState.width,
      height: savedState.height,
      x: savedState.x,
      y: savedState.y,
      minWidth: DEFAULT_WINDOW.MIN_WIDTH,
      minHeight: DEFAULT_WINDOW.MIN_HEIGHT,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        devTools: IS_DEV,
      },
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 15, y: 15 },
      vibrancy: 'sidebar',
      show: false,
    });

    if (savedState.isMaximized) {
      win.maximize();
    }

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

    win.on('resize', () => this.scheduleWindowStateSave(win));
    win.on('move', () => this.scheduleWindowStateSave(win));
    win.on('maximize', () => this.persistWindowState(win));
    win.on('unmaximize', () => this.persistWindowState(win));

    win.on('close', () => {
      const timer = this.saveTimers.get(win.id);
      if (timer) {
        clearTimeout(timer);
        this.saveTimers.delete(win.id);
      }
      this.persistWindowState(win);
    });

    win.on('closed', () => {
      this.windows.delete(win.id);
      this.windowFilePaths.delete(win.id);
      this.saveTimers.delete(win.id);
    });

    if (IS_DEV) {
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
    for (const timer of this.saveTimers.values()) {
      clearTimeout(timer);
    }
    this.saveTimers.clear();
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

  /**
   * Resolve the window state to open a new window with. Falls back to
   * defaults when no preferences service is wired up, and drops a saved
   * position that no longer lands on a connected display.
   */
  private getSavedWindowState(): WindowState {
    if (!this.preferencesService) {
      return {
        width: DEFAULT_WINDOW.WIDTH,
        height: DEFAULT_WINDOW.HEIGHT,
        isMaximized: false,
      };
    }

    const state = this.preferencesService.getPreferences().windowState;

    if (
      state.x !== undefined &&
      state.y !== undefined &&
      !this.isPositionOnScreen(state.x, state.y, state.width, state.height)
    ) {
      // Saved position is off-screen (e.g. an external monitor was
      // disconnected) - keep the size but let Electron center the window.
      return {
        width: state.width,
        height: state.height,
        isMaximized: state.isMaximized,
      };
    }

    return state;
  }

  /**
   * Check whether a window rectangle overlaps any connected display's
   * work area, so we never restore a window to an invisible location.
   */
  private isPositionOnScreen(
    x: number,
    y: number,
    width: number,
    height: number
  ): boolean {
    return screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return (
        x < area.x + area.width &&
        x + width > area.x &&
        y < area.y + area.height &&
        y + height > area.y
      );
    });
  }

  private scheduleWindowStateSave(win: BrowserWindow): void {
    if (!this.preferencesService || win.isDestroyed()) return;

    const existing = this.saveTimers.get(win.id);
    if (existing) {
      clearTimeout(existing);
    }

    this.saveTimers.set(
      win.id,
      setTimeout(() => {
        this.saveTimers.delete(win.id);
        this.persistWindowState(win);
      }, WINDOW_STATE_SAVE_DEBOUNCE_MS)
    );
  }

  private persistWindowState(win: BrowserWindow): void {
    if (!this.preferencesService || win.isDestroyed()) return;

    // getNormalBounds() reports the un-maximized bounds, so we always
    // persist a sensible size to restore to even while maximized.
    const bounds = win.getNormalBounds();
    const windowState: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    };

    void this.preferencesService.updatePreferences({ windowState });
  }
}

let windowManagerInstance: WindowManager | null = null;

export function getWindowManager(): WindowManager {
  if (!windowManagerInstance) {
    windowManagerInstance = new WindowManager(getPreferencesService());
  }
  return windowManagerInstance;
}

export function resetWindowManager(): void {
  if (windowManagerInstance) {
    windowManagerInstance.destroy();
    windowManagerInstance = null;
  }
}
