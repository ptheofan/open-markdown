import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import type { DocsBatchUpdateRequest } from '@main/services/GoogleDocsService';
import type { GDocsApiDocument } from '@shared/types/google-docs';

vi.mock('@main/services/MarkdownToDocsConverter', () => ({
  convertMarkdownToDocs: vi.fn(),
}));

import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

/**
 * The Doc as a collaborator left it: two paragraphs, the first carrying a
 * comment we must not detach. Indices mirror what the Docs API returns.
 */
const INTRO_START = 1;
const INTRO_END = 17; // "Intro paragraph\n"
const SECOND_END = 34; // "Second paragraph\n"

function remoteDoc(): GDocsApiDocument {
  return {
    body: {
      content: [
        {
          startIndex: INTRO_START,
          endIndex: INTRO_END,
          paragraph: {
            elements: [
              { startIndex: INTRO_START, endIndex: INTRO_END, textRun: { content: 'Intro paragraph\n' } },
            ],
          },
        },
        {
          startIndex: INTRO_END,
          endIndex: SECOND_END,
          paragraph: {
            elements: [
              { startIndex: INTRO_END, endIndex: SECOND_END, textRun: { content: 'Second paragraph\n' } },
            ],
          },
        },
      ],
    },
  };
}

describe('pushing to a Doc that also changed', () => {
  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  const mockLinkStore = {
    loadBaseline: vi.fn(),
    loadImageCache: vi.fn().mockResolvedValue({}),
    getModelFingerprint: vi.fn().mockResolvedValue(null),
    saveModelFingerprint: vi.fn(),
    saveImageCache: vi.fn(),
    saveBaseline: vi.fn(),
    saveMarkdownSnapshots: vi.fn(),
    loadMarkdownSnapshots: vi.fn().mockResolvedValue(null),
    updateLastSynced: vi.fn(),
    getLink: vi.fn(),
    setLink: vi.fn(),
    removeLink: vi.fn(),
    initialize: vi.fn(),
    deleteBaseline: vi.fn(),
  };

  let syncService: ReturnType<typeof createGoogleDocsSyncService>;

  /** Every deleteContentRange the service asked Google to perform. */
  function deletedRanges(): Array<{ startIndex: number; endIndex: number }> {
    return mockDocsService.batchUpdate.mock.calls
      .flatMap(([, requests]) => (requests ?? []) as DocsBatchUpdateRequest[])
      .flatMap((r) => ('deleteContentRange' in r ? [r.deleteContentRange.range] : []));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = createGoogleDocsSyncService(
      mockDocsService as unknown as Parameters<typeof createGoogleDocsSyncService>[0],
      mockLinkStore as unknown as Parameters<typeof createGoogleDocsSyncService>[1],
    );

    mockLinkStore.loadBaseline.mockResolvedValue('Intro paragraph\nOld second text\n');
    mockDocsService.getDocument.mockResolvedValue(remoteDoc());
    mockDocsService.extractPlainText.mockReturnValue('Intro paragraph\nSecond paragraph\n');
    mockDocsService.batchUpdate.mockResolvedValue({});

    // Locally, only the second paragraph was edited.
    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [
        { type: 'paragraph', runs: [{ text: 'Intro paragraph' }] },
        { type: 'paragraph', runs: [{ text: 'Second paragraph edited' }] },
      ],
    });
  });

  it('never wipes the whole document body', async () => {
    await syncService.syncForceOverwrite('/file.md', 'doc-1', 'markdown');

    const wipes = deletedRanges().filter(
      (r) => r.startIndex <= INTRO_START && r.endIndex >= SECOND_END - 1,
    );
    expect(wipes).toEqual([]);
  });

  it('leaves an untouched paragraph alone so its comments survive', async () => {
    await syncService.syncForceOverwrite('/file.md', 'doc-1', 'markdown');

    const touchingIntro = deletedRanges().filter(
      (r) => r.startIndex < INTRO_END && r.endIndex > INTRO_START,
    );
    expect(touchingIntro).toEqual([]);
  });
});

