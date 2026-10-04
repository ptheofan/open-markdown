/**
 * IPC handlers for app updates, and the service's wiring to Electron
 */
import { app, autoUpdater, BrowserWindow, ipcMain, net } from 'electron';

import { getPreferencesService } from '../../services/PreferencesService';
import { UpdateService } from '../../services/UpdateService';
import { IPC_CHANNELS } from '../channels';

import type { UpdateStatus } from '@shared/types/updates';

/** The repository releases are read from */
export const UPDATE_REPO = 'ptheofan/open-markdown';

let service: UpdateService | null = null;

async function fetchJson(url: string): Promise<unknown> {
  const response = await net.fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `open-markdown/${app.getVersion()}` },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return response.json();
}

function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.UPDATES.ON_STATUS, status);
  }
}

/**
 * The update service, created on first use. Squirrel is only handed over
 * on the platforms it works on; elsewhere the service announces instead.
 */
export function getUpdateService(): UpdateService {
  if (!service) {
    const squirrelPlatform = process.platform === 'darwin' || process.platform === 'win32';
    service = new UpdateService({
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      isMas: Boolean(process.mas),
      currentVersion: app.getVersion(),
      repo: UPDATE_REPO,
      autoUpdater: squirrelPlatform ? autoUpdater : null,
      fetchJson,
      getPreferences: () => getPreferencesService().getPreferences().core.updates,
      onStatus: broadcast,
    });
  }
  return service;
}

/**
 * Register update-related IPC handlers and start the schedule
 */
export function registerUpdateHandlers(): void {
  const updates = getUpdateService();

  ipcMain.handle(IPC_CHANNELS.UPDATES.GET_STATUS, (): UpdateStatus => updates.getStatus());

  ipcMain.handle(IPC_CHANNELS.UPDATES.CHECK, (): Promise<UpdateStatus> => updates.check({ force: true }));

  ipcMain.handle(IPC_CHANNELS.UPDATES.INSTALL, (): void => {
    updates.install();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATES.GET_RELEASE_NOTES, (): Promise<string | null> => updates.getReleaseNotes());

  updates.start();
}

/**
 * Unregister update-related IPC handlers
 */
export function unregisterUpdateHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.UPDATES.GET_STATUS);
  ipcMain.removeHandler(IPC_CHANNELS.UPDATES.CHECK);
  ipcMain.removeHandler(IPC_CHANNELS.UPDATES.INSTALL);
  ipcMain.removeHandler(IPC_CHANNELS.UPDATES.GET_RELEASE_NOTES);
}
