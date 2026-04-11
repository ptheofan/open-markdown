/**
 * ShellHandler unit tests
 */
import { ipcMain, shell } from 'electron';
import { spawn } from 'child_process';

import { IPC_CHANNELS } from '@shared/types/api';
import {
  registerShellHandlers,
  unregisterShellHandlers,
} from '@main/ipc/handlers/ShellHandler';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AppPreferences, ExternalEditorId } from '@shared/types';
import type { OpenInEditorResult } from '@shared/types/api';

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
    shell: {
      showItemInFolder: vi.fn(),
    },
  };
});

// Mock child_process
const mockUnref = vi.fn();
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    unref: mockUnref,
  })),
}));

// Mock PreferencesService
function createMockPreferences(
  editor: ExternalEditorId = 'none',
  customCommand = ''
): AppPreferences {
  return {
    version: 1,
    core: {
      theme: { mode: 'system', background: { light: '#fff', dark: '#000' } },
      typography: {} as AppPreferences['core']['typography'],
      lists: {} as AppPreferences['core']['lists'],
      editor: { autoSave: true, autoSaveDelay: 1000 },
      externalEditor: { editor, customCommand },
    },
    plugins: {},
  };
}

const mockPreferencesService = {
  getPreferences: vi.fn(() => createMockPreferences()),
};

vi.mock('@main/services/PreferencesService', () => ({
  getPreferencesService: () => mockPreferencesService,
}));

type MockIpcMain = typeof ipcMain & {
  _getHandler: (channel: string) => ((...args: unknown[]) => unknown) | undefined;
  _clearHandlers: () => void;
};

describe('ShellHandler', () => {
  const mockIpcMain = ipcMain as MockIpcMain;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain._clearHandlers();
    mockPreferencesService.getPreferences.mockReturnValue(createMockPreferences());
  });

  afterEach(() => {
    unregisterShellHandlers();
  });

  describe('registerShellHandlers', () => {
    it('should register both shell IPC handlers', () => {
      registerShellHandlers();

      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SHELL.REVEAL_IN_FILE_MANAGER,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SHELL.OPEN_IN_EDITOR,
        expect.any(Function)
      );
    });
  });

  describe('unregisterShellHandlers', () => {
    it('should remove both shell IPC handlers', () => {
      registerShellHandlers();
      unregisterShellHandlers();

      expect(ipcMain.removeHandler).toHaveBeenCalledWith(
        IPC_CHANNELS.SHELL.REVEAL_IN_FILE_MANAGER
      );
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(
        IPC_CHANNELS.SHELL.OPEN_IN_EDITOR
      );
    });
  });

  describe('REVEAL_IN_FILE_MANAGER handler', () => {
    it('should call shell.showItemInFolder with the file path', () => {
      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.REVEAL_IN_FILE_MANAGER);
      expect(handler).toBeDefined();

      handler?.({}, '/path/to/file.md');

      expect(shell.showItemInFolder).toHaveBeenCalledWith('/path/to/file.md');
    });

    it('should handle paths with spaces', () => {
      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.REVEAL_IN_FILE_MANAGER);
      handler?.({}, '/path/to/my documents/file.md');

      expect(shell.showItemInFolder).toHaveBeenCalledWith('/path/to/my documents/file.md');
    });
  });

  describe('OPEN_IN_EDITOR handler', () => {
    it('should return error when editor is "none"', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('none')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/path/to/file.md') as OpenInEditorResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('No external editor configured');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should spawn "code" for vscode preset', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('vscode')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/path/to/file.md') as OpenInEditorResult;

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith('code', ['/path/to/file.md'], {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
      expect(mockUnref).toHaveBeenCalled();
    });

    it('should spawn "cursor" for cursor preset', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('cursor')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/test.md') as OpenInEditorResult;

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith('cursor', ['/test.md'], expect.any(Object));
    });

    it('should spawn "webstorm" for webstorm preset', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('webstorm')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/test.md') as OpenInEditorResult;

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith('webstorm', ['/test.md'], expect.any(Object));
    });

    it('should spawn "subl" for sublime preset', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('sublime')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/test.md') as OpenInEditorResult;

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith('subl', ['/test.md'], expect.any(Object));
    });

    it('should spawn "zed" for zed preset', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('zed')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/test.md') as OpenInEditorResult;

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith('zed', ['/test.md'], expect.any(Object));
    });

    it('should use custom command when editor is "custom"', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('custom', 'my-editor')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/path/to/file.md') as OpenInEditorResult;

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith('my-editor', ['/path/to/file.md'], {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
    });

    it('should return error when custom command is empty', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('custom', '')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/path/to/file.md') as OpenInEditorResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('No custom editor command configured');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should return error when custom command is only whitespace', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('custom', '   ')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/path/to/file.md') as OpenInEditorResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('No custom editor command configured');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should trim whitespace from custom command', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('custom', '  nvim  ')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/test.md') as OpenInEditorResult;

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith('nvim', ['/test.md'], expect.any(Object));
    });

    it('should return error when spawn throws', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('vscode')
      );
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('ENOENT: command not found');
      });

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/path/to/file.md') as OpenInEditorResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('ENOENT: command not found');
    });

    it('should return generic message for non-Error throw', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('vscode')
      );
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw 'something unexpected';
      });

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/path/to/file.md') as OpenInEditorResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to launch editor');
    });

    it('should always call unref on the spawned process', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('vscode')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      handler?.({}, '/path/to/file.md');

      expect(mockUnref).toHaveBeenCalledTimes(1);
    });

    it('should read preferences fresh on each call', () => {
      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);

      // First call: vscode
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('vscode')
      );
      handler?.({}, '/file1.md');
      expect(spawn).toHaveBeenLastCalledWith('code', ['/file1.md'], expect.any(Object));

      // Second call: changed to sublime
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('sublime')
      );
      handler?.({}, '/file2.md');
      expect(spawn).toHaveBeenLastCalledWith('subl', ['/file2.md'], expect.any(Object));

      expect(mockPreferencesService.getPreferences).toHaveBeenCalledTimes(2);
    });

    it('should handle file paths with special characters', () => {
      mockPreferencesService.getPreferences.mockReturnValue(
        createMockPreferences('vscode')
      );

      registerShellHandlers();

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
      const result = handler?.({}, '/path/to/my file (1).md') as OpenInEditorResult;

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        'code',
        ['/path/to/my file (1).md'],
        expect.any(Object)
      );
    });
  });
});
