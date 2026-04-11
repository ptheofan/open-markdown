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

      // getDocument call 1: sync() reads current doc → empty
      // getDocument call 2: fullPopulate() checks existing content for clearing → empty
      // getDocument call 3: fullPopulate() reads back for baseline → populated
      const emptyDoc = { body: { content: [{ endIndex: 1 }] } };
      const populatedDocResponse = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Hello World\n' } }],
              },
              startIndex: 1,
              endIndex: 13,
            },
            {
              paragraph: {
                elements: [{ textRun: { content: 'This is a paragraph.\n' } }],
              },
              startIndex: 13,
              endIndex: 34,
            },
          ],
        },
      };
      mockDocsService.getDocument
        .mockResolvedValueOnce(emptyDoc)     // sync() check
        .mockResolvedValueOnce(emptyDoc)     // fullPopulate() clear check
        .mockResolvedValue(populatedDocResponse); // fullPopulate() baseline read-back
      mockDocsService.extractPlainText
        .mockReturnValueOnce('')   // sync() theirs
        .mockReturnValue('Hello World\nThis is a paragraph.\nItem 1\nItem 2\n');

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

      // # maps to TITLE in Google Docs
      const headingStyles = requests.filter(
        (r: any) => r.updateParagraphStyle?.paragraphStyle?.namedStyleType === 'TITLE',
      );
      expect(headingStyles.length).toBe(1);

      // Should contain bullet list formatting
      const bullets = requests.filter((r: any) => r.createParagraphBullets);
      expect(bullets.length).toBeGreaterThan(0);

      // Baseline should have been saved from API read-back
      const baseline = await linkStore.loadBaseline('doc-123');
      expect(baseline).toBeTruthy();
      expect(baseline).toContain('Hello World');
    });

    it('should handle code blocks with monospace font and tables with insertTable', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      mockDocsService.getDocument
        .mockResolvedValueOnce({ body: { content: [{ endIndex: 1 }] } })
        .mockResolvedValue({ body: { content: [] } });
      mockDocsService.extractPlainText
        .mockReturnValueOnce('')
        .mockReturnValue('const x = 1;\n');

      const markdown = '```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |';

      const result = await syncService.sync('/test/file.md', 'doc-123', markdown);

      expect(result.success).toBe(true);

      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];

      // Should contain monospace font for code block
      const codeFont = requests.filter(
        (r: any) => r.updateTextStyle?.textStyle?.weightedFontFamily?.fontFamily === 'Courier New',
      );
      expect(codeFont.length).toBeGreaterThan(0);

      // Tables are now rendered as text (no insertTable requests)
      const tables = requests.filter((r: any) => r.insertTable);
      expect(tables.length).toBe(0);
    });

    it('should handle blockquotes with indentation', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      mockDocsService.getDocument
        .mockResolvedValueOnce({ body: { content: [{ endIndex: 1 }] } })
        .mockResolvedValue({ body: { content: [] } });
      mockDocsService.extractPlainText
        .mockReturnValueOnce('')
        .mockReturnValue('This is a quote\n');

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

    it('should still apply formatting when text content is unchanged', async () => {
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
              startIndex: 1,
              endIndex: 13,
            },
          ],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue(text);

      // Same content — text diff is a no-op, but formatting is still reapplied
      const result = await syncService.sync('/test/file.md', 'doc-123', 'Hello world');

      expect(result.success).toBe(true);
      // Formatting reapply reads the doc and applies paragraph styles,
      // so batchUpdate IS called (with formatting-only requests)
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();
    });

    it('should handle adding new content at the end', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      const originalText = 'First paragraph\n';
      await linkStore.saveBaseline('doc-123', originalText);
      await linkStore.setLink('/test/file.md', 'doc-123');

      // First getDocument call: for sync comparison
      // Second getDocument call: after text diff, for formatting reapply
      const updatedContent = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'First paragraph\n' } }],
              },
              startIndex: 1,
              endIndex: 17,
            },
            {
              paragraph: {
                elements: [{ textRun: { content: '\n' } }],
              },
              startIndex: 17,
              endIndex: 18,
            },
            {
              paragraph: {
                elements: [{ textRun: { content: 'Second paragraph\n' } }],
              },
              startIndex: 18,
              endIndex: 35,
            },
          ],
        },
      };
      mockDocsService.getDocument
        .mockResolvedValueOnce({
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: originalText } }],
                },
              },
            ],
          },
        })
        .mockResolvedValue(updatedContent);
      mockDocsService.extractPlainText
        .mockReturnValueOnce(originalText)
        .mockReturnValue('First paragraph\n\nSecond paragraph\n');

      const result = await syncService.sync(
        '/test/file.md',
        'doc-123',
        'First paragraph\n\nSecond paragraph',
      );

      expect(result.success).toBe(true);
      // batchUpdate called twice: text diff + formatting reapply
      expect(mockDocsService.batchUpdate).toHaveBeenCalledTimes(2);

      // First call should contain text insert operations
      const textRequests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
      const inserts = textRequests.filter((r: any) => r.insertText);
      expect(inserts.length).toBeGreaterThan(0);

      // Baseline should be updated from API text
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

      // syncForceOverwrite → fullPopulate:
      // getDocument call 1: fullPopulate() checks existing content for clearing
      // getDocument call 2: fullPopulate() reads back for baseline
      mockDocsService.getDocument
        .mockResolvedValueOnce({
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: 'edited by reviewer\n' } }],
                },
                endIndex: 20,
              },
            ],
          },
        })
        .mockResolvedValue({
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: 'my new content\n' } }],
                },
              },
            ],
          },
        });
      // extractPlainText is called once in fullPopulate for baseline read-back
      mockDocsService.extractPlainText.mockReturnValue('my new content\n');

      const result = await syncService.syncForceOverwrite(
        '/test/file.md',
        'doc-123',
        'my new content',
      );

      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();

      // After overwrite, baseline should be updated from API read-back
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

      // syncForceOverwrite → fullPopulate:
      // getDocument call 1: fullPopulate() checks existing content for clearing
      // getDocument call 2: fullPopulate() reads back for baseline
      mockDocsService.getDocument
        .mockResolvedValueOnce({
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: 'externally changed\n' } }],
                },
                endIndex: 20,
              },
            ],
          },
        })
        .mockResolvedValue({
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: 'New Title\n' } }],
                },
                startIndex: 1,
                endIndex: 11,
              },
              {
                paragraph: {
                  elements: [{ textRun: { content: 'Bold text and italic\n' } }],
                },
                startIndex: 11,
                endIndex: 32,
              },
            ],
          },
        });
      mockDocsService.extractPlainText
        .mockReturnValue('New Title\nBold text and italic\n');

      const result = await syncService.syncForceOverwrite(
        '/test/file.md',
        'doc-123',
        '# New Title\n\n**Bold text** and *italic*',
      );

      expect(result.success).toBe(true);

      // The first batchUpdate should contain content changes (clear + populate)
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

      mockDocsService.getDocument
        .mockResolvedValueOnce({ body: { content: [{ endIndex: 1 }] } })
        .mockResolvedValue({ body: { content: [] } });
      mockDocsService.extractPlainText
        .mockReturnValueOnce('')
        .mockReturnValue('\nEdit in Mermaid Live\n');
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

      // Images are rendered via insertInlineImage requests
      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
      const imageInserts = requests.filter((r: any) => r.insertInlineImage);
      expect(imageInserts.length).toBe(1);
      expect(imageInserts[0].insertInlineImage.uri).toContain('drive.google.com');
    });

    it('should gracefully handle upload failure for mermaid diagrams', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      mockDocsService.getDocument
        .mockResolvedValueOnce({ body: { content: [{ endIndex: 1 }] } })
        .mockResolvedValue({ body: { content: [] } });
      mockDocsService.extractPlainText
        .mockReturnValueOnce('')
        .mockReturnValue('');
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

  // ── API request structure validation ──────────────────────────────
  //
  // These tests verify that the full pipeline produces batch update
  // requests whose structure matches the Google Docs API specification.
  // This catches wrong field names, missing required properties, and
  // invalid enum values that would cause 400 errors at runtime.

  describe('API request structure validation', () => {
    // Valid named style types per Google Docs API v1
    const VALID_NAMED_STYLES = new Set([
      'NAMED_STYLE_TYPE_UNSPECIFIED',
      'NORMAL_TEXT',
      'TITLE',
      'SUBTITLE',
      'HEADING_1', 'HEADING_2', 'HEADING_3',
      'HEADING_4', 'HEADING_5', 'HEADING_6',
    ]);

    const VALID_BULLET_PRESETS = new Set([
      'BULLET_DISC_CIRCLE_SQUARE',
      'BULLET_DIAMONDX_ARROW3D_SQUARE',
      'BULLET_CHECKBOX',
      'BULLET_ARROW_DIAMOND_DISC',
      'BULLET_STAR_CIRCLE_SQUARE',
      'BULLET_ARROW3D_CIRCLE_SQUARE',
      'BULLET_LEFTTRIANGLE_DIAMOND_DISC',
      'BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE',
      'BULLET_DIAMOND_CIRCLE_SQUARE',
      'NUMBERED_DECIMAL_ALPHA_ROMAN',
      'NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS',
      'NUMBERED_DECIMAL_NESTED',
      'NUMBERED_UPPERALPHA_ALPHA_ROMAN',
      'NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL',
      'NUMBERED_ZERODECIMAL_ALPHA_ROMAN',
    ]);

    function validateRequest(req: any): string[] {
      const errors: string[] = [];
      const type = Object.keys(req as Record<string, unknown>)[0];

      switch (type) {
        case 'insertText': {
          const r = req.insertText;
          if (typeof r.text !== 'string') errors.push('insertText.text must be string');
          if (!r.location || typeof r.location.index !== 'number')
            errors.push('insertText.location.index must be number');
          break;
        }
        case 'insertInlineImage': {
          const r = req.insertInlineImage;
          if (typeof r.uri !== 'string') errors.push('insertInlineImage.uri must be string');
          if (!r.location || typeof r.location.index !== 'number')
            errors.push('insertInlineImage.location.index must be number');
          if (r.objectSize) {
            if (r.objectSize.width && r.objectSize.width.unit !== 'PT')
              errors.push('objectSize.width.unit must be PT');
            if (r.objectSize.height && r.objectSize.height.unit !== 'PT')
              errors.push('objectSize.height.unit must be PT');
          }
          break;
        }
        case 'updateParagraphStyle': {
          const r = req.updateParagraphStyle;
          if (!r.range || typeof r.range.startIndex !== 'number' || typeof r.range.endIndex !== 'number')
            errors.push('updateParagraphStyle.range must have startIndex and endIndex');
          if (!r.paragraphStyle) errors.push('updateParagraphStyle.paragraphStyle is required');
          if (!r.fields || typeof r.fields !== 'string') errors.push('updateParagraphStyle.fields is required');
          if (r.paragraphStyle?.namedStyleType && !VALID_NAMED_STYLES.has(r.paragraphStyle.namedStyleType as string))
            errors.push(`Invalid namedStyleType: ${r.paragraphStyle.namedStyleType}`);
          if (r.paragraphStyle?.indentStart) {
            if (r.paragraphStyle.indentStart.unit !== 'PT')
              errors.push('indentStart.unit must be PT');
          }
          break;
        }
        case 'updateTextStyle': {
          const r = req.updateTextStyle;
          if (!r.range || typeof r.range.startIndex !== 'number' || typeof r.range.endIndex !== 'number')
            errors.push('updateTextStyle.range must have startIndex and endIndex');
          if (r.range && r.range.startIndex >= r.range.endIndex)
            errors.push(`updateTextStyle range is empty or inverted: [${r.range.startIndex}, ${r.range.endIndex})`);
          if (!r.textStyle) errors.push('updateTextStyle.textStyle is required');
          if (!r.fields || typeof r.fields !== 'string') errors.push('updateTextStyle.fields is required');
          break;
        }
        case 'createParagraphBullets': {
          const r = req.createParagraphBullets;
          if (!r.range || typeof r.range.startIndex !== 'number' || typeof r.range.endIndex !== 'number')
            errors.push('createParagraphBullets.range must have startIndex and endIndex');
          if (!VALID_BULLET_PRESETS.has(r.bulletPreset as string))
            errors.push(`Invalid bulletPreset: ${r.bulletPreset}`);
          break;
        }
        case 'deleteContentRange': {
          const r = req.deleteContentRange;
          if (!r.range || typeof r.range.startIndex !== 'number' || typeof r.range.endIndex !== 'number')
            errors.push('deleteContentRange.range must have startIndex and endIndex');
          break;
        }
        case 'insertTable': {
          const r = req.insertTable;
          if (typeof r.rows !== 'number' || r.rows < 1)
            errors.push('insertTable.rows must be positive number');
          if (typeof r.columns !== 'number' || r.columns < 1)
            errors.push('insertTable.columns must be positive number');
          break;
        }
        default:
          errors.push(`Unknown request type: ${type}`);
      }
      return errors;
    }

    it('should produce valid API requests for a full-featured markdown document', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      const emptyDoc = { body: { content: [{ endIndex: 1 }] } };
      mockDocsService.getDocument
        .mockResolvedValueOnce(emptyDoc)
        .mockResolvedValueOnce(emptyDoc)
        .mockResolvedValue({ body: { content: [] } });
      mockDocsService.extractPlainText
        .mockReturnValueOnce('')
        .mockReturnValue('content');

      const markdown = [
        '# Document Title',
        '',
        '## Section Heading',
        '',
        '### Subsection',
        '',
        'A paragraph with **bold**, *italic*, and `inline code`.',
        '',
        '- Bullet item 1',
        '- Bullet item 2',
        '  - Nested bullet',
        '',
        '1. Ordered item',
        '2. Another item',
        '',
        '```javascript',
        'const x = 42;',
        '```',
        '',
        '> A blockquote',
        '',
        '---',
        '',
        '| Header A | Header B |',
        '|----------|----------|',
        '| Cell 1   | Cell 2   |',
        '',
        'Final paragraph with a [link](https://example.com).',
      ].join('\n');

      const result = await syncService.sync('/test/file.md', 'doc-123', markdown);
      expect(result.success).toBe(true);

      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
      expect(requests.length).toBeGreaterThan(0);

      // Validate every request against API spec
      const allErrors: string[] = [];
      for (let i = 0; i < requests.length; i++) {
        const errors = validateRequest(requests[i]);
        for (const err of errors) {
          allErrors.push(`Request[${i}]: ${err}`);
        }
      }
      expect(allErrors).toEqual([]);
    });

    it('should map heading levels correctly: h1→TITLE, h2→HEADING_1, etc.', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      const emptyDoc = { body: { content: [{ endIndex: 1 }] } };
      mockDocsService.getDocument
        .mockResolvedValueOnce(emptyDoc)
        .mockResolvedValueOnce(emptyDoc)
        .mockResolvedValue({ body: { content: [] } });
      mockDocsService.extractPlainText
        .mockReturnValueOnce('')
        .mockReturnValue('text');

      const markdown = [
        '# Title Level',
        '## Heading 1 Level',
        '### Heading 2 Level',
        '#### Heading 3 Level',
        '##### Heading 4 Level',
        '###### Heading 5 Level',
      ].join('\n');

      const result = await syncService.sync('/test/file.md', 'doc-123', markdown);
      expect(result.success).toBe(true);

      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];
      const headingRequests = requests.filter((r: any) =>
        r.updateParagraphStyle?.paragraphStyle?.namedStyleType
      );

      const styles = headingRequests.map((r: any) =>
        r.updateParagraphStyle.paragraphStyle.namedStyleType
      );

      expect(styles).toContain('TITLE');
      expect(styles).toContain('HEADING_1');
      expect(styles).toContain('HEADING_2');
      expect(styles).toContain('HEADING_3');
      expect(styles).toContain('HEADING_4');
      expect(styles).toContain('HEADING_5');
      expect(styles).not.toContain('HEADING_6'); // h6 maps to HEADING_5
    });

    it('should produce valid formatting requests during diff-based sync', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      // Set up baseline from a "previous sync"
      const originalText = 'Hello world\n';
      await linkStore.saveBaseline('doc-123', originalText);
      await linkStore.setLink('/test/file.md', 'doc-123');

      // Current doc matches baseline (no external edits)
      mockDocsService.getDocument
        .mockResolvedValueOnce({
          body: {
            content: [{
              paragraph: { elements: [{ textRun: { content: 'Hello world\n' } }] },
              startIndex: 1,
              endIndex: 13,
            }],
          },
        })
        // After text diff, doc has new content
        .mockResolvedValue({
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: 'New Title\n' } }],
                },
                startIndex: 1,
                endIndex: 11,
              },
              {
                paragraph: {
                  elements: [{ textRun: { content: 'Hello universe\n' } }],
                },
                startIndex: 11,
                endIndex: 26,
              },
            ],
          },
        });
      mockDocsService.extractPlainText
        .mockReturnValueOnce('Hello world\n')
        .mockReturnValue('New Title\nHello universe\n');

      // Change from plain text to heading + modified text
      const result = await syncService.sync(
        '/test/file.md',
        'doc-123',
        '# New Title\n\nHello universe',
      );

      expect(result.success).toBe(true);

      // Validate all batch updates
      for (const call of mockDocsService.batchUpdate.mock.calls) {
        const requests: any[] = call[1];
        const allErrors: string[] = [];
        for (let i = 0; i < requests.length; i++) {
          const errors = validateRequest(requests[i]);
          for (const err of errors) {
            allErrors.push(`Request[${i}]: ${err}`);
          }
        }
        expect(allErrors).toEqual([]);
      }

      // Verify formatting was applied (second batchUpdate call)
      const formattingRequests: any[] = mockDocsService.batchUpdate.mock.calls[1]?.[1] ?? [];
      const titleStyle = formattingRequests.find((r: any) =>
        r.updateParagraphStyle?.paragraphStyle?.namedStyleType === 'TITLE'
      );
      expect(titleStyle).toBeDefined();
    });

    it('should produce valid requests for mermaid diagram with image and edit link', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      const emptyDoc = { body: { content: [{ endIndex: 1 }] } };
      mockDocsService.getDocument
        .mockResolvedValueOnce(emptyDoc)
        .mockResolvedValueOnce(emptyDoc)
        .mockResolvedValue({ body: { content: [] } });
      mockDocsService.extractPlainText
        .mockReturnValueOnce('')
        .mockReturnValue('\nEdit in Mermaid Live\n');
      mockDocsService.uploadImage.mockResolvedValue('drive-file-999');

      const markdown = '```mermaid\ngraph TD\n  A --> B\n  B --> C\n```';
      const mermaidDiagrams = [{
        code: 'graph TD\n  A --> B\n  B --> C',
        pngBase64: 'iVBORw0KGgoAAAANSUhEUg==',
        liveUrl: 'https://mermaid.live/edit#pako:xyz',
      }];

      const result = await syncService.sync(
        '/test/file.md',
        'doc-123',
        markdown,
        mermaidDiagrams,
      );

      expect(result.success).toBe(true);

      const requests: any[] = mockDocsService.batchUpdate.mock.calls[0]![1];

      // Validate all requests
      const allErrors: string[] = [];
      for (let i = 0; i < requests.length; i++) {
        const errors = validateRequest(requests[i]);
        for (const err of errors) {
          allErrors.push(`Request[${i}]: ${err}`);
        }
      }
      expect(allErrors).toEqual([]);

      // Verify the image was inserted
      const imageReqs = requests.filter((r: any) => r.insertInlineImage);
      expect(imageReqs.length).toBe(1);
      expect(imageReqs[0].insertInlineImage.uri).toContain('drive.google.com');

      // Verify the "Edit in Mermaid Live" link was added
      const linkStyles = requests.filter((r: any) =>
        r.updateTextStyle?.textStyle?.link?.url?.includes('mermaid.live')
      );
      expect(linkStyles.length).toBe(1);
    });
  });
});
