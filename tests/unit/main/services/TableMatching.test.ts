import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import type { GDocsApiDocument, GDocsStructuralElement } from '@shared/types/google-docs';

vi.mock('@main/services/MarkdownToDocsConverter', () => ({
  convertMarkdownToDocs: vi.fn(),
}));

import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

/** A one-cell table holding `text`, occupying [start, end). */
function table(text: string, start: number, end: number): GDocsStructuralElement {
  return {
    startIndex: start,
    endIndex: end,
    table: {
      rows: 1,
      columns: 1,
      tableRows: [{
        tableCells: [{
          content: [{
            startIndex: start + 2,
            endIndex: start + 2 + text.length + 1,
            paragraph: {
              elements: [{
                startIndex: start + 2,
                endIndex: start + 2 + text.length + 1,
                textRun: { content: `${text}\n` },
              }],
            },
          }],
        }],
      }],
    },
  };
}

/** A one-column table with a row per entry, occupying [start, end). */
function tableWithRows(texts: string[], start: number, end: number): GDocsStructuralElement {
  let at = start + 2;
  return {
    startIndex: start,
    endIndex: end,
    table: {
      rows: texts.length,
      columns: 1,
      tableRows: texts.map((text) => {
        const from = at;
        at += text.length + 3;
        return {
          tableCells: [{
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
          }],
        };
      }),
    },
  };
}

const C_START = 40;
const C_END = 70;

/** The Doc after someone deleted the middle table: A and C survive. */
function docMissingMiddleTable(): GDocsApiDocument {
  return { body: { content: [table('A', 1, 30), table('C', C_START, C_END)] } };
}

describe('matching the Doc\'s tables against the file\'s', () => {
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

  function requests(): Array<Record<string, { range?: { startIndex: number; endIndex: number } }>> {
    return mockDocsService.batchUpdate.mock.calls.flatMap((call) => (call[1] ?? []) as never[]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = createGoogleDocsSyncService(
      mockDocsService as unknown as Parameters<typeof createGoogleDocsSyncService>[0],
      mockLinkStore as unknown as Parameters<typeof createGoogleDocsSyncService>[1],
    );
    mockDocsService.getDocument.mockResolvedValue(docMissingMiddleTable());
    mockDocsService.batchUpdate.mockResolvedValue({});
    mockDocsService.extractPlainText.mockReturnValue('A\nC\n');
    // The file still has all three, in order.
    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [
        { type: 'table', rows: [[[{ text: 'A' }]]] },
        { type: 'table', rows: [[[{ text: 'B' }]]] },
        { type: 'table', rows: [[[{ text: 'C' }]]] },
      ],
    });
  });

  it('leaves a surviving table alone when an earlier one was deleted', async () => {
    // Tables were paired off by position, so deleting the middle one shifted
    // every table after it: the Doc's C was compared against the file's B,
    // rewritten into B, and C was appended at the end. The user sees the
    // deleted table come back in the wrong place and the survivor mangled.
    await syncService.syncForceOverwrite('/file.md', 'doc-1', 'markdown');

    const touchingC = requests().filter((r) => {
      const range = r['deleteContentRange']?.range;
      return range != null && range.startIndex < C_END && range.endIndex > C_START;
    });
    expect(touchingC).toEqual([]);
  });

  it('still matches a table whose own rows changed, when one before it went', async () => {
    // Both at once, which is what was actually reported: a table deleted and
    // a row removed from another. The survivor no longer matches byte for
    // byte, so pairing on exact content would shift it onto the wrong twin
    // just as pairing on ordinal did.
    mockDocsService.getDocument.mockResolvedValue({
      body: { content: [table('A', 1, 30), tableWithRows(['C', 'C2'], C_START, C_END)] },
    });
    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [
        { type: 'table', rows: [[[{ text: 'A' }]]] },
        { type: 'table', rows: [[[{ text: 'B' }]]] },
        { type: 'table', rows: [[[{ text: 'C' }]], [[{ text: 'C2' }]], [[{ text: 'C3' }]]] },
      ],
    });

    await syncService.syncForceOverwrite('/file.md', 'doc-1', 'markdown');

    // C keeps its identity: it is grown by a row, never deleted and rebuilt.
    const touchingC = requests().filter((r) => {
      const range = r['deleteContentRange']?.range;
      return range != null && range.startIndex < C_END && range.endIndex > C_START;
    });
    expect(touchingC).toEqual([]);
    expect(requests().some((r) => r['insertTableRow'] != null)).toBe(true);
  });

  it('leaves a surviving diagram alone when an earlier one was deleted', async () => {
    // Diagrams were paired by ordinal too, so the same shift applies: delete
    // the first and the second is rewritten into it. An image block is the
    // picture's paragraph plus the mermaid.live link paragraph under it.
    const diagram = (url: string, start: number): GDocsStructuralElement[] => [
      {
        startIndex: start,
        endIndex: start + 1,
        paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: url } }] },
      },
      {
        startIndex: start + 1,
        endIndex: start + 20,
        paragraph: {
          elements: [{ textRun: { content: 'Edit\n', textStyle: { link: { url } } } }],
        },
      },
    ];
    const B_START = 1;
    const B_END = 21;

    mockDocsService.getDocument.mockResolvedValue({
      body: { content: diagram('https://mermaid.live/b', B_START) },
    });
    mockDocsService.extractPlainText.mockReturnValue('Edit\n');
    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [
        { type: 'image', imageLink: 'a.png', mermaidLiveUrl: 'https://mermaid.live/a' },
        { type: 'image', imageLink: 'b.png', mermaidLiveUrl: 'https://mermaid.live/b' },
      ],
    });

    await syncService.syncForceOverwrite('/file.md', 'doc-1', 'markdown');

    const rebuiltB = requests().filter((r) => {
      const range = r['deleteContentRange']?.range;
      return range != null && range.startIndex === B_START && range.endIndex === B_END;
    });
    expect(rebuiltB).toEqual([]);
  });
});
