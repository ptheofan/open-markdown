/**
 * IPC handlers for window operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../channels';
import { getWindowManager } from '../../window/WindowManager';

export function registerWindowHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WINDOW.GET_FULLSCREEN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isFullScreen() ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW.OPEN_NEW, () => {
    const windowManager = getWindowManager();
    windowManager.createWindow();
  });
}

export function unregisterWindowHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.WINDOW.GET_FULLSCREEN);
  ipcMain.removeHandler(IPC_CHANNELS.WINDOW.OPEN_NEW);
}
