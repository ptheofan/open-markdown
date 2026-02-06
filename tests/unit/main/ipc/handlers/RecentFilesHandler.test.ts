/**
 * RecentFilesHandler unit tests
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  registerRecentFilesHandlers,
  unregisterRecentFilesHandlers,
} from '@main/ipc/handlers/RecentFilesHandler';
import { IPC_CHANNELS } from '@shared/types/api';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { RecentFilesService } from '@main/services/RecentFilesService';
import type { RecentFileEntry } from '@shared/types';

interface MockRecentFilesService {
  getRecentFiles: ReturnType<typeof vi.fn>;
  addRecentFile: ReturnType<typeof vi.fn>;
  removeRecentFile: ReturnType<typeof vi.fn>;
  clearRecentFiles: ReturnType<typeof vi.fn>;
  onRecentFilesChange: ReturnType<typeof vi.fn>;
  _triggerChange: (files: RecentFileEntry[]) => void;
}

// Mock Electron modules
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
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    },
  };
});

function createMockService(): MockRecentFilesService {
  let changeCallback: ((files: RecentFileEntry[]) => void) | null = null;

  return {
    getRecentFiles: vi.fn(() => []),
    addRecentFile: vi.fn(() => Promise.resolve()),
    removeRecentFile: vi.fn(() => Promise.resolve()),
    clearRecentFiles: vi.fn(() => Promise.resolve()),
    onRecentFilesChange: vi.fn((callback: (files: RecentFileEntry[]) => void) => {
      changeCallback = callback;
      return () => { changeCallback = null; };
    }),
    _triggerChange: (files: RecentFileEntry[]) => {
      changeCallback?.(files);
    },
  };
}

type MockIpcMain = typeof ipcMain & {
  _getHandler: (channel: string) => ((...args: unknown[]) => unknown) | undefined;
  _clearHandlers: () => void;
};

const mockIpcMain = ipcMain as MockIpcMain;

describe('RecentFilesHandler', () => {
  let mockService: MockRecentFilesService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain._clearHandlers();
    mockService = createMockService();
  });

  describe('registerRecentFilesHandlers', () => {
    it('should register all IPC handlers', () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.GET,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.ADD,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.REMOVE,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.CLEAR,
        expect.any(Function)
      );
    });

    it('should handle GET by returning recent files', () => {
      const mockFiles: RecentFileEntry[] = [
        { filePath: '/test/file.md', fileName: 'file.md', openedAt: '2026-01-01T00:00:00.000Z' },
      ];
      mockService.getRecentFiles.mockReturnValue(mockFiles);

      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.RECENT_FILES.GET);
      const result = handler?.();
      expect(result).toEqual(mockFiles);
    });

    it('should handle ADD by calling addRecentFile', async () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.RECENT_FILES.ADD);
      await handler?.({}, '/test/file.md');
      expect(mockService.addRecentFile).toHaveBeenCalledWith('/test/file.md');
    });

    it('should handle REMOVE by calling removeRecentFile', async () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.RECENT_FILES.REMOVE);
      await handler?.({}, '/test/file.md');
      expect(mockService.removeRecentFile).toHaveBeenCalledWith('/test/file.md');
    });

    it('should handle CLEAR by calling clearRecentFiles', async () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.RECENT_FILES.CLEAR);
      await handler?.();
      expect(mockService.clearRecentFiles).toHaveBeenCalled();
    });

    it('should broadcast changes to all windows', () => {
      const mockWin = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
      };
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(
        [mockWin] as unknown as BrowserWindow[]
      );

      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const mockFiles: RecentFileEntry[] = [
        { filePath: '/test/file.md', fileName: 'file.md', openedAt: '2026-01-01T00:00:00.000Z' },
      ];
      mockService._triggerChange(mockFiles);

      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.ON_CHANGE,
        mockFiles
      );
    });

    it('should skip destroyed windows when broadcasting', () => {
      const destroyedWin = {
        isDestroyed: vi.fn(() => true),
        webContents: { send: vi.fn() },
      };
      const aliveWin = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
      };
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(
        [destroyedWin, aliveWin] as unknown as BrowserWindow[]
      );

      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);
      mockService._triggerChange([]);

      expect(destroyedWin.webContents.send).not.toHaveBeenCalled();
      expect(aliveWin.webContents.send).toHaveBeenCalled();
    });
  });

  describe('unregisterRecentFilesHandlers', () => {
    it('should remove all handlers', () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);
      unregisterRecentFilesHandlers();

      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.RECENT_FILES.GET);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.RECENT_FILES.ADD);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.RECENT_FILES.REMOVE);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.RECENT_FILES.CLEAR);
    });
  });
});
