/**
 * ThemeHandler - IPC handlers for theme operations
 *
 * Theme mode preference (GET_CURRENT, SET) is delegated to
 * PreferencesService — the single source of truth for all
 * user preferences. ThemeService is used only for OS-level
 * system theme detection (GET_SYSTEM, ON_SYSTEM_CHANGE).
 */
import { ipcMain, BrowserWindow } from 'electron';

import { getThemeService, ThemeService } from '@main/services/ThemeService';
import {
  getPreferencesService,
  PreferencesService,
} from '@main/services/PreferencesService';
import { IPC_CHANNELS } from '@shared/types/api';

import type { ThemeMode, ResolvedTheme, ThemeChangeEvent } from '@shared/types';

/**
 * Cleanup function reference for system theme listener
 */
let systemThemeCleanup: (() => void) | null = null;

/**
 * Send theme change event to all renderer windows
 */
function sendThemeChangeToAllWindows(theme: ResolvedTheme): void {
  const windows = BrowserWindow.getAllWindows();
  const event: ThemeChangeEvent = { theme, isSystemChange: true };

  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.THEME.ON_SYSTEM_CHANGE, event);
    }
  }
}

/**
 * Register theme IPC handlers
 */
export function registerThemeHandlers(
  themeService?: ThemeService,
  preferencesService?: PreferencesService
): void {
  const service = themeService ?? getThemeService();
  const prefService = preferencesService ?? getPreferencesService();

  // Get current theme preference — reads from PreferencesService
  ipcMain.handle(
    IPC_CHANNELS.THEME.GET_CURRENT,
    (): ThemeMode => {
      return prefService.getPreferences().core.theme.mode;
    }
  );

  // Set theme preference — writes to PreferencesService
  ipcMain.handle(
    IPC_CHANNELS.THEME.SET,
    async (_event, theme: ThemeMode): Promise<void> => {
      await prefService.updatePreferences({ core: { theme: { mode: theme } } });
    }
  );

  // Get system theme (resolved)
  ipcMain.handle(
    IPC_CHANNELS.THEME.GET_SYSTEM,
    (): ResolvedTheme => {
      return service.getSystemTheme();
    }
  );

  // Subscribe to system theme changes
  systemThemeCleanup = service.onSystemThemeChange((theme) => {
    sendThemeChangeToAllWindows(theme);
  });
}

/**
 * Unregister theme IPC handlers
 */
export function unregisterThemeHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.THEME.GET_CURRENT);
  ipcMain.removeHandler(IPC_CHANNELS.THEME.SET);
  ipcMain.removeHandler(IPC_CHANNELS.THEME.GET_SYSTEM);

  if (systemThemeCleanup) {
    systemThemeCleanup();
    systemThemeCleanup = null;
  }
}
