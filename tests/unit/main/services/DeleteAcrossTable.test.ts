import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import type { GDocsApiDocument } from '@shared/types/google-docs';

vi.mock('@main/services/MarkdownToDocsConverter', () => ({
  convertMarkdownToDocs: vi.fn(),
}));

import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

// A paragraph, a table, another paragraph. extractApiParagraphs skips the
// table, so the two paragraphs sit next to each other in the list while a
// whole table separates them in the document.
const TABLE_START = 17;
const TABLE_END = 100;

function docWithTableBetweenParagraphs(): GDocsApiDocument {
  return {
    body: {
      content: [
        {
          startIndex: 1,
          endIndex: TABLE_START,
          paragraph: {
            elements: [
              { startIndex: 1, endIndex: TABLE_START, textRun: { content: 'First paragraph\n' } },
            ],
          },
        },
        {
          startIndex: TABLE_START,
          endIndex: TABLE_END,
          table: {
            rows: 1,
            columns: 1,
            tableRows: [{
              tableCells: [{
                content: [{
                  startIndex: 19,
                  endIndex: 25,
                  paragraph: { elements: [{ textRun: { content: 'cell\n' } }] },
                }],
              }],
            }],
          },
        },
        {
          startIndex: TABLE_END,
          endIndex: 117,
          paragraph: {
            elements: [
              { startIndex: TABLE_END, endIndex: 117, textRun: { content: 'Third paragraph\n' } },
            ],
          },
        },
      ],
    },
  };
}

describe('deleting paragraphs that a table sits between', () => {
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

  function deletedRanges(): Array<{ startIndex: number; endIndex: number }> {
    return mockDocsService.batchUpdate.mock.calls.flatMap(
      (call) => (call[1] as Array<{ deleteContentRange?: { range: { startIndex: number; endIndex: number } } }>)
        .filter((r) => r.deleteContentRange)
        .map((r) => r.deleteContentRange!.range),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = createGoogleDocsSyncService(
      mockDocsService as unknown as Parameters<typeof createGoogleDocsSyncService>[0],
      mockLinkStore as unknown as Parameters<typeof createGoogleDocsSyncService>[1],
    );
    mockDocsService.getDocument.mockResolvedValue(docWithTableBetweenParagraphs());
    mockDocsService.extractPlainText.mockReturnValue('First paragraph\nThird paragraph\n');
    mockDocsService.batchUpdate.mockResolvedValue({});
    // Both paragraphs rewritten, the table left as it was.
    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [
        { type: 'paragraph', runs: [{ text: 'A totally different line' }] },
        { type: 'table', rows: [[[{ text: 'cell' }]]] },
        { type: 'paragraph', runs: [{ text: 'Another different line' }] },
      ],
    });
  });

  it('never emits a delete that reaches across the table', async () => {
    // Google rejects this outright: "Deleting the newline character before a
    // Table without deleting the element" and "Deleting the start or end of a
    // Table without deleting the entire element" are both invalid, and the
    // whole batch fails with a 400.
    await syncService.syncForceOverwrite('/file.md', 'doc-1', 'markdown');

    const spanning = deletedRanges().filter(
      (r) => r.startIndex < TABLE_START && r.endIndex > TABLE_START,
    );
    expect(spanning).toEqual([]);
  });

  it('still removes both paragraphs, one range each side of the table', async () => {
    await syncService.syncForceOverwrite('/file.md', 'doc-1', 'markdown');

    const ranges = deletedRanges();
    expect(ranges.some((r) => r.startIndex === 1 && r.endIndex <= TABLE_START)).toBe(true);
    expect(ranges.some((r) => r.startIndex === TABLE_END)).toBe(true);
  });
});
