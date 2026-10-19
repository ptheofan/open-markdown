/**
 * DocumentBrowserHandler - IPC handlers for the document browser overlay
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  createDocumentBrowserService,
  DocumentBrowserService,
} from '@main/services/DocumentBrowserService';
import { getRecentFilesService } from '@main/services/RecentFilesService';
import { getSecurityBookmarkService } from '@main/services/SecurityBookmarkService';
import { getWindowManager } from '@main/window/WindowManager';
import { IPC_CHANNELS } from '@shared/types/api';

import type { DocumentBrowserSnapshot, PinnedDocumentEntry } from '@shared/types';

export function registerDocumentBrowserHandlers(
  documentBrowserService?: DocumentBrowserService
): void {
  const service =
    documentBrowserService ??
    createDocumentBrowserService({
      windows: getWindowManager(),
      getRecentFiles: () => getRecentFilesService().getRecentFiles(),
      getPinnedFiles: () => getRecentFilesService().getPinnedFiles(),
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

  // A pin is for coming back later. In the macOS sandbox that needs the
  // user to confirm the file once, so its access can be kept across launches.
  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_BROWSER.PIN,
    async (event, filePath: string): Promise<PinnedDocumentEntry[] | null> => {
      if (typeof filePath !== 'string' || !filePath) return null;
      const bookmarks = getSecurityBookmarkService();
      if (bookmarks.isEnabled() && !bookmarks.covers(filePath)) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await bookmarks.showOpenDialog(win ?? undefined, {
          title: 'Pin Document',
          message: 'Confirm the document so it can be opened from Pinned after a restart.',
          defaultPath: filePath,
          buttonLabel: 'Pin',
          properties: ['openFile'],
        });
        const picked = result.canceled ? undefined : result.filePaths[0];
        if (!picked) return null;
        filePath = picked;
      }
      await getRecentFilesService().pinFile(filePath);
      return service.pinnedEntries();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_BROWSER.UNPIN,
    async (_event, filePath: string): Promise<PinnedDocumentEntry[]> => {
      if (typeof filePath === 'string') {
        await getRecentFilesService().unpinFile(filePath);
      }
      return service.pinnedEntries();
    }
  );
}

export function unregisterDocumentBrowserHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.DOCUMENT_BROWSER.GET_SNAPSHOT);
  ipcMain.removeHandler(IPC_CHANNELS.DOCUMENT_BROWSER.FOCUS_WINDOW);
  ipcMain.removeHandler(IPC_CHANNELS.DOCUMENT_BROWSER.OPEN_FILE);
  ipcMain.removeHandler(IPC_CHANNELS.DOCUMENT_BROWSER.PIN);
  ipcMain.removeHandler(IPC_CHANNELS.DOCUMENT_BROWSER.UNPIN);
}
