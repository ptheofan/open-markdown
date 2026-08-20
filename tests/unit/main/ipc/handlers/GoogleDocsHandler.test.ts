import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

const mocks = vi.hoisted(() => ({
  authService: {
    getAuthState: vi.fn().mockReturnValue({ isAuthenticated: false }),
    signIn: vi.fn(),
    signOut: vi.fn(),
    getAccessToken: vi.fn(),
    pickDocument: vi.fn(),
  },
  linkStore: {
    getLink: vi.fn(),
    setLink: vi.fn(),
    removeLink: vi.fn(),
    loadBaseline: vi.fn(),
    saveBaseline: vi.fn(),
    updateLastSynced: vi.fn(),
    initialize: vi.fn(),
    deleteBaseline: vi.fn(),
  },
}));

vi.mock('@main/services/GoogleAuthService', () => ({
  getGoogleAuthService: () => mocks.authService,
}));

vi.mock('@main/services/GoogleDocsLinkStore', () => ({
  getGoogleDocsLinkStore: () => mocks.linkStore,
}));

vi.mock('@main/services/GoogleDocsService', () => ({
  createGoogleDocsService: () => ({
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  }),
}));

vi.mock('@main/services/GoogleDocsSyncService', () => ({
  createGoogleDocsSyncService: () => ({
    sync: vi.fn(),
    syncForceOverwrite: vi.fn(),
  }),
}));

import { ipcMain } from 'electron';
import {
  registerGoogleDocsHandlers,
  unregisterGoogleDocsHandlers,
} from '@main/ipc/handlers/GoogleDocsHandler';

describe('GoogleDocsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register all Google Docs IPC handlers', () => {
    registerGoogleDocsHandlers();
    const handleCalls = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(handleCalls).toContain('google-docs:auth-status');
    expect(handleCalls).toContain('google-docs:auth-sign-in');
    expect(handleCalls).toContain('google-docs:auth-sign-out');
    expect(handleCalls).toContain('google-docs:pick-and-link');
    expect(handleCalls).not.toContain('google-docs:link');
    expect(handleCalls).toContain('google-docs:unlink');
    expect(handleCalls).toContain('google-docs:get-link');
    expect(handleCalls).toContain('google-docs:sync');
    expect(handleCalls).toContain('google-docs:sync-confirm-overwrite');
  });

  it('should register exactly 8 handlers', () => {
    registerGoogleDocsHandlers();
    expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledTimes(8);
  });

  describe('pick-and-link', () => {
    function invokePickAndLink(filePath: string): Promise<unknown> {
      registerGoogleDocsHandlers();
      const entry = vi
        .mocked(ipcMain.handle)
        .mock.calls.find((c) => c[0] === 'google-docs:pick-and-link');
      if (!entry) throw new Error('pick-and-link handler not registered');
      const fn = entry[1] as (e: unknown, p: string) => Promise<unknown>;
      return fn({}, filePath);
    }

    it('should store the document the user picked', async () => {
      mocks.authService.pickDocument.mockResolvedValue('PICKED_DOC_ID');
      await invokePickAndLink('/notes/a.md');
      expect(mocks.linkStore.setLink).toHaveBeenCalledWith('/notes/a.md', 'PICKED_DOC_ID');
    });

    it('should store nothing when the user cancels the picker', async () => {
      mocks.authService.pickDocument.mockResolvedValue(null);
      const result = await invokePickAndLink('/notes/a.md');
      expect(mocks.linkStore.setLink).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  it('should unregister all handlers', () => {
    unregisterGoogleDocsHandlers();
    const removeCalls = vi.mocked(ipcMain.removeHandler).mock.calls.map(
      (c) => c[0],
    );
    expect(removeCalls).toContain('google-docs:auth-status');
    expect(removeCalls).toContain('google-docs:auth-sign-in');
    expect(removeCalls).toContain('google-docs:auth-sign-out');
    expect(removeCalls).toContain('google-docs:pick-and-link');
    expect(removeCalls).toContain('google-docs:unlink');
    expect(removeCalls).toContain('google-docs:get-link');
    expect(removeCalls).toContain('google-docs:sync');
    expect(removeCalls).toContain('google-docs:sync-confirm-overwrite');
  });
});
