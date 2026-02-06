/**
 * WindowHandler unit tests
 */
import { ipcMain, BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '@shared/types/api';
import {
  registerWindowHandlers,
  unregisterWindowHandlers,
} from '@main/ipc/handlers/WindowHandler';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Mock WindowManager
const mockWindowManager = {
  createWindow: vi.fn(),
};

vi.mock('@main/window/WindowManager', () => ({
  getWindowManager: () => mockWindowManager,
}));

type MockIpcMain = typeof ipcMain & {
  _getHandler: (channel: string) => ((...args: unknown[]) => unknown) | undefined;
  _clearHandlers: () => void;
};

describe('WindowHandler', () => {
  const mockIpcMain = ipcMain as MockIpcMain;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain._clearHandlers();
  });

  afterEach(() => {
    unregisterWindowHandlers();
  });

  describe('registerWindowHandlers', () => {
    it('should register all window IPC handlers', () => {
      registerWindowHandlers();

      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.GET_FULLSCREEN,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.OPEN_NEW,
        expect.any(Function)
      );
    });
  });

  describe('unregisterWindowHandlers', () => {
    it('should remove all window IPC handlers', () => {
      registerWindowHandlers();
      unregisterWindowHandlers();

      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW.GET_FULLSCREEN);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW.OPEN_NEW);
    });
  });

  describe('GET_FULLSCREEN handler', () => {
    it('should return fullscreen state from the requesting window', () => {
      const mockWindow = {
        isFullScreen: vi.fn(() => true),
      };
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(
        mockWindow as unknown as BrowserWindow
      );

      registerWindowHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.WINDOW.GET_FULLSCREEN);
      expect(handler).toBeDefined();

      const event = { sender: {} };
      const result = handler?.(event);

      expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(event.sender);
      expect(mockWindow.isFullScreen).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when no window found', () => {
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);

      registerWindowHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.WINDOW.GET_FULLSCREEN);
      const event = { sender: {} };
      const result = handler?.(event);

      expect(result).toBe(false);
    });

    it('should return false when window is not fullscreen', () => {
      const mockWindow = {
        isFullScreen: vi.fn(() => false),
      };
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(
        mockWindow as unknown as BrowserWindow
      );

      registerWindowHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.WINDOW.GET_FULLSCREEN);
      const event = { sender: {} };
      const result = handler?.(event);

      expect(result).toBe(false);
    });
  });

  describe('OPEN_NEW handler', () => {
    it('should create a new window via WindowManager', () => {
      registerWindowHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.WINDOW.OPEN_NEW);
      expect(handler).toBeDefined();

      handler?.();

      expect(mockWindowManager.createWindow).toHaveBeenCalled();
    });
  });
});
