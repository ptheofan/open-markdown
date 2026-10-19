/**
 * IPC handlers for the folder sidebar
 */
import { BrowserWindow, ipcMain } from 'electron';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { IPC_CHANNELS } from '@shared/types/api';
import type { FolderEntry, FolderListOptions } from '@shared/types/folder';

import { defaultDocument, isDirectoryPath, listDirectory, walkFolder } from '../../services/FolderService';
import { getFolderWatcherService } from '../../services/FolderWatcherService';
import { isAccessDenied } from '../../services/sandboxPaths';
import { getSecurityBookmarkService } from '../../services/SecurityBookmarkService';

const windowSubscriptions = new Map<number, () => void>();

export function registerFolderHandlers(): void {
  const watcherService = getFolderWatcherService();

  ipcMain.handle(IPC_CHANNELS.FOLDER.OPEN_DIALOG, async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Open Folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = await getSecurityBookmarkService().showOpenDialog(window ?? undefined, options);
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  // The macOS sandbox refuses a remembered folder until the user picks it
  // again; ask once, starting on it, and keep the access for later launches.
  ipcMain.handle(IPC_CHANNELS.FOLDER.ENSURE_ACCESS, async (event, folderPath: string): Promise<boolean> => {
    if (typeof folderPath !== 'string') return false;
    try {
      await readdir(folderPath);
      return true;
    } catch (error) {
      if (!isAccessDenied(error)) return false;
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await getSecurityBookmarkService().showOpenDialog(window ?? undefined, {
      title: 'Allow Access to Folder',
      message: `macOS needs your OK to show ${folderPath}.`,
      defaultPath: folderPath,
      buttonLabel: 'Allow',
      properties: ['openDirectory'],
    });
    const picked = result.canceled ? undefined : result.filePaths[0];
    if (!picked) return false;
    const relative = path.relative(picked, folderPath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
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
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.ENSURE_ACCESS);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.IS_DIRECTORY);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.LIST);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.LIST_ALL);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.DEFAULT_DOCUMENT);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.WATCH);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDER.UNWATCH);
  for (const cleanup of windowSubscriptions.values()) cleanup();
  windowSubscriptions.clear();
}
