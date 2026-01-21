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

      // Set up forwarding of file events to the renderer
      const unsubscribeChange = fileWatcherService.onFileChange((changeEvent) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.FILE.ON_CHANGE, changeEvent);
        }
      });

      const unsubscribeDelete = fileWatcherService.onFileDelete((deleteEvent) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.FILE.ON_DELETE, deleteEvent);
        }
      });

      // Clean up subscriptions when window closes
      window.once('closed', () => {
        unsubscribeChange();
        unsubscribeDelete();
      });

      await fileWatcherService.watch(filePath);
    }
  );

  // Handle file unwatch
  ipcMain.handle(
    IPC_CHANNELS.FILE.UNWATCH,
    async (_event, _filePath: string): Promise<void> => {
      await fileWatcherService.unwatch();
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
