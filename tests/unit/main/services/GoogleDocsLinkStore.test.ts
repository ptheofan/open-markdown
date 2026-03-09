import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { createGoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import type { GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';

// Mock Electron so the import doesn't fail at load time
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-userdata' },
}));

describe('GoogleDocsLinkStore', () => {
  let store: GoogleDocsLinkStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-test-'));
    store = createGoogleDocsLinkStore(tempDir);
    await store.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should return null for unlinked file', () => {
    const link = store.getLink('/some/file.md');
    expect(link).toBeNull();
  });

  it('should store and retrieve a link', async () => {
    await store.setLink('/some/file.md', '1aBcDeFg');
    const link = store.getLink('/some/file.md');
    expect(link).toEqual({ docId: '1aBcDeFg', lastSyncedAt: null });
  });

  it('should remove a link', async () => {
    await store.setLink('/some/file.md', '1aBcDeFg');
    await store.removeLink('/some/file.md');
    expect(store.getLink('/some/file.md')).toBeNull();
  });

  it('should update lastSyncedAt', async () => {
    await store.setLink('/some/file.md', '1aBcDeFg');
    const now = new Date().toISOString();
    await store.updateLastSynced('/some/file.md', now);
    expect(store.getLink('/some/file.md')?.lastSyncedAt).toBe(now);
  });

  it('should save and load baseline', async () => {
    await store.saveBaseline('1aBcDeFg', 'hello world content');
    const baseline = await store.loadBaseline('1aBcDeFg');
    expect(baseline).toBe('hello world content');
  });

  it('should return null for missing baseline', async () => {
    const baseline = await store.loadBaseline('nonexistent');
    expect(baseline).toBeNull();
  });

  it('should delete baseline', async () => {
    await store.saveBaseline('1aBcDeFg', 'content');
    await store.deleteBaseline('1aBcDeFg');
    const baseline = await store.loadBaseline('1aBcDeFg');
    expect(baseline).toBeNull();
  });

  it('should persist links across instances', async () => {
    await store.setLink('/some/file.md', '1aBcDeFg');
    const store2 = createGoogleDocsLinkStore(tempDir);
    await store2.initialize();
    expect(store2.getLink('/some/file.md')).toEqual({ docId: '1aBcDeFg', lastSyncedAt: null });
  });

  it('should clean up baseline when removing link', async () => {
    await store.setLink('/some/file.md', '1aBcDeFg');
    await store.saveBaseline('1aBcDeFg', 'baseline content');
    await store.removeLink('/some/file.md');
    const baseline = await store.loadBaseline('1aBcDeFg');
    expect(baseline).toBeNull();
  });
});
