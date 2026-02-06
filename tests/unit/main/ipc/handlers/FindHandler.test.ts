import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '@main/ipc/channels';
import {
  registerFindHandlers,
  unregisterFindHandlers,
} from '@main/ipc/handlers/FindHandler';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
      _getHandler: (channel: string) => handlers.get(channel),
      _clearHandlers: () => handlers.clear(),
    },
  };
});

function getHandler(channel: string) {
  return (ipcMain as unknown as { _getHandler: (c: string) => ((...args: unknown[]) => unknown) | undefined })._getHandler(channel);
}

describe('FindHandler', () => {
  beforeEach(() => {
    (ipcMain as unknown as { _clearHandlers: () => void })._clearHandlers();
    vi.clearAllMocks();
    registerFindHandlers();
  });

  afterEach(() => {
    unregisterFindHandlers();
  });

  it('should register find handlers', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.FIND.FIND_IN_PAGE,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.FIND.STOP_FINDING,
      expect.any(Function),
    );
  });

  it('should unregister find handlers', () => {
    unregisterFindHandlers();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.FIND.FIND_IN_PAGE);
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.FIND.STOP_FINDING);
  });

  describe('find-in-page', () => {
    it('should call webContents.findInPage with text and options', async () => {
      const mockFindInPage = vi.fn();
      const mockEvent = { sender: { findInPage: mockFindInPage } };
      const handler = getHandler(IPC_CHANNELS.FIND.FIND_IN_PAGE);
      await handler!(mockEvent, { text: 'hello', options: { matchCase: true } });
      expect(mockFindInPage).toHaveBeenCalledWith('hello', { matchCase: true });
    });

    it('should call webContents.findInPage with default options', async () => {
      const mockFindInPage = vi.fn();
      const mockEvent = { sender: { findInPage: mockFindInPage } };
      const handler = getHandler(IPC_CHANNELS.FIND.FIND_IN_PAGE);
      await handler!(mockEvent, { text: 'world', options: {} });
      expect(mockFindInPage).toHaveBeenCalledWith('world', {});
    });

    it('should not call findInPage with empty text', async () => {
      const mockFindInPage = vi.fn();
      const mockEvent = { sender: { findInPage: mockFindInPage } };
      const handler = getHandler(IPC_CHANNELS.FIND.FIND_IN_PAGE);
      await handler!(mockEvent, { text: '', options: {} });
      expect(mockFindInPage).not.toHaveBeenCalled();
    });
  });

  describe('stop-finding', () => {
    it('should call webContents.stopFindInPage with clearSelection', async () => {
      const mockStopFindInPage = vi.fn();
      const mockEvent = { sender: { stopFindInPage: mockStopFindInPage } };
      const handler = getHandler(IPC_CHANNELS.FIND.STOP_FINDING);
      await handler!(mockEvent, { action: 'clearSelection' });
      expect(mockStopFindInPage).toHaveBeenCalledWith('clearSelection');
    });

    it('should call webContents.stopFindInPage with keepSelection', async () => {
      const mockStopFindInPage = vi.fn();
      const mockEvent = { sender: { stopFindInPage: mockStopFindInPage } };
      const handler = getHandler(IPC_CHANNELS.FIND.STOP_FINDING);
      await handler!(mockEvent, { action: 'keepSelection' });
      expect(mockStopFindInPage).toHaveBeenCalledWith('keepSelection');
    });
  });
});
