/**
 * IPC handlers for clipboard operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import { getClipboardService } from '../../services/ClipboardService';
import { IPC_CHANNELS } from '../channels';

import type { SaveFileResult } from '@shared/types';

/**
 * Register clipboard-related IPC handlers
 */
export function registerClipboardHandlers(): void {
  const clipboardService = getClipboardService();

  // Handle write text to clipboard
  ipcMain.handle(
    IPC_CHANNELS.CLIPBOARD.WRITE_TEXT,
    (_event, text: string): void => {
      clipboardService.writeText(text);
    }
  );

  // Handle write HTML to clipboard
  ipcMain.handle(
    IPC_CHANNELS.CLIPBOARD.WRITE_HTML,
    (_event, html: string): void => {
      clipboardService.writeHtml(html);
    }
  );

  // Handle write image to clipboard
  ipcMain.handle(
    IPC_CHANNELS.CLIPBOARD.WRITE_IMAGE,
    (_event, base64: string): void => {
      clipboardService.writeImage(base64);
    }
  );

  // Handle save file with dialog
  ipcMain.handle(
    IPC_CHANNELS.CLIPBOARD.SAVE_FILE,
    async (event, base64: string, filename: string): Promise<SaveFileResult> => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      return clipboardService.saveFile(base64, filename, window);
    }
  );
}

/**
 * Unregister clipboard-related IPC handlers
 */
export function unregisterClipboardHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.CLIPBOARD.WRITE_TEXT);
  ipcMain.removeHandler(IPC_CHANNELS.CLIPBOARD.WRITE_HTML);
  ipcMain.removeHandler(IPC_CHANNELS.CLIPBOARD.WRITE_IMAGE);
  ipcMain.removeHandler(IPC_CHANNELS.CLIPBOARD.SAVE_FILE);
}
