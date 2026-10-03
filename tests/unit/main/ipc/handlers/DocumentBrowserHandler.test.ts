/**
 * DocumentBrowserHandler unit tests
 */
import { ipcMain, BrowserWindow } from 'electron';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { IPC_CHANNELS } from '@shared/types/api';
import {
  registerDocumentBrowserHandlers,
  unregisterDocumentBrowserHandlers,
} from '@main/ipc/handlers/DocumentBrowserHandler';
import type { DocumentBrowserService } from '@main/services/DocumentBrowserService';

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

const mockWindowManager = {
  getWindow: vi.fn(),
  focusWindow: vi.fn(),
  openFile: vi.fn(),
  getAllWindows: vi.fn(() => []),
  getWindowFilePath: vi.fn(() => null),
};

vi.mock('@main/window/WindowManager', () => ({
  getWindowManager: () => mockWindowManager,
}));

vi.mock('@main/services/RecentFilesService', () => ({
  getRecentFilesService: () => ({ getRecentFiles: () => [] }),
}));

type MockIpcMain = typeof ipcMain & {
  _getHandler: (channel: string) => ((...args: unknown[]) => unknown) | undefined;
  _clearHandlers: () => void;
};

describe('DocumentBrowserHandler', () => {
  const mockIpcMain = ipcMain as MockIpcMain;
  const service = {
    buildSnapshot: vi.fn(() => Promise.resolve({ open: [], recent: [] })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain._clearHandlers();
  });

  afterEach(() => {
    unregisterDocumentBrowserHandlers();
  });

  it('should register and unregister every channel', () => {
    registerDocumentBrowserHandlers(service as unknown as DocumentBrowserService);

    for (const channel of [
      IPC_CHANNELS.DOCUMENT_BROWSER.GET_SNAPSHOT,
      IPC_CHANNELS.DOCUMENT_BROWSER.FOCUS_WINDOW,
      IPC_CHANNELS.DOCUMENT_BROWSER.OPEN_FILE,
    ]) {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    }

    unregisterDocumentBrowserHandlers();

    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.DOCUMENT_BROWSER.GET_SNAPSHOT);
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.DOCUMENT_BROWSER.FOCUS_WINDOW);
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.DOCUMENT_BROWSER.OPEN_FILE);
  });

  it('should build a snapshot from the requesting window', async () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 7 } as unknown as BrowserWindow);
    registerDocumentBrowserHandlers(service as unknown as DocumentBrowserService);

    const handler = mockIpcMain._getHandler(IPC_CHANNELS.DOCUMENT_BROWSER.GET_SNAPSHOT);
    const result = await handler?.({ sender: {} });

    expect(service.buildSnapshot).toHaveBeenCalledWith(7);
    expect(result).toEqual({ open: [], recent: [] });
  });

  it('should build a snapshot with no current window when the sender is unknown', async () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);
    registerDocumentBrowserHandlers(service as unknown as DocumentBrowserService);

    const handler = mockIpcMain._getHandler(IPC_CHANNELS.DOCUMENT_BROWSER.GET_SNAPSHOT);
    await handler?.({ sender: {} });

    expect(service.buildSnapshot).toHaveBeenCalledWith(null);
  });

  it('should focus the window asked for', () => {
    const win = { id: 3 };
    mockWindowManager.getWindow.mockReturnValue(win);
    registerDocumentBrowserHandlers(service as unknown as DocumentBrowserService);

    const handler = mockIpcMain._getHandler(IPC_CHANNELS.DOCUMENT_BROWSER.FOCUS_WINDOW);
    handler?.({}, 3);

    expect(mockWindowManager.getWindow).toHaveBeenCalledWith(3);
    expect(mockWindowManager.focusWindow).toHaveBeenCalledWith(win);
  });

  it('should ignore a focus request for a window that no longer exists', () => {
    mockWindowManager.getWindow.mockReturnValue(undefined);
    registerDocumentBrowserHandlers(service as unknown as DocumentBrowserService);

    const handler = mockIpcMain._getHandler(IPC_CHANNELS.DOCUMENT_BROWSER.FOCUS_WINDOW);
    handler?.({}, 99);

    expect(mockWindowManager.focusWindow).not.toHaveBeenCalled();
  });

  it('should route a file open through the window manager', () => {
    registerDocumentBrowserHandlers(service as unknown as DocumentBrowserService);

    const handler = mockIpcMain._getHandler(IPC_CHANNELS.DOCUMENT_BROWSER.OPEN_FILE);
    handler?.({}, '/docs/a.md');

    expect(mockWindowManager.openFile).toHaveBeenCalledWith('/docs/a.md');
  });

  it('should build its own service from the window manager and recent files when none is given', async () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);
    registerDocumentBrowserHandlers();

    const handler = mockIpcMain._getHandler(IPC_CHANNELS.DOCUMENT_BROWSER.GET_SNAPSHOT);
    const result = await handler?.({ sender: {} });

    expect(mockWindowManager.getAllWindows).toHaveBeenCalled();
    expect(result).toEqual({ open: [], recent: [] });
  });
});
