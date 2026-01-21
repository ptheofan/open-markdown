/**
 * FileHandler unit tests
 */
import { ipcMain, BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '@main/ipc/channels';
import {
  registerFileHandlers,
  unregisterFileHandlers,
} from '@main/ipc/handlers/FileHandler';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { FileOpenResult, FileReadResult, FileChangeEvent, FileDeleteEvent } from '@shared/types';

// Callback types for file watcher
type FileChangeCallback = (event: FileChangeEvent) => void;
type FileDeleteCallback = (event: FileDeleteEvent) => void;

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
      fromWebContents: vi.fn(),
    },
  };
});

// Mock services
const mockFileService = {
  openFileDialog: vi.fn(),
  readFile: vi.fn(),
};

const mockFileWatcherService = {
  watch: vi.fn(),
  unwatch: vi.fn(),
  onFileChange: vi.fn().mockReturnValue(vi.fn()) as ReturnType<typeof vi.fn> & {
    mockImplementation: (cb: (callback: FileChangeCallback) => () => void) => void;
  },
  onFileDelete: vi.fn().mockReturnValue(vi.fn()) as ReturnType<typeof vi.fn> & {
    mockImplementation: (cb: (callback: FileDeleteCallback) => () => void) => void;
  },
};

vi.mock('@main/services/FileService', () => ({
  getFileService: () => mockFileService,
}));

vi.mock('@main/services/FileWatcherService', () => ({
  getFileWatcherService: () => mockFileWatcherService,
}));

type MockIpcMain = typeof ipcMain & {
  _getHandler: (channel: string) => ((...args: unknown[]) => unknown) | undefined;
  _clearHandlers: () => void;
};

