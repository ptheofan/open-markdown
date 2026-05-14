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
        isMaximized: vi.fn(() => false),
        maximize: vi.fn(),
        restore: vi.fn(),
        focus: vi.fn(),
        setTitle: vi.fn(),
        getNormalBounds: vi.fn(() => ({ x: 100, y: 120, width: 1024, height: 768 })),
        getBounds: vi.fn(() => ({ x: 100, y: 120, width: 1024, height: 768 })),
        _handlers: handlers,
        _simulateEvent: (event: string, ...args: unknown[]) => {
          handlers[event]?.forEach(cb => cb(...args));
        },
      };
    }),
    screen: {
      getAllDisplays: vi.fn(() => [
        { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      ]),
    },
    app: {
      isPackaged: false,
    },
  };
});

interface FakePreferencesService {
  getPreferences: ReturnType<typeof vi.fn>;
  updatePreferences: ReturnType<typeof vi.fn>;
}

function createFakePreferencesService(
  windowState: Record<string, unknown> = { width: 900, height: 700, isMaximized: false }
): FakePreferencesService {
  return {
    getPreferences: vi.fn(() => ({ windowState })),
    updatePreferences: vi.fn().mockResolvedValue(undefined),
  };
}

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

  describe('window state persistence', () => {
    it('should create the window with the saved size and position', () => {
      const prefs = createFakePreferencesService({
        width: 1280,
        height: 800,
        x: 200,
        y: 150,
        isMaximized: false,
      });
      const stateManager = new WindowManager(prefs as never);

      stateManager.createWindow();

      expect(BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1280, height: 800, x: 200, y: 150 })
      );
      stateManager.destroy();
    });

    it('should drop an off-screen saved position but keep the size', () => {
      const prefs = createFakePreferencesService({
        width: 1280,
        height: 800,
        x: 5000,
        y: 5000,
        isMaximized: false,
      });
      const stateManager = new WindowManager(prefs as never);

      stateManager.createWindow();

      expect(BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1280, height: 800, x: undefined, y: undefined })
      );
      stateManager.destroy();
    });

    it('should maximize the window when the saved state is maximized', () => {
      const prefs = createFakePreferencesService({
        width: 900,
        height: 700,
        isMaximized: true,
      });
      const stateManager = new WindowManager(prefs as never);

      const win = stateManager.createWindow();

      expect(win.maximize).toHaveBeenCalled();
      stateManager.destroy();
    });

    it('should persist window state on close', () => {
      const prefs = createFakePreferencesService();
      const stateManager = new WindowManager(prefs as never);

      const win = stateManager.createWindow();
      (win as unknown as { _simulateEvent: (event: string) => void })._simulateEvent('close');

      expect(prefs.updatePreferences).toHaveBeenCalledWith({
        windowState: {
          x: 100,
          y: 120,
          width: 1024,
          height: 768,
          isMaximized: false,
        },
      });
      stateManager.destroy();
    });

    it('should persist window state on maximize', () => {
      const prefs = createFakePreferencesService();
      const stateManager = new WindowManager(prefs as never);

      const win = stateManager.createWindow();
      (win as unknown as { _simulateEvent: (event: string) => void })._simulateEvent('maximize');

      expect(prefs.updatePreferences).toHaveBeenCalled();
      stateManager.destroy();
    });

    it('should not touch preferences when no service is provided', () => {
      const win = manager.createWindow();
      expect(() => {
        (win as unknown as { _simulateEvent: (event: string) => void })._simulateEvent('close');
      }).not.toThrow();
    });
  });
});
