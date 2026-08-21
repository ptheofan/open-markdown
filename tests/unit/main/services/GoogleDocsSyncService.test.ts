import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  syncProgressPercent, imageCacheKey, createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';

// Mock the converter module
vi.mock('@main/services/MarkdownToDocsConverter', () => ({
  convertMarkdownToDocs: vi.fn(),
}));

import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

describe('GoogleDocsSyncService', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = createGoogleDocsSyncService(
      mockDocsService as unknown as Parameters<typeof createGoogleDocsSyncService>[0],
      mockLinkStore as unknown as Parameters<typeof createGoogleDocsSyncService>[1],
    );
  });

  describe('when a direction has nothing to carry', () => {
    const diagrams = [
      { code: 'graph A', pngBase64: 'AAA', liveUrl: 'https://mermaid.live/a' },
    ];

    /** A Doc holding `text`, with both sides agreeing on `agreed` at last sync. */
    function docSaying(text: string, agreed: string): void {
      mockLinkStore.loadBaseline.mockResolvedValue(agreed);
      mockDocsService.extractPlainText.mockReturnValue(text);
      mockDocsService.getDocument.mockResolvedValue(text === ''
        ? { body: { content: [{ endIndex: 1 }] } }
        : {
          body: {
            content: [{
              startIndex: 1,
              endIndex: text.length + 1,
              paragraph: { elements: [{ textRun: { content: `${text}\n` } }] },
            }],
          },
        });
      mockDocsService.batchUpdate.mockResolvedValue({});
      mockDocsService.uploadImage.mockResolvedValue('file-id');
      mockLinkStore.getLink.mockReturnValue({ docId: 'doc-1', lastSyncedAt: '2026-01-01T00:00:00Z' });
      // Both snapshots hold what the two sides agreed on last time, so a Doc
      // now saying something else is a change the preview must find.
      mockLinkStore.loadMarkdownSnapshots.mockResolvedValue({ local: agreed, remote: agreed });
      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello' }] }],
      });
    }

    it('says so, and does no work, when neither side has moved', async () => {
      docSaying('Hello', 'Hello');

      const push = await syncService.resolve('/file.md', 'doc-1', 'preview', 'push', 'Hello');
      const pull = await syncService.resolve('/file.md', 'doc-1', 'preview', 'pull', 'Hello');

      expect(push.nothingToDo).toBe(true);
      expect(pull.nothingToDo).toBe(true);
      expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
      expect(mockDocsService.uploadImage).not.toHaveBeenCalled();
    });

    it('still pushes when the markdown changed', async () => {
      docSaying('Hello', 'Hello');
      // The converter is mocked, so the model is what decides -- changing only
      // the markdown string would leave the Doc and the model identical.
      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello changed' }] }],
      });

      await syncService.syncForceOverwrite('/file.md', 'doc-1', 'Hello changed', diagrams);

      expect(mockDocsService.batchUpdate).toHaveBeenCalled();
    });

    it('has work to do on a push when only the Doc was edited', async () => {
      // The Doc has drifted from the file, and a push exists to close that
      // gap. It stops to ask first, because closing it reverts their edit.
      docSaying('Hello, edited by someone else', 'Hello');

      const result = await syncService.resolve('/file.md', 'doc-1', 'preview', 'push', 'Hello');

      expect(result.nothingToDo).toBe(false);
      expect(result.needsReview).toBe(true);
    });

    it('pulls that same Doc edit without stopping to ask', async () => {
      docSaying('Hello, edited by someone else', 'Hello');

      const result = await syncService.resolve('/file.md', 'doc-1', 'preview', 'pull', 'Hello');

      expect(result.nothingToDo).toBe(false);
      expect(result.needsReview).toBe(false);
    });
  });

  describe('diagram upload reuse', () => {
    function setupTwoDiagrams(): void {
      mockLinkStore.loadBaseline.mockResolvedValue(null);
      mockDocsService.getDocument.mockResolvedValue({ body: { content: [{ endIndex: 1 }] } });
      mockDocsService.extractPlainText.mockReturnValue('');
      mockDocsService.batchUpdate.mockResolvedValue({});
      mockDocsService.uploadImage.mockResolvedValue('file-id');
      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [
          { type: 'image', code: 'graph A' },
          { type: 'image', code: 'graph B' },
        ],
      });
    }

    const diagrams = [
      { code: 'graph A', pngBase64: 'AAA', liveUrl: 'https://mermaid.live/a' },
      { code: 'graph B', pngBase64: 'BBB', liveUrl: 'https://mermaid.live/b' },
    ];

    it('uploads diagrams that have never been seen', async () => {
      setupTwoDiagrams();
      mockLinkStore.loadImageCache.mockResolvedValue({});

      await syncService.syncForceOverwrite('/file.md', 'doc-1', 'x', diagrams);

      expect(mockDocsService.uploadImage).toHaveBeenCalledTimes(2);
    });

    it('does not re-upload a diagram whose image is unchanged', async () => {
      setupTwoDiagrams();
      // Both diagrams were uploaded by an earlier sync and are byte-identical.
      mockLinkStore.loadImageCache.mockResolvedValue({
        [imageCacheKey('AAA')]: 'existing-a',
        [imageCacheKey('BBB')]: 'existing-b',
      });

      await syncService.syncForceOverwrite('/file.md', 'doc-1', 'x', diagrams);

      expect(mockDocsService.uploadImage).not.toHaveBeenCalled();
    });

    it('uploads only the diagram that actually changed', async () => {
      setupTwoDiagrams();
      mockLinkStore.loadImageCache.mockResolvedValue({
        [imageCacheKey('AAA')]: 'existing-a',
      });

      await syncService.syncForceOverwrite('/file.md', 'doc-1', 'x', diagrams);

      expect(mockDocsService.uploadImage).toHaveBeenCalledTimes(1);
    });
  });

  describe('progress reporting', () => {
    it('reports a rising sequence that ends at 100', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue(null);
      mockDocsService.getDocument.mockResolvedValue({ body: { content: [{ endIndex: 1 }] } });
      mockDocsService.extractPlainText.mockReturnValue('');
      mockDocsService.batchUpdate.mockResolvedValue({});
      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello' }] }],
      });

      const seen: { percent: number; label: string }[] = [];
      await syncService.resolve('/file.md', 'doc-123', 'apply', 'push', '# Hello', {
        onProgress: (u) => seen.push(u),
      });

      expect(seen.length).toBeGreaterThan(0);
      expect(seen.map((u) => u.percent)).toEqual(
        [...seen.map((u) => u.percent)].sort((a, b) => a - b)
      );
      expect(seen[seen.length - 1]?.percent).toBe(100);
      expect(seen.every((u) => u.label.trim().length > 0)).toBe(true);
    });

    it('names each diagram as it uploads so the slow part is legible', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue(null);
      mockDocsService.getDocument.mockResolvedValue({ body: { content: [{ endIndex: 1 }] } });
      mockDocsService.extractPlainText.mockReturnValue('');
      mockDocsService.batchUpdate.mockResolvedValue({});
      mockDocsService.uploadImage.mockResolvedValue('file-id');
      mockLinkStore.loadImageCache.mockResolvedValue({}); // nothing uploaded before
      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [
          { type: 'image', code: 'graph A' },
          { type: 'image', code: 'graph B' },
        ],
      });

      const seen: { percent: number; label: string }[] = [];
      await syncService.resolve('/file.md', 'doc-123', 'apply', 'push', 'x', {
        mermaidDiagrams: [
          { code: 'graph A', pngBase64: 'AAA', liveUrl: 'https://mermaid.live/a' },
          { code: 'graph B', pngBase64: 'BBB', liveUrl: 'https://mermaid.live/b' },
        ],
        onProgress: (u) => seen.push(u),
      });

      const labels = seen.map((u) => u.label);
      expect(labels).toContain('Uploading diagram 1 of 2');
      expect(labels).toContain('Uploading diagram 2 of 2');
    });
  });

  describe('first sync (no baseline)', () => {
    it('should do full populate when no baseline exists', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue(null);
      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ endIndex: 1 }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('');
      mockDocsService.batchUpdate.mockResolvedValue({});

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello' }] }],
      });

      const result = await syncService.syncForceOverwrite('/file.md', 'doc-123', '# Hello');
      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();
      expect(mockLinkStore.saveBaseline).toHaveBeenCalled();
      expect(mockLinkStore.updateLastSynced).toHaveBeenCalled();
    });
  });

  describe('external edit detection', () => {
    it('should detect external edits when baseline differs from current doc', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue('original text\n');
      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ paragraph: { elements: [{ textRun: { content: 'edited text\n' } }] } }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('edited text\n');

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'new content' }] }],
      });

      const result = await syncService.resolve(
        '/file.md', 'doc-123', 'preview', 'push', 'new content',
      );
      expect(result.needsReview).toBe(true);
      expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('force overwrite', () => {
    it('should overwrite even when external edits detected', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue('original text\n');
      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ paragraph: { elements: [{ textRun: { content: 'edited text\n' } }] } }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('edited text\n');
      mockDocsService.batchUpdate.mockResolvedValue({});

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'new content' }] }],
      });

      const result = await syncService.syncForceOverwrite('/file.md', 'doc-123', 'new content');
      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();
    });
  });

  describe('diff-based update', () => {
    it('should apply minimal diff when no external edits', async () => {
      const baselineText = 'Hello world\n';
      mockLinkStore.loadBaseline.mockResolvedValue(baselineText);
      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Hello world\n' } }] } }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('Hello world\n');
      mockDocsService.batchUpdate.mockResolvedValue({});

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello universe' }] }],
      });

      const result = await syncService.syncForceOverwrite('/file.md', 'doc-123', 'Hello universe');
      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();

      // Should have generated diff operations, not full populate
      const batchArgs = mockDocsService.batchUpdate.mock.calls[0];
      expect(batchArgs).toBeDefined();
      const requests = batchArgs![1] as any[];
      // Should contain delete and/or insert operations (not a full document build)
      const hasDeleteOrInsert = requests.some((r: any) => r.deleteContentRange || r.insertText);
      expect(hasDeleteOrInsert).toBe(true);
    });

    it('sends nothing when text and formatting are both unchanged', async () => {
      const text = 'Hello world\n';
      mockLinkStore.loadBaseline.mockResolvedValue(text);
      mockDocsService.getDocument.mockResolvedValue({
        body: {
          content: [{
            paragraph: { elements: [{ textRun: { content: text } }] },
            startIndex: 1,
            endIndex: 13,
          }],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue(text);
      mockDocsService.batchUpdate.mockResolvedValue({});

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello world' }] }],
      });

      const result = await syncService.syncForceOverwrite('/file.md', 'doc-123', 'Hello world');
      expect(result.success).toBe(true);
      // Nothing differs, so nothing is sent. Re-applying formatting to every
      // paragraph regardless is what made a large document slow to sync.
      expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
    });

    it('still applies formatting when a paragraph became a heading', async () => {
      const text = 'Hello world\n';
      mockLinkStore.loadBaseline.mockResolvedValue(text);
      mockDocsService.getDocument.mockResolvedValue({
        body: {
          content: [{
            paragraph: {
              elements: [{ textRun: { content: text } }],
              paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
            },
            startIndex: 1,
            endIndex: 13,
          }],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue(text);
      mockDocsService.batchUpdate.mockResolvedValue({});

      // Same text, but now a heading -- a formatting-only change that the
      // text diff cannot see and which must still reach the document.
      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'heading', headingLevel: 1, runs: [{ text: 'Hello world' }] }],
      });

      await syncService.syncForceOverwrite('/file.md', 'doc-123', '# Hello world');
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return error result on API failure', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue(null);
      mockDocsService.getDocument.mockRejectedValue(new Error('API error'));

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello' }] }],
      });

      const result = await syncService.syncForceOverwrite('/file.md', 'doc-123', 'Hello');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});


