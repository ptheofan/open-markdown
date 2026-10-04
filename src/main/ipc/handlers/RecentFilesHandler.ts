/**
 * RecentFilesHandler - IPC handlers for recent files operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  getRecentFilesService,
  RecentFilesService,
} from '@main/services/RecentFilesService';
import { IPC_CHANNELS } from '@shared/types/api';

import type { RecentFileEntry, RecentFolderEntry } from '@shared/types';

let recentFilesChangeCleanup: (() => void) | null = null;
let recentFoldersChangeCleanup: (() => void) | null = null;

function sendRecentFoldersChangeToAllWindows(folders: RecentFolderEntry[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.RECENT_FILES.ON_FOLDERS_CHANGE, folders);
    }
  }
}

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

  ipcMain.handle(IPC_CHANNELS.RECENT_FILES.GET_FOLDERS, (): RecentFolderEntry[] => {
    return service.getRecentFolders();
  });

  ipcMain.handle(
    IPC_CHANNELS.RECENT_FILES.ADD_FOLDER,
    async (_event: Electron.IpcMainInvokeEvent, folderPath: string): Promise<void> => {
      if (typeof folderPath !== 'string') return;
      await service.addRecentFolder(folderPath);
    }
  );

  recentFilesChangeCleanup = service.onRecentFilesChange((files) => {
    sendRecentFilesChangeToAllWindows(files);
  });
  recentFoldersChangeCleanup = service.onRecentFoldersChange((folders) => {
    sendRecentFoldersChangeToAllWindows(folders);
  });
}

export function unregisterRecentFilesHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.GET);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.ADD);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.REMOVE);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.CLEAR);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.GET_FOLDERS);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.ADD_FOLDER);
  if (recentFoldersChangeCleanup) {
    recentFoldersChangeCleanup();
    recentFoldersChangeCleanup = null;
  }

  if (recentFilesChangeCleanup) {
    recentFilesChangeCleanup();
    recentFilesChangeCleanup = null;
  }
}
