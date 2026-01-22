/**
 * IPC handlers for context menu operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import { getContextMenuService } from '../../services/ContextMenuService';
import { IPC_CHANNELS } from '../channels';

import type { ContextMenuShowRequest } from '@shared/types';

/**
 * Register context menu-related IPC handlers
 */
export function registerContextMenuHandlers(): void {
  const contextMenuService = getContextMenuService();

  // Handle show context menu
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MENU.SHOW,
    async (event, request: ContextMenuShowRequest): Promise<string | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return null;
      }
      return contextMenuService.show(request.items, request.x, request.y, window);
    }
  );
}

/**
 * Unregister context menu-related IPC handlers
 */
export function unregisterContextMenuHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.CONTEXT_MENU.SHOW);
}
