/**
 * Tests for structural element sync (tables and mermaid images)
 * during incremental diff.
 *
 * Verifies that syncStructuralElements correctly detects changed tables
 * and images, deletes old ones, and re-inserts new ones at the correct
 * positions — all while leaving unchanged structural elements alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import { createGoogleDocsLinkStore, type GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import type { GoogleDocsService } from '@main/services/GoogleDocsService';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-userdata' },
}));

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('Structural element sync', () => {
  let linkStore: GoogleDocsLinkStore;
  let tempDir: string;

  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-struct-test-'));
    linkStore = createGoogleDocsLinkStore(tempDir);
    await linkStore.initialize();
    mockDocsService.batchUpdate.mockResolvedValue({ replies: [] });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('table sync', () => {
    it('should detect and replace a table whose content changed', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      // Set up baseline from previous sync
      const baselineText = 'Title\nOld A\nOld B\n';
      await linkStore.saveBaseline('doc-123', baselineText);
      await linkStore.setLink('/test/file.md', 'doc-123');

      // Current API doc has: paragraph, table with "Old A\nOld B\n", paragraph
      const apiDocWithTable = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Title\n' } }],
              },
              startIndex: 1,
              endIndex: 7,
            },
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        content: [{
                          paragraph: {
                            elements: [{ textRun: { content: 'Old A\n' } }],
                          },
                        }],
                      },
                    ],
                  },
                  {
                    tableCells: [
                      {
                        content: [{
                          paragraph: {
                            elements: [{ textRun: { content: 'Old B\n' } }],
                          },
                        }],
                      },
                    ],
                  },
                ],
              },
              startIndex: 7,
              endIndex: 30,
            },
          ],
        },
      };

      mockDocsService.getDocument.mockResolvedValue(apiDocWithTable);
      mockDocsService.extractPlainText
        .mockReturnValueOnce(baselineText)  // sync check
        .mockReturnValue('Title\nNew A\nNew B\n');

      // Markdown with changed table
      const markdown = '# Title\n\n| Col |\n|---|\n| New A |\n| New B |';

      const result = await syncService.sync('/test/file.md', 'doc-123', markdown);
      expect(result.success).toBe(true);

      // Should have called batchUpdate with deleteContentRange for the old table
      const allCalls = mockDocsService.batchUpdate.mock.calls;
      const hasTableDelete = allCalls.some((call: any) => {
        const requests = call[1] as any[];
        return requests.some((r: any) =>
          r.deleteContentRange?.range?.startIndex === 7 &&
          r.deleteContentRange?.range?.endIndex === 30
        );
      });
      expect(hasTableDelete).toBe(true);

      // Should have called batchUpdate with insertTable
      const hasInsertTable = allCalls.some((call: any) => {
        const requests = call[1] as any[];
        return requests.some((r: any) => r.insertTable);
      });
      expect(hasInsertTable).toBe(true);
    });

    it('should skip unchanged tables', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      const baselineText = 'Hello\nCol\nCell A\nCell B\n';
      await linkStore.saveBaseline('doc-123', baselineText);
      await linkStore.setLink('/test/file.md', 'doc-123');

      const apiDoc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Hello\n' } }],
              },
              startIndex: 1,
              endIndex: 7,
            },
            {
              table: {
                tableRows: [
                  {
                    tableCells: [{
                      content: [{
                        paragraph: {
                          elements: [{ textRun: { content: 'Col\n' } }],
                        },
                      }],
                    }],
                  },
                  {
                    tableCells: [{
                      content: [{
                        paragraph: {
                          elements: [{ textRun: { content: 'Cell A\n' } }],
                        },
                      }],
                    }],
                  },
                  {
                    tableCells: [{
                      content: [{
                        paragraph: {
                          elements: [{ textRun: { content: 'Cell B\n' } }],
                        },
                      }],
                    }],
                  },
                ],
              },
              startIndex: 7,
              endIndex: 30,
            },
          ],
        },
      };

      mockDocsService.getDocument.mockResolvedValue(apiDoc);
      mockDocsService.extractPlainText.mockReturnValue(baselineText);

      // Same content — table hasn't changed
      const markdown = 'Hello\n\n| Col |\n|---|\n| Cell A |\n| Cell B |';

      const result = await syncService.sync('/test/file.md', 'doc-123', markdown);
      expect(result.success).toBe(true);

      // Should NOT have any deleteContentRange for the table
      const allCalls = mockDocsService.batchUpdate.mock.calls;
      const hasTableDelete = allCalls.some((call: any) => {
        const requests = call[1] as any[];
        return requests.some((r: any) =>
          r.deleteContentRange?.range?.startIndex === 7 &&
          r.deleteContentRange?.range?.endIndex === 30
        );
      });
      expect(hasTableDelete).toBe(false);
    });
  });

  describe('image sync', () => {
    it('should detect and replace a mermaid diagram whose code changed', async () => {
      const syncService = createGoogleDocsSyncService(
        mockDocsService as unknown as GoogleDocsService,
        linkStore,
      );

      const baselineText = 'Title\n\nEdit in Mermaid Live\n';
      await linkStore.saveBaseline('doc-123', baselineText);
      await linkStore.setLink('/test/file.md', 'doc-123');

      // API doc has: paragraph + image paragraph + link paragraph
      const apiDoc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Title\n' } }],
              },
              startIndex: 1,
              endIndex: 7,
            },
            {
              paragraph: {
                elements: [
                  { inlineObjectElement: { inlineObjectId: 'img-1' } },
                ],
              },
              startIndex: 7,
              endIndex: 9,
            },
            {
              paragraph: {
                elements: [{
                  textRun: {
                    content: 'Edit in Mermaid Live\n',
                    textStyle: {
                      link: { url: 'https://mermaid.live/edit#pako:OLD' },
                    },
                  },
                }],
              },
              startIndex: 9,
              endIndex: 30,
            },
          ],
        },
      };

      mockDocsService.getDocument.mockResolvedValue(apiDoc);
      mockDocsService.extractPlainText.mockReturnValue(baselineText);
      mockDocsService.uploadImage.mockResolvedValue('new-drive-file-id');

      // Markdown with changed mermaid diagram
      const markdown = '# Title\n\n```mermaid\ngraph TD\n  X --> Y\n```';
      const mermaidDiagrams = [{
        code: 'graph TD\n  X --> Y',
        pngBase64: 'iVBORw0KGgoAAAANSUhEUg==',
        liveUrl: 'https://mermaid.live/edit#pako:NEW',
      }];

      const result = await syncService.sync(
        '/test/file.md',
        'doc-123',
        markdown,
        mermaidDiagrams,
      );

      expect(result.success).toBe(true);

      // Should have deleted the old image block (indices 7-30)
      const allCalls = mockDocsService.batchUpdate.mock.calls;
      const hasImageDelete = allCalls.some((call: any) => {
        const requests = call[1] as any[];
        return requests.some((r: any) =>
          r.deleteContentRange?.range?.startIndex === 7
        );
      });
      expect(hasImageDelete).toBe(true);

      // Should have inserted a new inline image
      const hasInsertImage = allCalls.some((call: any) => {
        const requests = call[1] as any[];
        return requests.some((r: any) =>
          r.insertInlineImage?.uri?.includes('drive.google.com')
        );
      });
      expect(hasInsertImage).toBe(true);
    });
  });
});
