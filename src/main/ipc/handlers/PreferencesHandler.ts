/**
 * PreferencesHandler - IPC handlers for preferences operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  getPreferencesService,
  PreferencesService,
} from '@main/services/PreferencesService';
import { IPC_CHANNELS } from '@shared/types/api';

import type { AppPreferences, DeepPartial } from '@shared/types';

/**
 * Cleanup function reference for preferences change listener
 */
let preferencesChangeCleanup: (() => void) | null = null;

/**
 * Send preferences change event to all renderer windows
 */
function sendPreferencesChangeToAllWindows(preferences: AppPreferences): void {
  const windows = BrowserWindow.getAllWindows();

  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.PREFERENCES.ON_CHANGE, preferences);
    }
  }
}

/**
 * Register preferences IPC handlers
 */
export function registerPreferencesHandlers(
  preferencesService?: PreferencesService
): void {
  const service = preferencesService ?? getPreferencesService();

  // Get all preferences
  ipcMain.handle(
    IPC_CHANNELS.PREFERENCES.GET,
    (): AppPreferences => {
      return service.getPreferences();
    }
  );

  // Set preferences (partial update)
  ipcMain.handle(
    IPC_CHANNELS.PREFERENCES.SET,
    async (_event, updates: DeepPartial<AppPreferences>): Promise<AppPreferences> => {
      await service.updatePreferences(updates);
      return service.getPreferences();
    }
  );

  // Reset to defaults
  ipcMain.handle(
    IPC_CHANNELS.PREFERENCES.RESET,
    async (): Promise<AppPreferences> => {
      return service.resetToDefaults();
    }
  );

  // Get plugin preferences
  ipcMain.handle(
    IPC_CHANNELS.PREFERENCES.GET_PLUGIN,
    <T>(_event: Electron.IpcMainInvokeEvent, pluginId: string): T | null => {
      return service.getPluginPreferences<T>(pluginId);
    }
  );

  // Set plugin preferences
  ipcMain.handle(
    IPC_CHANNELS.PREFERENCES.SET_PLUGIN,
    async <T>(
      _event: Electron.IpcMainInvokeEvent,
      pluginId: string,
      preferences: T
    ): Promise<void> => {
      await service.setPluginPreferences(pluginId, preferences);
    }
  );

  // Subscribe to preferences changes
  preferencesChangeCleanup = service.onPreferencesChange((preferences) => {
    sendPreferencesChangeToAllWindows(preferences);
  });
}

/**
 * Unregister preferences IPC handlers
 */
export function unregisterPreferencesHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.PREFERENCES.GET);
  ipcMain.removeHandler(IPC_CHANNELS.PREFERENCES.SET);
  ipcMain.removeHandler(IPC_CHANNELS.PREFERENCES.RESET);
  ipcMain.removeHandler(IPC_CHANNELS.PREFERENCES.GET_PLUGIN);
  ipcMain.removeHandler(IPC_CHANNELS.PREFERENCES.SET_PLUGIN);

  if (preferencesChangeCleanup) {
    preferencesChangeCleanup();
    preferencesChangeCleanup = null;
  }
}
