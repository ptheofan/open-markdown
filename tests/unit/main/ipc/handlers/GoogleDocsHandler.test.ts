import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent = vi.hoisted(() => ({ calls: [] as { channel: string; payload: unknown }[] }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sent.calls.push({ channel, payload }),
        },
      },
    ],
  },
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
    resolve: vi.fn(),
  },
  fileService: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
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

vi.mock('@main/services/FileService', () => ({
  getFileService: () => mocks.fileService,
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
    expect(handleCalls).toContain('google-docs:sync-resolve');
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

  describe('sync-resolve', () => {
    function invokeResolve(mode: string, markdown = '# md'): Promise<unknown> {
      registerGoogleDocsHandlers();
      const entry = vi
        .mocked(ipcMain.handle)
        .mock.calls.find((c) => c[0] === 'google-docs:sync-resolve');
      if (!entry) throw new Error('sync-resolve handler not registered');
      const fn = entry[1] as (...args: unknown[]) => Promise<unknown>;
      return fn({}, '/notes/a.md', mode, markdown, undefined, undefined);
    }

    /** Run whatever writeLocal callback the handler handed the sync service. */
    async function runWriteLocal(content: string): Promise<boolean | undefined> {
      const options = mocks.syncService.resolve.mock.calls[0]?.[4] as
        { writeLocal?: (md: string) => Promise<boolean> } | undefined;
      return options?.writeLocal?.(content);
    }

    beforeEach(() => {
      mocks.linkStore.getLink.mockReturnValue({ docId: 'doc-1', lastSyncedAt: null });
      mocks.syncService.resolve.mockResolvedValue({ success: true });
      mocks.fileService.readFile.mockResolvedValue({ success: true, content: '# md' });
      mocks.fileService.writeFile.mockResolvedValue({ success: true });
    });

    it('passes the chosen mode through to the sync service', async () => {
      await invokeResolve('preview');
      expect(mocks.syncService.resolve).toHaveBeenCalledWith(
        '/notes/a.md', 'doc-1', 'preview', '# md', expect.any(Object),
      );
    });

    it('does not rewrite the file when the review changed nothing in it', async () => {
      // Choosing "use my file" for every difference leaves the markdown byte
      // for byte as it was. Writing it anyway bumps the mtime and wakes the
      // watcher, which re-renders the view for no reason.
      await invokeResolve('apply');
      await expect(runWriteLocal('# md')).resolves.toBe(true);
      expect(mocks.fileService.writeFile).not.toHaveBeenCalled();
    });

    it('rewrites the file when the review did change it', async () => {
      await invokeResolve('apply');
      await expect(runWriteLocal('# md changed')).resolves.toBe(true);
      expect(mocks.fileService.writeFile).toHaveBeenCalledWith('/notes/a.md', '# md changed');
    });

    it('writes when the file could not be read, rather than assuming it matches', async () => {
      mocks.fileService.readFile.mockResolvedValue({ success: false });
      await invokeResolve('apply');
      await runWriteLocal('# md');
      expect(mocks.fileService.writeFile).toHaveBeenCalled();
    });

    it('drops a link to a document that is gone rather than retrying it', async () => {
      mocks.syncService.resolve.mockResolvedValue({ success: false, status: 404 });
      await invokeResolve('apply');
      expect(mocks.linkStore.removeLink).toHaveBeenCalledWith('/notes/a.md');
    });

    it('refuses when the file is not linked', async () => {
      mocks.linkStore.getLink.mockReturnValue(undefined);
      const result = await invokeResolve('preview');
      expect(result).toEqual({ success: false, error: 'File not linked to Google Docs' });
      expect(mocks.syncService.resolve).not.toHaveBeenCalled();
    });
  });

  describe('sync progress', () => {
    it('broadcasts each progress update the sync service reports', async () => {
      sent.calls.length = 0;
      mocks.linkStore.getLink.mockReturnValue({ docId: 'doc-1', lastSyncedAt: null });
      // Drive the callback the handler hands us, the way the service would.
      mocks.syncService.sync.mockImplementation(
        (
          _f: string,
          _d: string,
          _m: string,
          _mm: unknown,
          _t: unknown,
          onProgress?: (u: { percent: number; label: string }) => void,
        ) => {
          onProgress?.({ percent: 25, label: 'Uploading diagram 1 of 2' });
          onProgress?.({ percent: 70, label: 'Uploaded diagram 2 of 2' });
          return Promise.resolve({ success: true });
        },
      );

      registerGoogleDocsHandlers();
      const entry = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === 'google-docs:sync');
      if (!entry) throw new Error('sync handler not registered');
      await (entry[1] as (e: unknown, ...a: unknown[]) => Promise<unknown>)({}, '/a.md', '# x');

      const progress = sent.calls.filter((c) => c.channel === 'google-docs:on-sync-progress');
      expect(progress.map((c) => c.payload)).toEqual([
        { percent: 25, label: 'Uploading diagram 1 of 2' },
        { percent: 70, label: 'Uploaded diagram 2 of 2' },
      ]);
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

    it('should drop the stale link when sync REPORTS the document is gone', async () => {
      // The sync service catches API errors and resolves with a failure
      // result -- it does not throw -- so the returned result is the only
      // place the 404 is visible.
      mocks.linkStore.getLink.mockReturnValue({ docId: 'GONE_DOC', lastSyncedAt: null });
      mocks.syncService.sync.mockResolvedValue({
        success: false,
        error: 'Requested entity was not found.',
        status: 404,
      });

      const result = (await invokeSync('/notes/a.md')) as { success: boolean; error: string };

      expect(mocks.linkStore.removeLink).toHaveBeenCalledWith('/notes/a.md');
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
    expect(removeCalls).toContain('google-docs:sync-resolve');
  });
});
