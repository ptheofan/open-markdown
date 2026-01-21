/**
 * ThemeHandler unit tests
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  registerThemeHandlers,
  unregisterThemeHandlers,
} from '@main/ipc/handlers/ThemeHandler';
import { IPC_CHANNELS } from '@shared/types/api';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ThemeService } from '@main/services/ThemeService';
import type { ThemeMode, ResolvedTheme, ThemeChangeEvent } from '@shared/types';

interface MockThemeService {
  getCurrentTheme: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  getSystemTheme: ReturnType<typeof vi.fn>;
  onSystemThemeChange: ReturnType<typeof vi.fn>;
  _triggerSystemThemeChange: (theme: ResolvedTheme) => void;
  _setCurrentTheme: (theme: ThemeMode) => void;
  _setSystemTheme: (theme: ResolvedTheme) => void;
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

// Create mock ThemeService
function createMockThemeService(): MockThemeService {
  let currentTheme: ThemeMode = 'system';
  let systemThemeChangeCallback: ((theme: ResolvedTheme) => void) | null = null;

  return {
    getCurrentTheme: vi.fn(() => currentTheme),
    setTheme: vi.fn((theme: ThemeMode) => {
      currentTheme = theme;
      return Promise.resolve();
    }),
    getSystemTheme: vi.fn((): ResolvedTheme => 'light'),
    onSystemThemeChange: vi.fn((callback: (theme: ResolvedTheme) => void) => {
      systemThemeChangeCallback = callback;
      return () => {
        systemThemeChangeCallback = null;
      };
    }),
    // Test helper to simulate system theme change
    _triggerSystemThemeChange: (theme: ResolvedTheme) => {
      systemThemeChangeCallback?.(theme);
    },
    _setCurrentTheme: (theme: ThemeMode) => {
      currentTheme = theme;
    },
    _setSystemTheme: (theme: ResolvedTheme) => {
      vi.mocked(createMockThemeService().getSystemTheme).mockReturnValue(theme);
    },
  };
}

type MockIpcMain = typeof ipcMain & {
  _getHandler: (channel: string) => ((...args: unknown[]) => unknown) | undefined;
  _clearHandlers: () => void;
};

describe('ThemeHandler', () => {
  let mockThemeService: ReturnType<typeof createMockThemeService>;
  const mockIpcMain = ipcMain as MockIpcMain;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain._clearHandlers();
    mockThemeService = createMockThemeService();
  });

  afterEach(() => {
    unregisterThemeHandlers();
  });

  describe('registerThemeHandlers', () => {
    it('should register all theme IPC handlers', () => {
      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.THEME.GET_CURRENT,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.THEME.SET,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.THEME.GET_SYSTEM,
        expect.any(Function)
      );
    });

    it('should subscribe to system theme changes', () => {
      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      expect(mockThemeService.onSystemThemeChange).toHaveBeenCalled();
    });
  });

  describe('unregisterThemeHandlers', () => {
    it('should remove all theme IPC handlers', () => {
      registerThemeHandlers(mockThemeService as unknown as ThemeService);
      unregisterThemeHandlers();

      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.THEME.GET_CURRENT);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.THEME.SET);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.THEME.GET_SYSTEM);
    });

    it('should cleanup system theme change subscription', () => {
      // The cleanup happens when unregister is called
      // We just verify no errors occur
      registerThemeHandlers(mockThemeService as unknown as ThemeService);
      expect(() => unregisterThemeHandlers()).not.toThrow();
    });
  });

  describe('GET_CURRENT handler', () => {
    it('should return current theme from service', () => {
      mockThemeService._setCurrentTheme('dark');
      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.GET_CURRENT);
      expect(handler).toBeDefined();

      const result = handler?.();
      expect(mockThemeService.getCurrentTheme).toHaveBeenCalled();
      expect(result).toBe('dark');
    });

    it('should return system when that is the preference', () => {
      mockThemeService._setCurrentTheme('system');
      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.GET_CURRENT);
      const result = handler?.();

      expect(result).toBe('system');
    });
  });

  describe('SET handler', () => {
    it('should set light theme', async () => {
      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.SET);
      expect(handler).toBeDefined();

      await handler?.({}, 'light');
      expect(mockThemeService.setTheme).toHaveBeenCalledWith('light');
    });

    it('should set dark theme', async () => {
      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.SET);
      await handler?.({}, 'dark');

      expect(mockThemeService.setTheme).toHaveBeenCalledWith('dark');
    });

    it('should set system theme', async () => {
      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.SET);
      await handler?.({}, 'system');

      expect(mockThemeService.setTheme).toHaveBeenCalledWith('system');
    });
  });

  describe('GET_SYSTEM handler', () => {
    it('should return system theme from service', () => {
      vi.mocked(mockThemeService.getSystemTheme).mockReturnValue('dark');
      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.GET_SYSTEM);
      expect(handler).toBeDefined();

      const result = handler?.();
      expect(mockThemeService.getSystemTheme).toHaveBeenCalled();
      expect(result).toBe('dark');
    });

    it('should return light when system uses light colors', () => {
      vi.mocked(mockThemeService.getSystemTheme).mockReturnValue('light');
      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.GET_SYSTEM);
      const result = handler?.();

      expect(result).toBe('light');
    });
  });

  describe('system theme change events', () => {
    it('should send theme change event to all windows', () => {
      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: {
          send: vi.fn(),
        },
      };
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow as unknown as BrowserWindow]);

      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      // Trigger system theme change
      mockThemeService._triggerSystemThemeChange('dark');

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.THEME.ON_SYSTEM_CHANGE,
        expect.objectContaining({
          theme: 'dark',
          isSystemChange: true,
        })
      );
    });

    it('should send to multiple windows', () => {
      const mockWindow1 = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
      };
      const mockWindow2 = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
      };
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        mockWindow1 as unknown as BrowserWindow,
        mockWindow2 as unknown as BrowserWindow,
      ]);

      registerThemeHandlers(mockThemeService as unknown as ThemeService);
      mockThemeService._triggerSystemThemeChange('light');

      expect(mockWindow1.webContents.send).toHaveBeenCalled();
      expect(mockWindow2.webContents.send).toHaveBeenCalled();
    });

    it('should skip destroyed windows', () => {
      const activeWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
      };
      const destroyedWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: { send: vi.fn() },
      };
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        activeWindow as unknown as BrowserWindow,
        destroyedWindow as unknown as BrowserWindow,
      ]);

      registerThemeHandlers(mockThemeService as unknown as ThemeService);
      mockThemeService._triggerSystemThemeChange('dark');

      expect(activeWindow.webContents.send).toHaveBeenCalled();
      expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should handle no windows gracefully', () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);

      registerThemeHandlers(mockThemeService as unknown as ThemeService);

      // Should not throw
      expect(() => mockThemeService._triggerSystemThemeChange('dark')).not.toThrow();
    });

    it('should include isSystemChange flag in event', () => {
      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
      };
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow as unknown as BrowserWindow]);

      registerThemeHandlers(mockThemeService as unknown as ThemeService);
      mockThemeService._triggerSystemThemeChange('light');

      const [, event] = mockWindow.webContents.send.mock.calls[0] as [string, ThemeChangeEvent];
      expect(event.isSystemChange).toBe(true);
    });
  });
});