describe('FileHandler', () => {
  const mockIpcMain = ipcMain as MockIpcMain;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain._clearHandlers();
  });

  afterEach(() => {
    unregisterFileHandlers();
  });

  describe('registerFileHandlers', () => {
    it('should register all file IPC handlers', () => {
      registerFileHandlers();

      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.FILE.OPEN_DIALOG,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.FILE.READ,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.FILE.WATCH,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.FILE.UNWATCH,
        expect.any(Function)
      );
    });
  });

  describe('unregisterFileHandlers', () => {
    it('should remove all file IPC handlers', () => {
      registerFileHandlers();
      unregisterFileHandlers();

      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.FILE.OPEN_DIALOG);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.FILE.READ);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.FILE.WATCH);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.FILE.UNWATCH);
    });
  });

  describe('OPEN_DIALOG handler', () => {
    it('should call fileService.openFileDialog with window', async () => {
      const mockWindow = { id: 1 };
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as unknown as BrowserWindow);

      const expectedResult: FileOpenResult = {
        success: true,
        filePath: '/path/to/file.md',
        content: '# Hello',
      };
      mockFileService.openFileDialog.mockResolvedValue(expectedResult);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.OPEN_DIALOG);
      expect(handler).toBeDefined();

      const event = { sender: {} };
      const result = await handler?.(event);

      expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(event.sender);
      expect(mockFileService.openFileDialog).toHaveBeenCalledWith(mockWindow);
      expect(result).toEqual(expectedResult);
    });

    it('should call with undefined when no window found', async () => {
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);

      const expectedResult: FileOpenResult = {
        success: true,
        filePath: '/path/to/file.md',
      };
      mockFileService.openFileDialog.mockResolvedValue(expectedResult);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.OPEN_DIALOG);
      const event = { sender: {} };
      await handler?.(event);

      expect(mockFileService.openFileDialog).toHaveBeenCalledWith(undefined);
    });
  });

  describe('READ handler', () => {
    it('should call fileService.readFile with path', async () => {
      const expectedResult: FileReadResult = {
        success: true,
        content: '# Hello World',
      };
      mockFileService.readFile.mockResolvedValue(expectedResult);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.READ);
      expect(handler).toBeDefined();

      const result = await handler?.({}, '/path/to/file.md');

      expect(mockFileService.readFile).toHaveBeenCalledWith('/path/to/file.md');
      expect(result).toEqual(expectedResult);
    });

    it('should return error result when file read fails', async () => {
      const expectedResult: FileReadResult = {
        success: false,
        error: 'File not found',
      };
      mockFileService.readFile.mockResolvedValue(expectedResult);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.READ);
      const result = await handler?.({}, '/nonexistent/file.md');

      expect(result).toEqual(expectedResult);
    });
  });

  describe('WATCH handler', () => {
    it('should return early when no window found', async () => {
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.WATCH);
      const event = { sender: {} };
      await handler?.(event, '/path/to/file.md');

      expect(mockFileWatcherService.watch).not.toHaveBeenCalled();
    });

    it('should set up file change forwarding', async () => {
      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
        once: vi.fn(),
      };
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as unknown as BrowserWindow);
      mockFileWatcherService.watch.mockResolvedValue(undefined);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.WATCH);
      const event = { sender: {} };
      await handler?.(event, '/path/to/file.md');

      expect(mockFileWatcherService.onFileChange).toHaveBeenCalled();
      expect(mockFileWatcherService.onFileDelete).toHaveBeenCalled();
      expect(mockFileWatcherService.watch).toHaveBeenCalledWith('/path/to/file.md');
    });

    it('should forward file change events to renderer', async () => {
      let changeCallback: FileChangeCallback | undefined;

      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
        once: vi.fn(),
      };
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as unknown as BrowserWindow);
      mockFileWatcherService.onFileChange.mockImplementation((cb: FileChangeCallback) => {
        changeCallback = cb;
        return vi.fn();
      });
      mockFileWatcherService.watch.mockResolvedValue(undefined);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.WATCH);
      await handler?.({ sender: {} }, '/path/to/file.md');

      // Simulate file change
      const changeEvent: FileChangeEvent = {
        filePath: '/path/to/file.md',
        content: '# Updated',
        stats: { size: 100, modifiedAt: new Date(), createdAt: new Date() },
      };
      changeCallback?.(changeEvent);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.FILE.ON_CHANGE,
        changeEvent
      );
    });

    it('should not send to destroyed window', async () => {
      let changeCallback: FileChangeCallback | undefined;

      const mockWindow = {
        isDestroyed: vi.fn(() => true), // Window is destroyed
        webContents: { send: vi.fn() },
        once: vi.fn(),
      };
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as unknown as BrowserWindow);
      mockFileWatcherService.onFileChange.mockImplementation((cb: FileChangeCallback) => {
        changeCallback = cb;
        return vi.fn();
      });
      mockFileWatcherService.watch.mockResolvedValue(undefined);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.WATCH);
      await handler?.({ sender: {} }, '/path/to/file.md');

      // Simulate file change
      const changeEvent: FileChangeEvent = {
        filePath: '/path/to/file.md',
        content: '# Updated',
        stats: { size: 100, modifiedAt: new Date(), createdAt: new Date() },
      };
      changeCallback?.(changeEvent);

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should forward file delete events to renderer', async () => {
      let deleteCallback: FileDeleteCallback | undefined;

      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
        once: vi.fn(),
      };
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as unknown as BrowserWindow);
      mockFileWatcherService.onFileDelete.mockImplementation((cb: FileDeleteCallback) => {
        deleteCallback = cb;
        return vi.fn();
      });
      mockFileWatcherService.watch.mockResolvedValue(undefined);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.WATCH);
      await handler?.({ sender: {} }, '/path/to/file.md');

      // Simulate file delete
      const deleteEvent = { filePath: '/path/to/file.md' };
      deleteCallback?.(deleteEvent);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.FILE.ON_DELETE,
        deleteEvent
      );
    });

    it('should cleanup subscriptions when window closes', async () => {
      const unsubscribeChange = vi.fn();
      const unsubscribeDelete = vi.fn();
      let closeCallback: (() => void) | undefined;

      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
        once: vi.fn((_event: string, cb: () => void) => {
          closeCallback = cb;
        }),
      };
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as unknown as BrowserWindow);
      mockFileWatcherService.onFileChange.mockReturnValue(unsubscribeChange);
      mockFileWatcherService.onFileDelete.mockReturnValue(unsubscribeDelete);
      mockFileWatcherService.watch.mockResolvedValue(undefined);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.WATCH);
      await handler?.({ sender: {} }, '/path/to/file.md');

      expect(mockWindow.once).toHaveBeenCalledWith('closed', expect.any(Function));

      // Simulate window close
      closeCallback?.();

      expect(unsubscribeChange).toHaveBeenCalled();
      expect(unsubscribeDelete).toHaveBeenCalled();
    });
  });

  describe('UNWATCH handler', () => {
    it('should call fileWatcherService.unwatch', async () => {
      mockFileWatcherService.unwatch.mockResolvedValue(undefined);

      registerFileHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.UNWATCH);
      expect(handler).toBeDefined();

      await handler?.({}, '/path/to/file.md');

      expect(mockFileWatcherService.unwatch).toHaveBeenCalled();
    });
  });
});
