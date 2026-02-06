/**
 * IPC handlers for file operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import { getFileService } from '../../services/FileService';
import { getFileWatcherService } from '../../services/FileWatcherService';
import { getWindowManager } from '@main/window/WindowManager';
import { IPC_CHANNELS } from '../channels';

import type { FileOpenResult, FileReadResult } from '@shared/types';

// Track per-window subscription cleanup functions to prevent duplicate callbacks
const windowSubscriptions = new Map<number, () => void>();

/**
 * Register file-related IPC handlers
 */
export function registerFileHandlers(): void {
  const fileService = getFileService();
  const fileWatcherService = getFileWatcherService();

  // Handle file open dialog
  ipcMain.handle(
    IPC_CHANNELS.FILE.OPEN_DIALOG,
    async (event): Promise<FileOpenResult> => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      return fileService.openFileDialog(window);
    }
  );

  // Handle file read
  ipcMain.handle(
    IPC_CHANNELS.FILE.READ,
    async (_event, filePath: string): Promise<FileReadResult> => {
      return fileService.readFile(filePath);
    }
  );

  // Handle file watch
  ipcMain.handle(
    IPC_CHANNELS.FILE.WATCH,
    async (event, filePath: string): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;

      const windowId = window.id;

      // Unsubscribe previous callbacks for this window (prevents duplicates on file switch)
      const previousCleanup = windowSubscriptions.get(windowId);
      if (previousCleanup) {
        previousCleanup();
      }

      // Set up forwarding of file events to the renderer
      const unsubscribeChange = fileWatcherService.onFileChange(windowId, (changeEvent) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.FILE.ON_CHANGE, changeEvent);
        }
      });

      const unsubscribeDelete = fileWatcherService.onFileDelete(windowId, (deleteEvent) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.FILE.ON_DELETE, deleteEvent);
        }
      });

      const cleanup = (): void => {
        unsubscribeChange();
        unsubscribeDelete();
        windowSubscriptions.delete(windowId);
      };

      windowSubscriptions.set(windowId, cleanup);

      // Clean up subscriptions when window closes
      window.once('closed', () => {
        cleanup();
        void fileWatcherService.unwatchAll(windowId);
        getWindowManager().setWindowFilePath(windowId, null);
      });

      await fileWatcherService.watch(filePath, windowId);
      getWindowManager().setWindowFilePath(windowId, filePath);
    }
  );

  // Handle file unwatch
  ipcMain.handle(
    IPC_CHANNELS.FILE.UNWATCH,
    async (event, filePath: string): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;

      await fileWatcherService.unwatch(filePath, window.id);
      getWindowManager().setWindowFilePath(window.id, null);
    }
  );
}

/**
 * Unregister file-related IPC handlers
 */
export function unregisterFileHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.FILE.OPEN_DIALOG);
  ipcMain.removeHandler(IPC_CHANNELS.FILE.READ);
  ipcMain.removeHandler(IPC_CHANNELS.FILE.WATCH);
  ipcMain.removeHandler(IPC_CHANNELS.FILE.UNWATCH);
}
