/**
 * IPC handlers for find-in-page operations
 */
import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../channels';

import type { FindInPageOptions } from '@shared/types';

export function registerFindHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.FIND.FIND_IN_PAGE,
    (event, { text, options }: { text: string; options: FindInPageOptions }) => {
      if (!text) return;
      event.sender.findInPage(text, options);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FIND.STOP_FINDING,
    (event, { action }: { action: 'clearSelection' | 'keepSelection' | 'activateSelection' }) => {
      event.sender.stopFindInPage(action);
    }
  );
}

export function unregisterFindHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.FIND.FIND_IN_PAGE);
  ipcMain.removeHandler(IPC_CHANNELS.FIND.STOP_FINDING);
}
