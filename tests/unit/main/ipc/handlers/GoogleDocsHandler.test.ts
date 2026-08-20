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
  syncService: {
    sync: vi.fn(),
    syncForceOverwrite: vi.fn(),
  },
  linkStore: {
    getLink: vi.fn(),
    removeLink: vi.fn(),
    setLink: vi.fn(),
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
  createGoogleDocsSyncService: () => mocks.syncService,
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

  describe('sync with a document that is gone', () => {
    function invokeSync(filePath: string): Promise<unknown> {
      registerGoogleDocsHandlers();
      const entry = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === 'google-docs:sync');
      if (!entry) throw new Error('sync handler not registered');
      const fn = entry[1] as (e: unknown, ...a: unknown[]) => Promise<unknown>;
      return fn({}, filePath, '# hi');
    }

    it('should drop the stale link when the document is not found', async () => {
      mocks.linkStore.getLink.mockReturnValue({ docId: 'GONE_DOC', lastSyncedAt: null });
      const notFound = Object.assign(new Error('Requested entity was not found.'), { status: 404 });
      mocks.syncService.sync.mockRejectedValue(notFound);

      const result = (await invokeSync('/notes/a.md')) as { success: boolean; error: string };

      expect(mocks.linkStore.removeLink).toHaveBeenCalledWith('/notes/a.md');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/link|pick/i);
    });

    it('should keep the link when the failure is not a missing document', async () => {
      mocks.linkStore.getLink.mockReturnValue({ docId: 'FINE_DOC', lastSyncedAt: null });
      mocks.syncService.sync.mockRejectedValue(
        Object.assign(new Error('Backend error'), { status: 500 })
      );

      await invokeSync('/notes/a.md');

      expect(mocks.linkStore.removeLink).not.toHaveBeenCalled();
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