describe('deciding what a direction should do', () => {
  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  const mockLinkStore = {
    loadBaseline: vi.fn(),
    loadImageCache: vi.fn().mockResolvedValue({}),
    getModelFingerprint: vi.fn().mockResolvedValue(null),
    saveModelFingerprint: vi.fn(),
    saveImageCache: vi.fn(),
    saveBaseline: vi.fn(),
    saveMarkdownSnapshots: vi.fn(),
    loadMarkdownSnapshots: vi.fn().mockResolvedValue(null),
    updateLastSynced: vi.fn(),
    getLink: vi.fn(),
    setLink: vi.fn(),
    removeLink: vi.fn(),
    initialize: vi.fn(),
    deleteBaseline: vi.fn(),
  };

  // Both sides held this at the last sync. The Doc now reads
  // "Intro paragraph / Second paragraph", so the collaborator rewrote block 2.
  const SNAPSHOT = 'Intro paragraph\n\nOld second text\n';

  let syncService: ReturnType<typeof createGoogleDocsSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = createGoogleDocsSyncService(
      mockDocsService as unknown as Parameters<typeof createGoogleDocsSyncService>[0],
      mockLinkStore as unknown as Parameters<typeof createGoogleDocsSyncService>[1],
    );
    mockDocsService.getDocument.mockResolvedValue(remoteDoc());
    mockDocsService.batchUpdate.mockResolvedValue({});
    mockLinkStore.getLink.mockReturnValue({ docId: 'doc-1', lastSyncedAt: '2026-01-01T00:00:00Z' });
    mockLinkStore.loadMarkdownSnapshots.mockResolvedValue({ local: SNAPSHOT, remote: SNAPSHOT });
    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [{ type: 'paragraph', runs: [{ text: 'whatever' }] }],
    });
  });

  const preview = (direction: 'push' | 'pull', markdown: string, file = '/file.md'): Promise<
    Awaited<ReturnType<typeof syncService.resolve>>
  > => syncService.resolve(file, 'doc-1', 'preview', direction, markdown);

  it('has work to do on a push when only the Doc moved', async () => {
    // A push makes the Doc say what the file says. Someone else editing the
    // Doc is drift from the file, and bringing it back into line is exactly
    // what a push is for -- reporting "nothing to push" hides that.
    const result = await preview('push', SNAPSHOT);

    expect(result.nothingToDo).toBe(false);
    expect(result.needsReview).toBe(true);
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('pulls a Doc-only change without asking, since nothing of the user\'s is at stake', async () => {
    const result = await preview('pull', SNAPSHOT);

    expect(result.nothingToDo).toBe(false);
    expect(result.needsReview).toBe(false);
  });

  it('has work to do on a pull when only the file moved', async () => {
    mockLinkStore.loadMarkdownSnapshots.mockResolvedValue({
      local: SNAPSHOT,
      remote: 'Intro paragraph\n\nSecond paragraph\n',
    });

    const result = await preview('pull', 'Intro EDITED\n\nOld second text\n');

    expect(result.nothingToDo).toBe(false);
    expect(result.needsReview).toBe(true);
  });

  it('reports nothing to do only when the two sides already agree', async () => {
    mockLinkStore.loadMarkdownSnapshots.mockResolvedValue({
      local: 'Intro paragraph\n\nSecond paragraph\n',
      remote: 'Intro paragraph\n\nSecond paragraph\n',
    });

    const result = await preview('push', 'Intro paragraph\n\nSecond paragraph\n');

    expect(result.nothingToDo).toBe(true);
  });

  it('pushes a file-only change without asking', async () => {
    mockLinkStore.loadMarkdownSnapshots.mockResolvedValue({
      local: SNAPSHOT,
      remote: 'Intro paragraph\n\nSecond paragraph\n',
    });

    const result = await preview('push', 'Intro EDITED\n\nOld second text\n');

    expect(result.nothingToDo).toBe(false);
    expect(result.needsReview).toBe(false);
  });

  it('stops to ask when both sides moved, whichever way is asked for', async () => {
    const local = 'Intro EDITED\n\nOld second text\n';

    expect((await preview('push', local)).needsReview).toBe(true);
    expect((await preview('pull', local)).needsReview).toBe(true);
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('defaults every difference to the Doc on a pull and the file on a push', async () => {
    const local = 'Intro EDITED\n\nOld second text\n';

    expect((await preview('pull', local)).changes?.every((c) => c.choice === 'remote')).toBe(true);
    expect((await preview('push', local)).changes?.every((c) => c.choice === 'local')).toBe(true);
  });

  it('does not push over a Doc that already had content when first linked', async () => {
    // The data-loss guard. No snapshots means no shared history, so the whole
    // Doc is a difference and the user has to see it before anything is written.
    mockLinkStore.getLink.mockReturnValue({ docId: 'doc-1', lastSyncedAt: null });

    const result = await preview('push', 'Something entirely different\n');

    expect(result.needsReview).toBe(true);
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('does not inherit another file\'s snapshots for the same Doc', async () => {
    // Two files can point at one Doc. Snapshots are keyed by docId, so a file
    // that has never synced would otherwise be diffed against a history it was
    // never part of -- and its own content would read as unchanged.
    mockLinkStore.getLink.mockReturnValue({ docId: 'doc-1', lastSyncedAt: null });
    mockLinkStore.loadMarkdownSnapshots.mockResolvedValue({ local: SNAPSHOT, remote: SNAPSHOT });

    const result = await preview('push', 'A brand new file\n', '/a-brand-new-file.md');

    expect(result.needsReview).toBe(true);
    expect(mockLinkStore.loadMarkdownSnapshots).not.toHaveBeenCalled();
  });

  it('has nothing to review when the Doc is genuinely empty on first link', async () => {
    mockLinkStore.getLink.mockReturnValue({ docId: 'doc-1', lastSyncedAt: null });
    mockDocsService.getDocument.mockResolvedValue({ body: { content: [{ endIndex: 2 }] } });

    const result = await preview('push', 'Fresh content\n');

    expect(result.nothingToDo).toBe(false);
    expect(result.needsReview).toBe(false);
  });
});

describe('carrying out the user\'s choice', () => {
  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  const mockLinkStore = {
    loadBaseline: vi.fn(),
    loadImageCache: vi.fn().mockResolvedValue({}),
    getModelFingerprint: vi.fn().mockResolvedValue(null),
    saveModelFingerprint: vi.fn(),
    saveImageCache: vi.fn(),
    saveBaseline: vi.fn(),
    saveMarkdownSnapshots: vi.fn(),
    loadMarkdownSnapshots: vi.fn(),
    updateLastSynced: vi.fn(),
    getLink: vi.fn(),
    setLink: vi.fn(),
    removeLink: vi.fn(),
    initialize: vi.fn(),
    deleteBaseline: vi.fn(),
  };

  // The Doc reads "Intro paragraph / Second paragraph"; at the last sync both
  // sides read "Intro paragraph / Old second text". So the collaborator
  // rewrote the second block.
  const SNAPSHOT = 'Intro paragraph\n\nOld second text\n';

  let syncService: ReturnType<typeof createGoogleDocsSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = createGoogleDocsSyncService(
      mockDocsService as unknown as Parameters<typeof createGoogleDocsSyncService>[0],
      mockLinkStore as unknown as Parameters<typeof createGoogleDocsSyncService>[1],
    );
    mockDocsService.getDocument.mockResolvedValue(remoteDoc());
    mockDocsService.extractPlainText.mockReturnValue('Intro paragraph\nSecond paragraph\n');
    mockDocsService.batchUpdate.mockResolvedValue({});
    mockLinkStore.getLink.mockReturnValue({ docId: 'doc-1', lastSyncedAt: '2026-01-01T00:00:00Z' });
    mockLinkStore.loadMarkdownSnapshots.mockResolvedValue({ local: SNAPSHOT, remote: SNAPSHOT });
    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [{ type: 'paragraph', runs: [{ text: 'whatever' }] }],
    });
  });

  it('preview reports every difference and writes nothing', async () => {
    const result = await syncService.resolve(
      '/file.md', 'doc-1', 'preview', 'push', 'Intro EDITED\n\nOld second text\n',
    );

    expect(result.success).toBe(true);
    expect(result.changes).toEqual([
      { index: 0, kind: 'local-only', local: 'Intro EDITED', remote: 'Intro paragraph', choice: 'local' },
      { index: 1, kind: 'remote-only', local: 'Old second text', remote: 'Second paragraph', choice: 'local' },
    ]);
    // Looking must never change anything.
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('preview marks a block both sides rewrote as a conflict', async () => {
    const result = await syncService.resolve(
      '/file.md', 'doc-1', 'preview', 'push', 'Intro paragraph\n\nMy own second text\n',
    );

    expect(result.changes).toEqual([
      {
        index: 1,
        kind: 'conflict',
        local: 'My own second text',
        remote: 'Second paragraph',
        choice: 'local',
      },
    ]);
  });

  it('previews a first sync against the Doc as it stands, having no snapshot', async () => {
    // The old code refused here, telling the user to pick a whole side. There
    // is no shared ancestor, but the two documents themselves diff perfectly
    // well -- which is the only way a first sync onto a Doc with content can
    // be reviewed rather than guessed at.
    mockLinkStore.loadMarkdownSnapshots.mockResolvedValue(null);

    const result = await syncService.resolve('/file.md', 'doc-1', 'preview', 'push', 'Intro paragraph\n\nMine\n');

    expect(result.success).toBe(true);
    expect(result.changes).toEqual([
      { index: 1, kind: 'conflict', local: 'Mine', remote: 'Second paragraph', choice: 'local' },
    ]);
  });

  it('a pull taking the Doc wholesale never touches the Doc', async () => {
    // Nothing of the user's was kept, so the Doc already says what the file
    // is about to say. Sending it anyway rewrites every block whose two
    // dialects differ -- which is most of them -- for no reason at all.
    const result = await syncService.resolve(
      '/file.md', 'doc-1', 'apply', 'pull', 'Intro paragraph\n\nSecond paragraph\n',
    );

    expect(result.success).toBe(true);
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('a pull that keeps one of your blocks does send that to the Doc', async () => {
    const result = await syncService.resolve(
      '/file.md', 'doc-1', 'apply', 'pull', 'Intro MINE\n\nSecond paragraph\n',
      { alsoWriteSource: true },
    );

    expect(result.success).toBe(true);
    expect(mockDocsService.batchUpdate).toHaveBeenCalled();
  });

  it('a push taking the file wholesale never rewrites the file', async () => {
    const wrote: string[] = [];

    await syncService.resolve('/file.md', 'doc-1', 'apply', 'push', SNAPSHOT, {
      writeLocal: (md) => { wrote.push(md); return Promise.resolve(true); },
    });

    expect(wrote).toEqual([]);
    expect(mockDocsService.batchUpdate).toHaveBeenCalled();
  });

  it('a pull still records the sync, so the next one is not blind', async () => {
    await syncService.resolve(
      '/file.md', 'doc-1', 'apply', 'pull', 'Intro paragraph\n\nSecond paragraph\n',
    );

    expect(mockLinkStore.saveBaseline).toHaveBeenCalled();
    expect(mockLinkStore.saveMarkdownSnapshots).toHaveBeenCalled();
    expect(mockLinkStore.updateLastSynced).toHaveBeenCalled();
  });

  it('apply writes the approved markdown and edits the Doc to match', async () => {
    const result = await syncService.resolve(
      '/file.md', 'doc-1', 'apply', 'push', 'Intro EDITED\n\nSecond paragraph\n',
    );

    expect(result.success).toBe(true);
    expect(result.markdown).toBe('Intro EDITED\n\nSecond paragraph\n');
    expect(mockDocsService.batchUpdate).toHaveBeenCalled();
  });

  it('reports progress, so the snackbar keeps moving while it works', async () => {
    // resolve() can upload diagrams and rewrite a large document, exactly like
    // sync(). Without this the progress bar sits dark for the whole operation.
    const updates: Array<{ percent: number; label: string }> = [];

    await syncService.resolve('/file.md', 'doc-1', 'apply', 'push', SNAPSHOT, {
      onProgress: (u) => updates.push(u),
    });

    expect(updates[0]?.label).toBe('Pushing updates to the Google Doc');
    expect(updates.at(-1)).toEqual({ percent: 100, label: 'Done' });
  });

  it('records nothing when the local file could not be written', async () => {
    // Recording a sync the file never received would make the next sync read
    // the stale file, decide the local side changed, and push it back over the
    // collaborator's edits.
    const result = await syncService.resolve('/file.md', 'doc-1', 'apply', 'push', SNAPSHOT, {
      alsoWriteSource: true,
      writeLocal: () => Promise.resolve(false),
    });

    expect(result.success).toBe(false);
    expect(mockLinkStore.saveBaseline).not.toHaveBeenCalled();
    expect(mockLinkStore.saveModelFingerprint).not.toHaveBeenCalled();
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('writes the file before touching the Doc, so a failed push self-heals', async () => {
    // Recorded as each side actually happens. Checking mock call counts after
    // the fact cannot tell the two orderings apart -- both end with one write
    // and one batchUpdate.
    const order: string[] = [];
    mockDocsService.batchUpdate.mockImplementation(() => {
      order.push('doc');
      return Promise.resolve({});
    });

    await syncService.resolve('/file.md', 'doc-1', 'apply', 'push', 'Intro EDITED\n\nSecond paragraph\n', {
      alsoWriteSource: true,
      writeLocal: () => { order.push('file'); return Promise.resolve(true); },
    });

    expect(order[0]).toBe('file');
    expect(order).toContain('doc');
  });
});
