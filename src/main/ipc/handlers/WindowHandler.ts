/**
 * IPC handlers for window operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '@shared/types/api';
import { getWindowManager } from '@main/window/WindowManager';

export function registerWindowHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WINDOW.GET_FULLSCREEN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isFullScreen() ?? false;
  });

  // TODO: Pass filePath to createWindow once file path routing is wired up (Task 8)
  ipcMain.handle(IPC_CHANNELS.WINDOW.OPEN_NEW, (_event, _filePath?: string) => {
    const windowManager = getWindowManager();
    windowManager.createWindow();
  });
}

export function unregisterWindowHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.WINDOW.GET_FULLSCREEN);
  ipcMain.removeHandler(IPC_CHANNELS.WINDOW.OPEN_NEW);
}
