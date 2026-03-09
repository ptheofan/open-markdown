/**
 * Integration test for GoogleDocsSyncService.
 *
 * Unlike the unit test, this uses the REAL MarkdownToDocsConverter and
 * DocsDocumentBuilder. Only the Google Docs API calls (GoogleDocsService)
 * are mocked, so we can verify the full pipeline:
 *   markdown -> converter -> builder -> batch update requests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import { createGoogleDocsLinkStore, type GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import type { GoogleDocsService } from '@main/services/GoogleDocsService';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock electron for LinkStore (it uses app.getPath('userData') as fallback)
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-userdata' },
}));

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('GoogleDocsSyncService Integration', () => {
  let linkStore: GoogleDocsLinkStore;
  let tempDir: string;

  // Mock only the Google Docs API service — everything else is real
  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-int-test-'));
    linkStore = createGoogleDocsLinkStore(tempDir);
    await linkStore.initialize();
    mockDocsService.batchUpdate.mockResolvedValue({ replies: [] });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ── First sync (empty doc) ─────────────────────────────────────────

  describe('first sync (empty doc)', () => {
    it('should convert markdown and populate empty doc with heading, paragraph, and list', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      // Simulate empty Google Doc (body has just the end marker at index 1)
      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ endIndex: 1 }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('');

      const markdown = '# Hello World\n\nThis is a paragraph.\n\n- Item 1\n- Item 2';

      const result = await syncService.sync('/test/file.md', 'doc-123', markdown);

      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalledTimes(1);

      // Verify the batch update contains expected request types
      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
      expect(requests.length).toBeGreaterThan(0);

      // Should contain InsertText requests
      const insertTexts = requests.filter((r: any) => r.insertText);
      expect(insertTexts.length).toBeGreaterThan(0);

      // Should contain HEADING_1 style
      const headingStyles = requests.filter(
        (r: any) => r.updateParagraphStyle?.paragraphStyle?.namedStyleType === 'HEADING_1',
      );
      expect(headingStyles.length).toBe(1);

      // Should contain bullet list formatting
      const bullets = requests.filter((r: any) => r.createParagraphBullets);
      expect(bullets.length).toBeGreaterThan(0);

      // Baseline should have been saved for future three-way diffing
      const baseline = await linkStore.loadBaseline('doc-123');
      expect(baseline).toBeTruthy();
      expect(baseline).toContain('Hello World');
    });

    it('should handle code blocks with monospace font and tables with insertTable', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ endIndex: 1 }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('');

      const markdown = '```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |';

      const result = await syncService.sync('/test/file.md', 'doc-123', markdown);

      expect(result.success).toBe(true);

      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];

      // Should contain monospace font for code block
      const codeFont = requests.filter(
        (r: any) => r.updateTextStyle?.textStyle?.weightedFontFamily?.fontFamily === 'Courier New',
      );
      expect(codeFont.length).toBeGreaterThan(0);

      // Should contain table insertion
      const tables = requests.filter((r: any) => r.insertTable);
      expect(tables.length).toBe(1);
    });

    it('should handle blockquotes with indentation', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ endIndex: 1 }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('');

      const markdown = '> This is a quote';

      const result = await syncService.sync('/test/file.md', 'doc-123', markdown);

      expect(result.success).toBe(true);

      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];

      // Should contain indentation style for blockquote
      const indentStyles = requests.filter(
        (r: any) => r.updateParagraphStyle?.paragraphStyle?.indentStart?.magnitude === 36,
      );
      expect(indentStyles.length).toBeGreaterThan(0);
    });
  });

  // ── Diff-based sync ────────────────────────────────────────────────

  describe('diff-based sync', () => {
    it('should produce minimal changes when only a word changes', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      // Set up baseline from a "previous sync"
      const originalText = 'Hello world\n';
      await linkStore.saveBaseline('doc-123', originalText);
      await linkStore.setLink('/test/file.md', 'doc-123');

      // Current doc matches baseline (no external edits)
      mockDocsService.getDocument.mockResolvedValue({
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Hello world\n' } }],
              },
              startIndex: 1,
              endIndex: 13,
            },
          ],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue('Hello world\n');

      // New markdown changes "world" to "universe"
      const result = await syncService.sync('/test/file.md', 'doc-123', 'Hello universe');

      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalledTimes(1);

      // The diff should be surgical — delete "world" insert "universe"
      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
      const deletes = requests.filter((r: any) => r.deleteContentRange);
      const inserts = requests.filter((r: any) => r.insertText);

      // Should have delete + insert operations (not a full document rebuild)
      expect(deletes.length + inserts.length).toBeGreaterThan(0);
      expect(deletes.length + inserts.length).toBeLessThan(10); // Should be minimal
    });

    it('should skip batchUpdate when content is unchanged', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      // The converter turns "Hello world" into a paragraph element whose plain text is "Hello world\n"
      const text = 'Hello world\n';
      await linkStore.saveBaseline('doc-123', text);
      await linkStore.setLink('/test/file.md', 'doc-123');

      mockDocsService.getDocument.mockResolvedValue({
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: text } }],
              },
            },
          ],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue(text);

      // Same content — converter will produce "Hello world\n" matching baseline
      const result = await syncService.sync('/test/file.md', 'doc-123', 'Hello world');

      expect(result.success).toBe(true);
      // batchUpdate should not be called because text is identical
      expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
    });

    it('should handle adding new content at the end', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      const originalText = 'First paragraph\n';
      await linkStore.saveBaseline('doc-123', originalText);
      await linkStore.setLink('/test/file.md', 'doc-123');

      mockDocsService.getDocument.mockResolvedValue({
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: originalText } }],
              },
            },
          ],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue(originalText);

      const result = await syncService.sync(
        '/test/file.md',
        'doc-123',
        'First paragraph\n\nSecond paragraph',
      );

      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalledTimes(1);

      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
      const inserts = requests.filter((r: any) => r.insertText);
      expect(inserts.length).toBeGreaterThan(0);

      // Baseline should be updated
      const newBaseline = await linkStore.loadBaseline('doc-123');
      expect(newBaseline).toContain('Second paragraph');
    });
  });

  // ── External edit detection ────────────────────────────────────────

  describe('external edit detection', () => {
    it('should detect when doc was edited externally and block sync', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      await linkStore.saveBaseline('doc-123', 'original text\n');
      await linkStore.setLink('/test/file.md', 'doc-123');

      // Someone edited the doc externally — current text differs from baseline
      mockDocsService.getDocument.mockResolvedValue({
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'edited by reviewer\n' } }],
              },
            },
          ],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue('edited by reviewer\n');

      const result = await syncService.sync('/test/file.md', 'doc-123', 'my new content');

      expect(result.success).toBe(false);
      expect(result.externalEditsDetected).toBe(true);
      expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
    });
  });

  // ── Overwrite flow ─────────────────────────────────────────────────

  describe('overwrite flow', () => {
    it('should overwrite even when external edits are detected', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      await linkStore.saveBaseline('doc-123', 'original text\n');
      await linkStore.setLink('/test/file.md', 'doc-123');

      mockDocsService.getDocument.mockResolvedValue({
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'edited by reviewer\n' } }],
              },
            },
          ],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue('edited by reviewer\n');

      const result = await syncService.syncForceOverwrite(
        '/test/file.md',
        'doc-123',
        'my new content',
      );

      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();

      // After overwrite, baseline should be updated to the new content
      const newBaseline = await linkStore.loadBaseline('doc-123');
      expect(newBaseline).toContain('my new content');
    });

    it('should overwrite with full markdown including formatting', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      await linkStore.saveBaseline('doc-123', 'old content\n');
      await linkStore.setLink('/test/file.md', 'doc-123');

      mockDocsService.getDocument.mockResolvedValue({
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'externally changed\n' } }],
              },
            },
          ],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue('externally changed\n');

      const result = await syncService.syncForceOverwrite(
        '/test/file.md',
        'doc-123',
        '# New Title\n\n**Bold text** and *italic*',
      );

      expect(result.success).toBe(true);

      // The diff operations should include changes
      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
      expect(requests.length).toBeGreaterThan(0);
    });
  });

  // ── Mermaid diagram handling ───────────────────────────────────────

  describe('mermaid diagram handling', () => {
    it('should upload mermaid PNG and include image request', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ endIndex: 1 }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('');
      mockDocsService.uploadImage.mockResolvedValue('drive-file-123');

      const markdown = '```mermaid\ngraph LR\n  A --> B\n```';
      const mermaidDiagrams = [
        {
          code: 'graph LR\n  A --> B',
          pngBase64: 'iVBORw0KGgoAAAANSUhEUg==', // fake PNG base64
          liveUrl: 'https://mermaid.live/edit#pako:abc123',
        },
      ];

      const result = await syncService.sync(
        '/test/file.md',
        'doc-123',
        markdown,
        mermaidDiagrams,
      );

      expect(result.success).toBe(true);
      expect(mockDocsService.uploadImage).toHaveBeenCalledTimes(1);

      // Upload should have received a Buffer from base64
      const uploadCall = mockDocsService.uploadImage.mock.calls[0]!;
      expect(Buffer.isBuffer(uploadCall[0])).toBe(true);
      expect(uploadCall[1]).toContain('mermaid-');

      // Should contain insertInlineImage in the requests
      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
      const imageInserts = requests.filter((r: any) => r.insertInlineImage);
      expect(imageInserts.length).toBe(1);
      expect(imageInserts[0].insertInlineImage.uri).toContain('drive-file-123');
    });

    it('should gracefully handle upload failure for mermaid diagrams', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ endIndex: 1 }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('');
      mockDocsService.uploadImage.mockRejectedValue(new Error('Upload failed'));

      const markdown = '```mermaid\ngraph LR\n  A --> B\n```';
      const mermaidDiagrams = [
        {
          code: 'graph LR\n  A --> B',
          pngBase64: 'iVBORw0KGgoAAAANSUhEUg==',
          liveUrl: 'https://mermaid.live/edit#pako:abc123',
        },
      ];

      // Should not throw — the sync should still succeed, just without the image
      const result = await syncService.sync(
        '/test/file.md',
        'doc-123',
        markdown,
        mermaidDiagrams,
      );

      expect(result.success).toBe(true);

      // When upload fails the element gets no imageLink, so the builder skips it.
      // batchUpdate may not be called at all if there are zero requests, or may be
      // called with requests that contain no insertInlineImage.
      if (mockDocsService.batchUpdate.mock.calls.length > 0) {
        const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
        const imageInserts = requests.filter((r: any) => r.insertInlineImage);
        expect(imageInserts.length).toBe(0);
      }
    });
  });

  // ── Error handling ─────────────────────────────────────────────────

  describe('error handling', () => {
    it('should return error when getDocument API call fails', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      mockDocsService.getDocument.mockRejectedValue(new Error('Network error'));

      const result = await syncService.sync('/test/file.md', 'doc-123', '# Hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should return error when batchUpdate API call fails', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ endIndex: 1 }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('');
      mockDocsService.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const result = await syncService.sync('/test/file.md', 'doc-123', '# Hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Quota exceeded');
    });
  });
});
