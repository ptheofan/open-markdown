/**
 * A table or diagram added in the middle of the markdown must land in the
 * middle of the Doc, not be appended to the end of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import { createGoogleDocsLinkStore, type GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import type { GoogleDocsService } from '@main/services/GoogleDocsService';
import type { GDocsApiDocument } from '@shared/types/google-docs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-userdata' },
}));

const INTRO_END = 7;   // "Intro\n" occupies 1..7
const BODY_END = 13;   // "Outro\n" occupies 7..13

/** Two plain paragraphs with nothing between them. */
function twoParagraphDoc(): GDocsApiDocument {
  return {
    body: {
      content: [
        {
          startIndex: 1,
          endIndex: INTRO_END,
          paragraph: { elements: [{ startIndex: 1, endIndex: INTRO_END, textRun: { content: 'Intro\n' } }] },
        },
        {
          startIndex: INTRO_END,
          endIndex: BODY_END,
          paragraph: { elements: [{ startIndex: INTRO_END, endIndex: BODY_END, textRun: { content: 'Outro\n' } }] },
        },
      ],
    },
  };
}

describe('placing a newly added structural element', () => {
  let linkStore: GoogleDocsLinkStore;
  let tempDir: string;

  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  const PLAIN = 'Intro\nOutro\n';

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-pos-test-'));
    linkStore = createGoogleDocsLinkStore(tempDir);
    await linkStore.initialize();
    mockDocsService.batchUpdate.mockResolvedValue({ replies: [] });
    mockDocsService.uploadImage.mockResolvedValue('drive-file-id');
    mockDocsService.getDocument.mockResolvedValue(twoParagraphDoc());
    mockDocsService.extractPlainText.mockReturnValue(PLAIN);
    await linkStore.saveBaseline('doc-1', PLAIN);
    await linkStore.setLink('/test/file.md', 'doc-1');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function service(): ReturnType<typeof createGoogleDocsSyncService> {
    return createGoogleDocsSyncService(
      mockDocsService as unknown as GoogleDocsService,
      linkStore,
    );
  }

  function requests(): Array<Record<string, unknown>> {
    return mockDocsService.batchUpdate.mock.calls.flatMap(
      ([, reqs]) => (reqs ?? []) as Array<Record<string, unknown>>,
    );
  }

  it('inserts a new table between the paragraphs that surround it', async () => {
    const markdown = 'Intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nOutro\n';

    await service().sync('/test/file.md', 'doc-1', markdown);

    const inserts = requests().flatMap((r) =>
      'insertTable' in r ? [(r as { insertTable: { location: { index: number } } }).insertTable] : []);

    expect(inserts).toHaveLength(1);
    // Right after "Intro", not at the end of the body.
    expect(inserts[0]?.location.index).toBe(INTRO_END);
    expect(inserts[0]?.location.index).not.toBe(BODY_END - 1);
  });

  it('inserts a new diagram between the paragraphs that surround it', async () => {
    const markdown = 'Intro\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nOutro\n';
    const diagrams = [{ code: 'graph TD\n  A-->B', pngBase64: 'AAA', liveUrl: 'https://mermaid.live/x' }];

    await service().sync('/test/file.md', 'doc-1', markdown, diagrams);

    const inserts = requests().flatMap((r) =>
      'insertInlineImage' in r
        ? [(r as { insertInlineImage: { location: { index: number } } }).insertInlineImage]
        : []);

    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts[0]?.location.index).toBe(INTRO_END);
  });

  it('anchors to the right one when the same line appears twice', async () => {
    // A document repeating a heading ("Notes") must anchor to the occurrence
    // the markdown actually put the table after, not the first one.
    const repeated: GDocsApiDocument = {
      body: {
        content: [
          { startIndex: 1, endIndex: 7,
            paragraph: { elements: [{ startIndex: 1, endIndex: 7, textRun: { content: 'Notes\n' } }] } },
          { startIndex: 7, endIndex: 14,
            paragraph: { elements: [{ startIndex: 7, endIndex: 14, textRun: { content: 'Middle\n' } }] } },
          { startIndex: 14, endIndex: 20,
            paragraph: { elements: [{ startIndex: 14, endIndex: 20, textRun: { content: 'Notes\n' } }] } },
          { startIndex: 20, endIndex: 24,
            paragraph: { elements: [{ startIndex: 20, endIndex: 24, textRun: { content: 'End\n' } }] } },
        ],
      },
    };
    mockDocsService.getDocument.mockResolvedValue(repeated);
    mockDocsService.extractPlainText.mockReturnValue('Notes\nMiddle\nNotes\nEnd\n');
    await linkStore.saveBaseline('doc-1', 'Notes\nMiddle\nNotes\nEnd\n');

    await service().sync(
      '/test/file.md', 'doc-1',
      'Notes\n\nMiddle\n\nNotes\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd\n',
    );

    const inserts = requests().flatMap((r) =>
      'insertTable' in r ? [(r as { insertTable: { location: { index: number } } }).insertTable] : []);

    expect(inserts).toHaveLength(1);
    // End of the SECOND "Notes" (index 20), not the first (index 7).
    expect(inserts[0]?.location.index).toBe(20);
  });

  it('still appends when the element belongs at the end', async () => {
    const markdown = 'Intro\n\nOutro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';

    await service().sync('/test/file.md', 'doc-1', markdown);

    const inserts = requests().flatMap((r) =>
      'insertTable' in r ? [(r as { insertTable: { location: { index: number } } }).insertTable] : []);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.location.index).toBe(BODY_END - 1);
  });
});
