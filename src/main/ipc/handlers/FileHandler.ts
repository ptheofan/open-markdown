/**
 * IPC handlers for file operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import { getFileService } from '../../services/FileService';
import { getFileWatcherService } from '../../services/FileWatcherService';
import { IPC_CHANNELS } from '../channels';

import type { FileOpenResult, FileReadResult } from '@shared/types';

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

      // Clean up subscriptions when window closes
      window.once('closed', () => {
        unsubscribeChange();
        unsubscribeDelete();
        void fileWatcherService.unwatchAll(windowId);
      });

      await fileWatcherService.watch(filePath, windowId);
    }
  );

  // Handle file unwatch
  ipcMain.handle(
    IPC_CHANNELS.FILE.UNWATCH,
    async (event, filePath: string): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;

      await fileWatcherService.unwatch(filePath, window.id);
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
