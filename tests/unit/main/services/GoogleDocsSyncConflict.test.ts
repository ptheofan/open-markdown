import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsSyncService, modelFingerprint } from '@main/services/GoogleDocsSyncService';
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

describe('deciding what a sync should do', () => {
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

  const localModel = {
    elements: [{ type: 'paragraph' as const, runs: [{ text: 'Second paragraph edited' }] }],
  };

  let syncService: ReturnType<typeof createGoogleDocsSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = createGoogleDocsSyncService(
      mockDocsService as unknown as Parameters<typeof createGoogleDocsSyncService>[0],
      mockLinkStore as unknown as Parameters<typeof createGoogleDocsSyncService>[1],
    );
    mockDocsService.getDocument.mockResolvedValue(remoteDoc());
    mockDocsService.batchUpdate.mockResolvedValue({});
    vi.mocked(convertMarkdownToDocs).mockReturnValue(localModel);
  });

  it('asks how to reconcile when both sides changed', async () => {
    mockLinkStore.loadBaseline.mockResolvedValue('Intro paragraph\nOld second text\n');
    mockDocsService.extractPlainText.mockReturnValue('Intro paragraph\nSecond paragraph\n');
    mockLinkStore.getModelFingerprint.mockResolvedValue('fingerprint-of-older-markdown');

    const result = await syncService.sync('/file.md', 'doc-1', 'markdown');

    expect(result.conflict).toBe('both');
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('reports a doc-only change separately, since there is nothing to resolve', async () => {
    mockLinkStore.loadBaseline.mockResolvedValue('Intro paragraph\nOld second text\n');
    mockDocsService.extractPlainText.mockReturnValue('Intro paragraph\nSecond paragraph\n');
    // The local markdown is byte-for-byte what we pushed last time.
    mockLinkStore.getModelFingerprint.mockResolvedValue(modelFingerprint(localModel));

    const result = await syncService.sync('/file.md', 'doc-1', 'markdown');

    expect(result.conflict).toBe('remote-only');
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('does not wipe a Doc that already had content when it is first linked', async () => {
    // No baseline: this file has never been synced to this Doc.
    mockLinkStore.loadBaseline.mockResolvedValue(null);
    mockDocsService.extractPlainText.mockReturnValue('Intro paragraph\nSecond paragraph\n');

    const result = await syncService.sync('/file.md', 'doc-1', 'markdown');

    expect(result.conflict).toBe('both');
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('does not inherit another file\'s baseline for the same Doc', async () => {
    // Two files can point at one Doc. Baselines are keyed by docId, so a file
    // that has never synced would otherwise pick up the other file's baseline,
    // skip the first-sync guard entirely, and overwrite the Doc without asking.
    // lastSyncedAt is the per-file signal: null means this file never synced.
    mockLinkStore.getLink.mockReturnValue({ docId: 'doc-1', lastSyncedAt: null });
    mockLinkStore.loadBaseline.mockResolvedValue('Intro paragraph\nSecond paragraph\n');
    mockDocsService.extractPlainText.mockReturnValue('Intro paragraph\nSecond paragraph\n');

    const result = await syncService.sync('/a-brand-new-file.md', 'doc-1', 'markdown');

    expect(result.conflict).toBe('both');
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('still populates a Doc that is genuinely empty on first link', async () => {
    mockLinkStore.loadBaseline.mockResolvedValue(null);
    mockDocsService.getDocument.mockResolvedValue({ body: { content: [{ endIndex: 2 }] } });
    mockDocsService.extractPlainText.mockReturnValue('');

    const result = await syncService.sync('/file.md', 'doc-1', 'markdown');

    expect(result.success).toBe(true);
    expect(result.conflict).toBeUndefined();
    expect(mockDocsService.batchUpdate).toHaveBeenCalled();
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
    mockLinkStore.loadMarkdownSnapshots.mockResolvedValue({ local: SNAPSHOT, remote: SNAPSHOT });
    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [{ type: 'paragraph', runs: [{ text: 'whatever' }] }],
    });
  });

  it('preview reports every difference and writes nothing', async () => {
    const result = await syncService.resolve(
      '/file.md', 'doc-1', 'preview', 'Intro EDITED\n\nOld second text\n',
    );

    expect(result.success).toBe(true);
    expect(result.changes).toEqual([
      { index: 0, kind: 'local-only', local: 'Intro EDITED', remote: 'Intro paragraph', choice: 'local' },
      { index: 1, kind: 'remote-only', local: 'Old second text', remote: 'Second paragraph', choice: 'remote' },
    ]);
    // Looking must never change anything.
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('preview marks a block both sides rewrote as a conflict', async () => {
    const result = await syncService.resolve(
      '/file.md', 'doc-1', 'preview', 'Intro paragraph\n\nMy own second text\n',
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

    const result = await syncService.resolve('/file.md', 'doc-1', 'preview', 'Intro paragraph\n\nMine\n');

    expect(result.success).toBe(true);
    expect(result.changes).toEqual([
      { index: 1, kind: 'conflict', local: 'Mine', remote: 'Second paragraph', choice: 'local' },
    ]);
  });

  it('apply writes the approved markdown and edits the Doc to match', async () => {
    const result = await syncService.resolve(
      '/file.md', 'doc-1', 'apply', 'Intro EDITED\n\nSecond paragraph\n',
    );

    expect(result.success).toBe(true);
    expect(result.markdown).toBe('Intro EDITED\n\nSecond paragraph\n');
    expect(mockDocsService.batchUpdate).toHaveBeenCalled();
  });

  it('reports progress, so the snackbar keeps moving while it works', async () => {
    // resolve() can upload diagrams and rewrite a large document, exactly like
    // sync(). Without this the progress bar sits dark for the whole operation.
    const updates: Array<{ percent: number; label: string }> = [];

    await syncService.resolve('/file.md', 'doc-1', 'apply', SNAPSHOT, {
      onProgress: (u) => updates.push(u),
    });

    expect(updates[0]?.label).toBe('Applying changes');
    expect(updates.at(-1)).toEqual({ percent: 100, label: 'Done' });
  });

  it('records nothing when the local file could not be written', async () => {
    // Recording a sync the file never received would make the next sync read
    // the stale file, decide the local side changed, and push it back over the
    // collaborator's edits.
    const result = await syncService.resolve('/file.md', 'doc-1', 'apply', SNAPSHOT, {
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

    await syncService.resolve('/file.md', 'doc-1', 'apply', 'Intro EDITED\n\nSecond paragraph\n', {
      writeLocal: () => { order.push('file'); return Promise.resolve(true); },
    });

    expect(order[0]).toBe('file');
    expect(order).toContain('doc');
  });
});
