/**
 * IPC handlers for the folder sidebar
 */
import { BrowserWindow, dialog, ipcMain } from 'electron';

import { IPC_CHANNELS } from '@shared/types/api';
import type { FolderEntry, FolderListOptions } from '@shared/types/folder';

import { defaultDocument, isDirectoryPath, listDirectory, walkFolder } from '../../services/FolderService';
import { getFolderWatcherService } from '../../services/FolderWatcherService';

const windowSubscriptions = new Map<number, () => void>();

export function registerFolderHandlers(): void {
  const watcherService = getFolderWatcherService();

  ipcMain.handle(IPC_CHANNELS.FOLDER.OPEN_DIALOG, async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Open Folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER.IS_DIRECTORY, (_event, targetPath: string): Promise<boolean> => {
    if (typeof targetPath !== 'string') return Promise.resolve(false);
    return isDirectoryPath(targetPath);
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLDER.LIST,
    async (_event, dirPath: string, options: FolderListOptions): Promise<FolderEntry[]> => {
      if (typeof dirPath !== 'string' || typeof options?.root !== 'string') return [];
      try {
        return await listDirectory(dirPath, { root: options.root, showAll: options.showAll === true });
      } catch {
        return [];
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDER.LIST_ALL,
    (_event, root: string, options: { showAll: boolean }): Promise<string[]> => {
      if (typeof root !== 'string') return Promise.resolve([]);
      return walkFolder(root, { showAll: options?.showAll === true });
    }
  );

  ipcMain.handle(IPC_CHANNELS.FOLDER.DEFAULT_DOCUMENT, async (_event, root: string): Promise<string | null> => {
    if (typeof root !== 'string') return null;
    try {
      return await defaultDocument(root);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER.WATCH, async (event, dirPath: string): Promise<void> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || typeof dirPath !== 'string') return;
    const windowId = window.id;

    if (!windowSubscriptions.has(windowId)) {
      const cleanup = watcherService.onChange(windowId, (changedDir) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.FOLDER.ON_CHANGE, { dirPath: changedDir });
        }
      });
      windowSubscriptions.set(windowId, cleanup);
      window.once('closed', () => {
        cleanup();
        windowSubscriptions.delete(windowId);
        void watcherService.unwatchAll(windowId);
      });
    }

    try {
      await watcherService.watch(dirPath, windowId);
    } catch (error) {
      console.error('Failed to watch folder:', error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER.UNWATCH, async (event, dirPath: string): Promise<void> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || typeof dirPath !== 'string') return;
    await watcherService.unwatch(dirPath, window.id);
  });
}

export function unregisterFolderHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.OPEN_DIALOG);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.IS_DIRECTORY);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.LIST);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.LIST_ALL);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.DEFAULT_DOCUMENT);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.WATCH);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.UNWATCH);
  for (const cleanup of windowSubscriptions.values()) cleanup();
  windowSubscriptions.clear();
}
