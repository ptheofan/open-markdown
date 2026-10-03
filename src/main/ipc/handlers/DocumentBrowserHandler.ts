/**
 * DocumentBrowserHandler - IPC handlers for the document browser overlay
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  createDocumentBrowserService,
  DocumentBrowserService,
} from '@main/services/DocumentBrowserService';
import { getRecentFilesService } from '@main/services/RecentFilesService';
import { getWindowManager } from '@main/window/WindowManager';
import { IPC_CHANNELS } from '@shared/types/api';

import type { DocumentBrowserSnapshot } from '@shared/types';

export function registerDocumentBrowserHandlers(
  documentBrowserService?: DocumentBrowserService
): void {
  const service =
    documentBrowserService ??
    createDocumentBrowserService({
      windows: getWindowManager(),
      getRecentFiles: () => getRecentFilesService().getRecentFiles(),
    });

  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_BROWSER.GET_SNAPSHOT,
    (event): Promise<DocumentBrowserSnapshot> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      return service.buildSnapshot(win?.id ?? null);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_BROWSER.FOCUS_WINDOW,
    (_event, windowId: number): void => {
      const windowManager = getWindowManager();
      const win = windowManager.getWindow(windowId);
      if (win) {
        windowManager.focusWindow(win);
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_BROWSER.OPEN_FILE,
    (_event, filePath: string): void => {
      getWindowManager().openFile(filePath);
    }
  );
}

export function unregisterDocumentBrowserHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.DOCUMENT_BROWSER.GET_SNAPSHOT);
  ipcMain.removeHandler(IPC_CHANNELS.DOCUMENT_BROWSER.FOCUS_WINDOW);
  ipcMain.removeHandler(IPC_CHANNELS.DOCUMENT_BROWSER.OPEN_FILE);
}
