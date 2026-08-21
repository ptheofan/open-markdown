import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import type { GDocsApiDocument, GDocsStructuralElement } from '@shared/types/google-docs';

vi.mock('@main/services/MarkdownToDocsConverter', () => ({
  convertMarkdownToDocs: vi.fn(),
}));

import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

/** A two-column table, indices laid out the way the API reports them. */
function tableOf(rows: string[][], start: number): GDocsStructuralElement {
  let at = start + 1;
  return {
    startIndex: start,
    endIndex: start + 500,
    table: {
      rows: rows.length,
      columns: 2,
      tableRows: rows.map((cells) => ({
        tableCells: cells.map((text) => {
          const from = at;
          at += text.length + 2;
          return {
            content: [{
              startIndex: from,
              endIndex: from + text.length + 1,
              paragraph: {
                elements: [{
                  startIndex: from,
                  endIndex: from + text.length + 1,
                  textRun: { content: `${text}\n` },
                }],
              },
            }],
          };
        }),
      })),
    },
  };
}

const HEADER = ['Module', 'Changes'];
const MISSING = ['group-suggestion-service', 'New package'];
const KEPT = ['testlio/', 'New CDC producers'];

describe('a row deleted from a table in the Doc', () => {
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
  let rowInserted = false;

  function allRequests(): Array<Record<string, unknown>> {
    return mockDocsService.batchUpdate.mock.calls.flatMap((c) => (c[1] ?? []) as never[]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    rowInserted = false;
    syncService = createGoogleDocsSyncService(
      mockDocsService as unknown as Parameters<typeof createGoogleDocsSyncService>[0],
      mockLinkStore as unknown as Parameters<typeof createGoogleDocsSyncService>[1],
    );

    // The Doc reflects the insert once it has happened, the way the API
    // would: a blank row appears where it was asked for.
    const doc = (): GDocsApiDocument => ({
      body: {
        content: [tableOf(
          rowInserted ? [HEADER, ['', ''], KEPT] : [HEADER, KEPT],
          1,
        )],
      },
    });
    mockDocsService.getDocument.mockImplementation(() => Promise.resolve(doc()));
    mockDocsService.batchUpdate.mockImplementation((_id: string, reqs: Array<Record<string, unknown>>) => {
      if (reqs.some((r) => r['insertTableRow'] != null)) rowInserted = true;
      return Promise.resolve({});
    });
    mockDocsService.extractPlainText.mockReturnValue('Module\nChanges\ntestlio/\n');

    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [{
        type: 'table',
        rows: [HEADER, MISSING, KEPT].map((r) => r.map((t) => [{ text: t }])),
      }],
    });
  });

  it('puts the row back where it belongs, not at the bottom', async () => {
    // Appending it and shifting every row's text up by one is what moved the
    // comments: they anchor to text ranges, so a row whose text is rewritten
    // keeps the comment that belonged to what used to be there.
    await syncService.syncForceOverwrite('/file.md', 'doc-1', 'markdown');

    const inserts = allRequests()
      .map((r) => r['insertTableRow'] as { tableCellLocation?: { rowIndex?: number }; insertBelow?: boolean } | undefined)
      .filter((r) => r != null);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.tableCellLocation?.rowIndex).toBe(1);
    expect(inserts[0]?.insertBelow).toBe(false);
  });

  it('leaves the surviving row\'s text alone, so its comments stay put', async () => {
    await syncService.syncForceOverwrite('/file.md', 'doc-1', 'markdown');

    const written = allRequests()
      .map((r) => (r['insertText'] as { text?: string } | undefined)?.text ?? '')
      .join('');
    // Only the blank row needs filling. Rewriting the row that was never
    // touched is what detaches its comments.
    expect(written).not.toContain('testlio');
  });
});
