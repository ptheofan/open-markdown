/**
 * SecurityBookmarkService keeps the sandbox access a dialog grants, and gives
 * it back at the next launch.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { SecurityBookmarkService } from '@main/services/SecurityBookmarkService';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), startAccessingSecurityScopedResource: vi.fn() },
  dialog: {
    showOpenDialog: vi.fn(() =>
      Promise.resolve({ canceled: false, filePaths: ['/Users/me/notes'], bookmarks: ['bm-notes'] })
    ),
  },
  BrowserWindow: vi.fn(),
}));

describe('SecurityBookmarkService', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'bookmarks-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('asks for bookmarks, keeps them, and restores access next launch', async () => {
    const { dialog } = await import('electron');
    const first = new SecurityBookmarkService({ enabled: true, dataDir, startAccess: vi.fn() });
    await first.initialize();

    await first.showOpenDialog(undefined, { properties: ['openDirectory'] });

    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ securityScopedBookmarks: true })
    );
    expect(first.covers('/Users/me/notes/sub/a.md')).toBe(true);
    expect(first.covers('/Users/me/other.md')).toBe(false);

    const startAccess = vi.fn();
    const next = new SecurityBookmarkService({ enabled: true, dataDir, startAccess });
    await next.initialize();
    expect(startAccess).toHaveBeenCalledWith('bm-notes');
  });

  it('does nothing outside the sandbox', async () => {
    const { dialog } = await import('electron');
    vi.mocked(dialog.showOpenDialog).mockClear();
    const service = new SecurityBookmarkService({ enabled: false, dataDir, startAccess: vi.fn() });

    await service.showOpenDialog(undefined, { properties: ['openFile'] });

    expect(dialog.showOpenDialog).toHaveBeenCalledWith({ properties: ['openFile'] });
    expect(service.covers('/Users/me/notes/a.md')).toBe(false);
  });
});
