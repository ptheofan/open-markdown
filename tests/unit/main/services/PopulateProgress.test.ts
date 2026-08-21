import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';

vi.mock('@main/services/MarkdownToDocsConverter', () => ({
  convertMarkdownToDocs: vi.fn(),
}));

import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

/** A doc holding the two table placeholders fullPopulate just inserted. */
function docWithPlaceholders(): unknown {
  const paragraph = (content: string, startIndex: number): Record<string, unknown> => ({
    startIndex,
    endIndex: startIndex + content.length,
    paragraph: { elements: [{ textRun: { content } }] },
  });
  return {
    body: {
      content: [
        paragraph('<<TABLE_0>>\n', 1),
        paragraph('<<TABLE_1>>\n', 13),
      ],
    },
  };
}

describe('filling a Doc that was empty', () => {
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
    // Empty body: this is the populate path, not the diff path.
    mockDocsService.getDocument
      .mockResolvedValueOnce({ body: { content: [{ endIndex: 1 }] } })
      .mockResolvedValueOnce({ body: { content: [{ endIndex: 1 }] } })
      .mockResolvedValue(docWithPlaceholders());
    mockDocsService.batchUpdate.mockResolvedValue({});
    mockDocsService.extractPlainText.mockReturnValue('');
    vi.mocked(convertMarkdownToDocs).mockReturnValue({
      elements: [
        { type: 'table', rows: [[[{ text: 'a' }]]] },
        { type: 'table', rows: [[[{ text: 'b' }]]] },
      ],
    });
  });

  it('reports each table as it builds them', async () => {
    // Emptying the Doc sends a push down fullPopulate, not applyDiff. Every
    // table there is its own round trip to Google, and reporting none of them
    // left the bar showing whatever the diagram pass last said.
    const seen: Array<{ percent: number; label: string }> = [];

    await syncService.resolve('/file.md', 'doc-1', 'apply', 'push', '| a |\n|---|\n', {
      onProgress: (u) => seen.push(u),
    });

    expect(seen.some((u) => /table 1 of 2/i.test(u.label))).toBe(true);
    expect(seen.some((u) => /table 2 of 2/i.test(u.label))).toBe(true);
    expect(seen.some((u) => u.percent > 70 && u.percent < 100)).toBe(true);
  });
});