describe('syncProgressPercent', () => {
  it('reports a rising percentage across the fixed phases', () => {
    expect(syncProgressPercent({ phase: 'reading' })).toBe(10);
    expect(syncProgressPercent({ phase: 'converting' })).toBe(20);
    expect(syncProgressPercent({ phase: 'applying' })).toBe(85);
    expect(syncProgressPercent({ phase: 'done' })).toBe(100);
  });

  it('spreads diagram uploads across their band so the slow part visibly moves', () => {
    // 5 diagrams: the band is 25..70, so each finished upload advances it.
    expect(syncProgressPercent({ phase: 'diagrams', index: 0, total: 5 })).toBe(25);
    expect(syncProgressPercent({ phase: 'diagrams', index: 5, total: 5 })).toBe(70);
    const third = syncProgressPercent({ phase: 'diagrams', index: 3, total: 5 });
    expect(third).toBeGreaterThan(25);
    expect(third).toBeLessThan(70);
  });

  it('spreads table inserts across their band', () => {
    expect(syncProgressPercent({ phase: 'tables', index: 0, total: 2 })).toBe(90);
    expect(syncProgressPercent({ phase: 'tables', index: 2, total: 2 })).toBe(100);
  });

  it('never divides by zero when there is nothing to count', () => {
    expect(syncProgressPercent({ phase: 'diagrams', index: 0, total: 0 })).toBe(70);
  });

  it('never goes backwards or leaves 0..100', () => {
    const seen = [
      syncProgressPercent({ phase: 'reading' }),
      syncProgressPercent({ phase: 'converting' }),
      syncProgressPercent({ phase: 'diagrams', index: 1, total: 2 }),
      syncProgressPercent({ phase: 'applying' }),
      syncProgressPercent({ phase: 'tables', index: 1, total: 2 }),
      syncProgressPercent({ phase: 'done' }),
    ];
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    for (const p of seen) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
});

