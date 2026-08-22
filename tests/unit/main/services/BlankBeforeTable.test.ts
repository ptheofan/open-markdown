/**
 * Blank paragraphs in front of a table.
 *
 * Docs writes a newline ahead of every table it inserts, and emptying a
 * paragraph that precedes a table cannot take that paragraph's own newline
 * with it -- Google refuses to delete "the newline character before a Table"
 * unless the table goes too, and the table is what a comment-preserving sync
 * exists to protect. They are merged upward instead.
 *
 * What the document should end up with: one blank after body text, which
 * separates the two, and none after a heading, which already carries space
 * below it.
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

function para(text: string, startIndex: number, heading = false): Record<string, unknown> {
  return {
    startIndex,
    endIndex: startIndex + text.length,
    paragraph: {
      elements: [{ textRun: { content: text } }],
      ...(heading && { paragraphStyle: { namedStyleType: 'HEADING_1' } }),
    },
  };
}

/** `above` (heading or prose), then `blanks` empty paragraphs, then a table. */
function docWith(above: string, blanks: number, heading = false): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [para(above, 1, heading)];
  let at = 1 + above.length;
  for (let i = 0; i < blanks; i++) {
    content.push(para('\n', at));
    at += 1;
  }
  content.push({
    startIndex: at,
    endIndex: at + 32,
    table: {
      tableRows: [
        { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'Col\n' } }] } }] }] },
      ],
    },
  });
  return { body: { content } };
}

describe('blank paragraphs in front of a table', () => {
  let linkStore: GoogleDocsLinkStore;
  let tempDir: string;

  const docsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-blank-test-'));
    linkStore = createGoogleDocsLinkStore(tempDir);
    await linkStore.initialize();
    docsService.batchUpdate.mockResolvedValue({ replies: [] });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function push(doc: Record<string, unknown>): Promise<Array<Record<string, any>>> {
    const service = createGoogleDocsSyncService(
      docsService as unknown as GoogleDocsService,
      linkStore,
    );

    const baseline = 'Intro\n\nCol\n';
    await linkStore.saveBaseline('doc-1', baseline);
    await linkStore.setLink('/test/file.md', 'doc-1');
    await linkStore.updateLastSynced('/test/file.md', '2026-01-01T00:00:00.000Z');

    docsService.getDocument.mockResolvedValue(doc);
    docsService.extractPlainText.mockReturnValue(baseline);

    await service.syncForceOverwrite('/test/file.md', 'doc-1', 'Intro\n\n| Col |\n|---|\n');

    return docsService.batchUpdate.mock.calls.flatMap(
      (call: any) => (call[1] ?? []) as Array<Record<string, any>>,
    );
  }

  /** Ranges the API rejects: the blank's own newline, immediately before the table. */
  function deletesAt(requests: Array<Record<string, any>>, start: number): boolean {
    return requests.some((r) => r['deleteContentRange']?.range?.startIndex === start);
  }

  it('takes the blank away after a heading, by merging it into the heading', async () => {
    // "Title\n" spans [1,7), so its newline is at 6. Deleting that merges the
    // blank into it, leaving the heading directly above the table.
    const requests = await push(docWith('Title\n', 1, true));

    expect(requests).toContainEqual({
      deleteContentRange: { range: { startIndex: 6, endIndex: 7 } },
    });
  });

  it('keeps the single blank that separates body text from a table', async () => {
    const requests = await push(docWith('Intro\n', 1));

    expect(requests).not.toContainEqual({
      deleteContentRange: { range: { startIndex: 6, endIndex: 7 } },
    });
  });

  it('collapses a doubled blank back to one', async () => {
    // Two blanks after prose: one too many, so one newline goes.
    const requests = await push(docWith('Intro\n', 2));

    expect(requests).toContainEqual({
      deleteContentRange: { range: { startIndex: 6, endIndex: 7 } },
    });
  });

  it('never deletes the newline that belongs to the table', async () => {
    // The blank immediately before the table starts at 7 in both shapes; that
    // is the range Google rejects unless the table is deleted with it.
    expect(deletesAt(await push(docWith('Title\n', 1, true)), 7)).toBe(false);
    expect(deletesAt(await push(docWith('Intro\n', 2)), 8)).toBe(false);
  });

  it('leaves a blank between two tables alone', async () => {
    // Nothing above it whose newline may be taken: a table ends in its own
    // undeletable boundary. Reaching for it fails the whole request --
    // "Cannot delete the requested range" against a real document.
    const doc = {
      body: {
        content: [
          {
            startIndex: 1,
            endIndex: 33,
            table: {
              tableRows: [
                { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'A\n' } }] } }] }] },
              ],
            },
          },
          para('\n', 33),
          {
            startIndex: 34,
            endIndex: 66,
            table: {
              tableRows: [
                { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'B\n' } }] } }] }] },
              ],
            },
          },
        ],
      },
    };

    const requests = await push(doc);

    expect(deletesAt(requests, 32)).toBe(false); // the first table's last index
    expect(deletesAt(requests, 33)).toBe(false); // the blank's own newline
  });
});
