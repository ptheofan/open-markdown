/**
 * WindowManager unit tests
 */
import { BrowserWindow } from 'electron';
import { WindowManager } from '@main/window/WindowManager';
import { IPC_CHANNELS } from '@shared/types/api';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron
vi.mock('electron', () => {
  let nextId = 1;
  return {
    BrowserWindow: vi.fn().mockImplementation(() => {
      const id = nextId++;
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        id,
        webContents: {
          send: vi.fn(),
          once: vi.fn(),
          openDevTools: vi.fn(),
        },
        loadURL: vi.fn().mockResolvedValue(undefined),
        loadFile: vi.fn().mockResolvedValue(undefined),
        once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(cb);
        }),
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(cb);
        }),
        show: vi.fn(),
        isDestroyed: vi.fn(() => false),
        isMinimized: vi.fn(() => false),
        isFullScreen: vi.fn(() => false),
        restore: vi.fn(),
        focus: vi.fn(),
        setTitle: vi.fn(),
        _handlers: handlers,
        _simulateEvent: (event: string, ...args: unknown[]) => {
          handlers[event]?.forEach(cb => cb(...args));
        },
      };
    }),
    app: {
      isPackaged: false,
    },
  };
});

describe('WindowManager', () => {
  let manager: WindowManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WindowManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('createWindow', () => {
    it('should create a new BrowserWindow', () => {
      const win = manager.createWindow();
      expect(win).toBeDefined();
      expect(BrowserWindow).toHaveBeenCalled();
    });

    it('should track created window by id', () => {
      const win = manager.createWindow();
      expect(manager.getWindow(win.id)).toBe(win);
    });

    it('should support multiple windows', () => {
      const win1 = manager.createWindow();
      const win2 = manager.createWindow();
      expect(win1.id).not.toBe(win2.id);
      expect(manager.getAllWindows()).toHaveLength(2);
    });

    it('should remove window from tracking on close', () => {
      const win = manager.createWindow();
      const id = win.id;
      (win as unknown as { _simulateEvent: (event: string) => void })._simulateEvent('closed');
      expect(manager.getWindow(id)).toBeUndefined();
    });
  });

  describe('getWindow', () => {
    it('should return undefined for unknown id', () => {
      expect(manager.getWindow(999)).toBeUndefined();
    });
  });

  describe('getAllWindows', () => {
    it('should return empty array when no windows', () => {
      expect(manager.getAllWindows()).toEqual([]);
    });

    it('should return all tracked windows', () => {
      manager.createWindow();
      manager.createWindow();
      expect(manager.getAllWindows()).toHaveLength(2);
    });
  });

  describe('getWindowByFilePath', () => {
    it('should return undefined when no window has the file', () => {
      manager.createWindow();
      expect(manager.getWindowByFilePath('/some/file.md')).toBeUndefined();
    });

    it('should return window with matching file path', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/test/file.md');
      expect(manager.getWindowByFilePath('/test/file.md')).toBe(win);
    });
  });

  describe('setWindowFilePath', () => {
    it('should associate a file path with a window', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/test/file.md');
      expect(manager.getWindowFilePath(win.id)).toBe('/test/file.md');
    });

    it('should clear association when set to null', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/test/file.md');
      manager.setWindowFilePath(win.id, null);
      expect(manager.getWindowFilePath(win.id)).toBeNull();
    });

    it('should set window title when file path is set', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/path/to/README.md');
      expect(win.setTitle).toHaveBeenCalledWith('README.md');
    });

    it('should set default title when file path is cleared', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/path/to/README.md');
      manager.setWindowFilePath(win.id, null);
      expect(win.setTitle).toHaveBeenCalledWith('Open Markdown');
    });
  });

  describe('getEmptyWindow', () => {
    it('should return a window with no file loaded', () => {
      const win = manager.createWindow();
      expect(manager.getEmptyWindow()).toBe(win);
    });

    it('should return undefined when all windows have files', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/test/file.md');
      expect(manager.getEmptyWindow()).toBeUndefined();
    });
  });

  describe('fullscreen event forwarding', () => {
    it('should send fullscreen change event on enter-full-screen', () => {
      const win = manager.createWindow();
      const simulateEvent = (win as unknown as { _simulateEvent: (event: string, ...args: unknown[]) => void })._simulateEvent;

      simulateEvent('enter-full-screen');

      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE,
        { isFullscreen: true }
      );
    });

    it('should send fullscreen change event on leave-full-screen', () => {
      const win = manager.createWindow();
      const simulateEvent = (win as unknown as { _simulateEvent: (event: string, ...args: unknown[]) => void })._simulateEvent;

      simulateEvent('leave-full-screen');

      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE,
        { isFullscreen: false }
      );
    });
  });

  describe('destroy', () => {
    it('should clear all tracked windows', () => {
      manager.createWindow();
      manager.createWindow();
      manager.destroy();
      expect(manager.getAllWindows()).toEqual([]);
    });
  });
});
