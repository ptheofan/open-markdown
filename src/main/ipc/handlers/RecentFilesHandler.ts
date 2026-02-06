/**
 * RecentFilesHandler - IPC handlers for recent files operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  getRecentFilesService,
  RecentFilesService,
} from '@main/services/RecentFilesService';
import { IPC_CHANNELS } from '@shared/types/api';

import type { RecentFileEntry } from '@shared/types';

let recentFilesChangeCleanup: (() => void) | null = null;

function sendRecentFilesChangeToAllWindows(files: RecentFileEntry[]): void {
  const windows = BrowserWindow.getAllWindows();

  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.RECENT_FILES.ON_CHANGE, files);
    }
  }
}

export function registerRecentFilesHandlers(
  recentFilesService?: RecentFilesService
): void {
  const service = recentFilesService ?? getRecentFilesService();

  ipcMain.handle(
    IPC_CHANNELS.RECENT_FILES.GET,
    (): RecentFileEntry[] => {
      return service.getRecentFiles();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RECENT_FILES.ADD,
    async (_event: Electron.IpcMainInvokeEvent, filePath: string): Promise<void> => {
      await service.addRecentFile(filePath);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RECENT_FILES.REMOVE,
    async (_event: Electron.IpcMainInvokeEvent, filePath: string): Promise<void> => {
      await service.removeRecentFile(filePath);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RECENT_FILES.CLEAR,
    async (): Promise<void> => {
      await service.clearRecentFiles();
    }
  );

  recentFilesChangeCleanup = service.onRecentFilesChange((files) => {
    sendRecentFilesChangeToAllWindows(files);
  });
}

export function unregisterRecentFilesHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.GET);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.ADD);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.REMOVE);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.CLEAR);

  if (recentFilesChangeCleanup) {
    recentFilesChangeCleanup();
    recentFilesChangeCleanup = null;
  }
}
