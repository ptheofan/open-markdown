/**
 * ThemeHandler unit tests
 *
 * GET_CURRENT and SET now delegate to PreferencesService.
 * GET_SYSTEM and ON_SYSTEM_CHANGE still use ThemeService.
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  registerThemeHandlers,
  unregisterThemeHandlers,
} from '@main/ipc/handlers/ThemeHandler';
import { IPC_CHANNELS } from '@shared/types/api';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ThemeService } from '@main/services/ThemeService';
import type { PreferencesService } from '@main/services/PreferencesService';
import type { ThemeMode, ResolvedTheme, ThemeChangeEvent, AppPreferences } from '@shared/types';

interface MockThemeService {
  getSystemTheme: ReturnType<typeof vi.fn>;
  onSystemThemeChange: ReturnType<typeof vi.fn>;
  _triggerSystemThemeChange: (theme: ResolvedTheme) => void;
}

interface MockPreferencesService {
  getPreferences: ReturnType<typeof vi.fn>;
  updatePreferences: ReturnType<typeof vi.fn>;
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

// Create mock ThemeService (system detection only)
function createMockThemeService(): MockThemeService {
  let systemThemeChangeCallback: ((theme: ResolvedTheme) => void) | null = null;

  return {
    getSystemTheme: vi.fn((): ResolvedTheme => 'light'),
    onSystemThemeChange: vi.fn((callback: (theme: ResolvedTheme) => void) => {
      systemThemeChangeCallback = callback;
      return () => {
        systemThemeChangeCallback = null;
      };
    }),
    _triggerSystemThemeChange: (theme: ResolvedTheme) => {
      systemThemeChangeCallback?.(theme);
    },
  };
}

// Create mock PreferencesService
function createMockPreferencesService(initialMode: ThemeMode = 'system'): MockPreferencesService {
  let currentMode: ThemeMode = initialMode;

  return {
    getPreferences: vi.fn((): AppPreferences => ({
      version: 1,
      core: {
        theme: { mode: currentMode, background: { light: '#fff', dark: '#000' } },
        typography: {} as AppPreferences['core']['typography'],
        lists: {} as AppPreferences['core']['lists'],
        editor: { autoSave: true, autoSaveDelay: 1000 },
        externalEditor: { editor: 'none', customCommand: '' },
      },
      plugins: {},
    })),
    updatePreferences: vi.fn((updates: { core?: { theme?: { mode?: ThemeMode } } }) => {
      if (updates.core?.theme?.mode) {
        currentMode = updates.core.theme.mode;
      }
      return Promise.resolve();
    }),
  };
}

type MockIpcMain = typeof ipcMain & {
  _getHandler: (channel: string) => ((...args: unknown[]) => unknown) | undefined;
  _clearHandlers: () => void;
};

describe('ThemeHandler', () => {
  let mockThemeService: MockThemeService;
  let mockPreferencesService: MockPreferencesService;
  const mockIpcMain = ipcMain as MockIpcMain;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain._clearHandlers();
    mockThemeService = createMockThemeService();
    mockPreferencesService = createMockPreferencesService();
  });

  afterEach(() => {
    unregisterThemeHandlers();
  });

  describe('registerThemeHandlers', () => {
    it('should register all theme IPC handlers', () => {
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

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
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

      expect(mockThemeService.onSystemThemeChange).toHaveBeenCalled();
    });
  });

  describe('unregisterThemeHandlers', () => {
    it('should remove all theme IPC handlers', () => {
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );
      unregisterThemeHandlers();

      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.THEME.GET_CURRENT);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.THEME.SET);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.THEME.GET_SYSTEM);
    });

    it('should cleanup system theme change subscription', () => {
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );
      expect(() => unregisterThemeHandlers()).not.toThrow();
    });
  });

  describe('GET_CURRENT handler', () => {
    it('should return theme mode from PreferencesService', () => {
      mockPreferencesService = createMockPreferencesService('dark');
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.GET_CURRENT);
      expect(handler).toBeDefined();

      const result = handler?.();
      expect(mockPreferencesService.getPreferences).toHaveBeenCalled();
      expect(result).toBe('dark');
    });

    it('should return system when that is the preference', () => {
      mockPreferencesService = createMockPreferencesService('system');
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.GET_CURRENT);
      const result = handler?.();

      expect(result).toBe('system');
    });
  });

  describe('SET handler', () => {
    it('should set light theme via PreferencesService', async () => {
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.SET);
      expect(handler).toBeDefined();

      await handler?.({}, 'light');
      expect(mockPreferencesService.updatePreferences).toHaveBeenCalledWith({
        core: { theme: { mode: 'light' } },
      });
    });

    it('should set dark theme via PreferencesService', async () => {
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.SET);
      await handler?.({}, 'dark');

      expect(mockPreferencesService.updatePreferences).toHaveBeenCalledWith({
        core: { theme: { mode: 'dark' } },
      });
    });

    it('should set system theme via PreferencesService', async () => {
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.SET);
      await handler?.({}, 'system');

      expect(mockPreferencesService.updatePreferences).toHaveBeenCalledWith({
        core: { theme: { mode: 'system' } },
      });
    });
  });

  describe('GET_SYSTEM handler', () => {
    it('should return system theme from ThemeService', () => {
      vi.mocked(mockThemeService.getSystemTheme).mockReturnValue('dark');
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.THEME.GET_SYSTEM);
      expect(handler).toBeDefined();

      const result = handler?.();
      expect(mockThemeService.getSystemTheme).toHaveBeenCalled();
      expect(result).toBe('dark');
    });

    it('should return light when system uses light colors', () => {
      vi.mocked(mockThemeService.getSystemTheme).mockReturnValue('light');
      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

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

      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

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

      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );
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

      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );
      mockThemeService._triggerSystemThemeChange('dark');

      expect(activeWindow.webContents.send).toHaveBeenCalled();
      expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should handle no windows gracefully', () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);

      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );

      expect(() => mockThemeService._triggerSystemThemeChange('dark')).not.toThrow();
    });

    it('should include isSystemChange flag in event', () => {
      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
      };
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow as unknown as BrowserWindow]);

      registerThemeHandlers(
        mockThemeService as unknown as ThemeService,
        mockPreferencesService as unknown as PreferencesService
      );
      mockThemeService._triggerSystemThemeChange('light');

      const [, event] = mockWindow.webContents.send.mock.calls[0] as [string, ThemeChangeEvent];
      expect(event.isSystemChange).toBe(true);
    });
  });
});
