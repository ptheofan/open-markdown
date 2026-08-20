/**
 * A table whose text changed must be edited cell by cell, not rebuilt.
 *
 * Google Docs comments anchor to text ranges. Deleting a table to re-insert it
 * detaches every comment inside it, and tables are where review comments most
 * often live.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import { createGoogleDocsLinkStore, type GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import type { GoogleDocsService } from '@main/services/GoogleDocsService';
import type { GDocsApiDocument, GDocsTableCell } from '@shared/types/google-docs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-userdata' },
}));

const TABLE_START = 7;
const TABLE_END = 40;

/** One cell: a single paragraph carrying real Docs indices. */
function cell(text: string, start: number): GDocsTableCell {
  return {
    content: [{
      startIndex: start,
      endIndex: start + text.length,
      paragraph: {
        elements: [{ startIndex: start, endIndex: start + text.length, textRun: { content: text } }],
      },
    }],
  };
}

/** "Title" then a 2x2 table: H1 | H2 / a | b */
function docWithTable(): GDocsApiDocument {
  return {
    body: {
      content: [
        {
          startIndex: 1,
          endIndex: 7,
          paragraph: { elements: [{ startIndex: 1, endIndex: 7, textRun: { content: 'Title\n' } }] },
        },
        {
          startIndex: TABLE_START,
          endIndex: TABLE_END,
          table: {
            rows: 2,
            columns: 2,
            tableRows: [
              { tableCells: [cell('H1\n', 9), cell('H2\n', 13)] },
              { tableCells: [cell('a\n', 18), cell('b\n', 21)] },
            ],
          },
        },
      ],
    },
  };
}

/** The same table after a third row was inserted: the new cells are empty. */
function docWithThreeRowTable(): GDocsApiDocument {
  return {
    body: {
      content: [
        {
          startIndex: 1,
          endIndex: 7,
          paragraph: { elements: [{ startIndex: 1, endIndex: 7, textRun: { content: 'Title\n' } }] },
        },
        {
          startIndex: TABLE_START,
          endIndex: 48,
          table: {
            rows: 3,
            columns: 2,
            tableRows: [
              { tableCells: [cell('H1\n', 9), cell('H2\n', 13)] },
              { tableCells: [cell('a\n', 18), cell('b\n', 21)] },
              { tableCells: [cell('\n', 25), cell('\n', 27)] },
            ],
          },
        },
      ],
    },
  };
}

/** The same table after a third column was inserted: the new cells are empty. */
function docWithThreeColumnTable(): GDocsApiDocument {
  return {
    body: {
      content: [
        {
          startIndex: 1,
          endIndex: 7,
          paragraph: { elements: [{ startIndex: 1, endIndex: 7, textRun: { content: 'Title\n' } }] },
        },
        {
          startIndex: TABLE_START,
          endIndex: 52,
          table: {
            rows: 2,
            columns: 3,
            tableRows: [
              { tableCells: [cell('H1\n', 9), cell('H2\n', 13), cell('\n', 17)] },
              { tableCells: [cell('a\n', 20), cell('b\n', 23), cell('\n', 26)] },
            ],
          },
        },
      ],
    },
  };
}

describe('editing text inside a table', () => {
  let linkStore: GoogleDocsLinkStore;
  let tempDir: string;

  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  const PLAIN = 'Title\nH1\nH2\na\nb\n';

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-cell-test-'));
    linkStore = createGoogleDocsLinkStore(tempDir);
    await linkStore.initialize();
    mockDocsService.batchUpdate.mockResolvedValue({ replies: [] });
    mockDocsService.getDocument.mockResolvedValue(docWithTable());
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

  function requests(): Array<Record<string, { range?: { startIndex: number; endIndex: number } }>> {
    return mockDocsService.batchUpdate.mock.calls.flatMap(
      ([, reqs]) => (reqs ?? []) as Array<Record<string, { range?: { startIndex: number; endIndex: number } }>>,
    );
  }

  function deletedRanges(): Array<{ startIndex: number; endIndex: number }> {
    return requests().flatMap((r) => {
      const range = r['deleteContentRange']?.range;
      return range ? [range] : [];
    });
  }

  const MARKDOWN_ONE_CELL_CHANGED = '# Title\n\n| H1 | H2 |\n| --- | --- |\n| a | B EDITED |\n';

  it('never deletes the table itself', async () => {
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_ONE_CELL_CHANGED);

    const tableWipes = deletedRanges().filter(
      (r) => r.startIndex <= TABLE_START && r.endIndex >= TABLE_END - 1,
    );
    expect(tableWipes).toEqual([]);
  });

  it('never re-inserts the table', async () => {
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_ONE_CELL_CHANGED);

    expect(requests().filter((r) => 'insertTable' in r)).toEqual([]);
  });

  it('leaves the cells nobody edited alone, so their comments survive', async () => {
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_ONE_CELL_CHANGED);

    // Only cell (1,1) changed: it starts at 21. Nothing before that may be touched.
    const touchingOtherCells = deletedRanges().filter((r) => r.startIndex < 21);
    expect(touchingOtherCells).toEqual([]);
  });

  it('actually writes the new text into the changed cell', async () => {
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_ONE_CELL_CHANGED);

    const inserted = requests().flatMap((r) =>
      'insertText' in r ? [(r as unknown as { insertText: { text: string } }).insertText.text] : []);
    expect(inserted).toContain('B EDITED');
  });

  it('does nothing at all when no cell changed', async () => {
    await service().sync('/test/file.md', 'doc-1', '# Title\n\n| H1 | H2 |\n| --- | --- |\n| a | b |\n');

    expect(requests().filter((r) => 'insertTable' in r)).toEqual([]);
    expect(deletedRanges()).toEqual([]);
  });
});

describe('changing a table\'s shape', () => {
  let linkStore: GoogleDocsLinkStore;
  let tempDir: string;

  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  const PLAIN = 'Title\nH1\nH2\na\nb\n';

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-shape-test-'));
    linkStore = createGoogleDocsLinkStore(tempDir);
    await linkStore.initialize();
    mockDocsService.extractPlainText.mockReturnValue(PLAIN);
    await linkStore.saveBaseline('doc-1', PLAIN);
    await linkStore.setLink('/test/file.md', 'doc-1');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** Model the Doc actually growing a row when one is inserted. */
  function wireGrowingTable(): void {
    let rows = 2;
    mockDocsService.getDocument.mockImplementation(() =>
      Promise.resolve(rows === 2 ? docWithTable() : docWithThreeRowTable()));
    mockDocsService.batchUpdate.mockImplementation((_id: string, reqs: unknown[]) => {
      if ((reqs ?? []).some((r) => r != null && 'insertTableRow' in (r as object))) rows = 3;
      return Promise.resolve({ replies: [] });
    });
  }

  function requests(): Array<Record<string, { range?: { startIndex: number; endIndex: number } }>> {
    return mockDocsService.batchUpdate.mock.calls.flatMap(
      ([, reqs]) => (reqs ?? []) as Array<Record<string, { range?: { startIndex: number; endIndex: number } }>>,
    );
  }

  function service(): ReturnType<typeof createGoogleDocsSyncService> {
    return createGoogleDocsSyncService(
      mockDocsService as unknown as GoogleDocsService,
      linkStore,
    );
  }

  const MARKDOWN_EXTRA_ROW = '# Title\n\n| H1 | H2 |\n| --- | --- |\n| a | b |\n| c | d |\n';

  it('adds a row instead of rebuilding the table', async () => {
    wireGrowingTable();
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_EXTRA_ROW);

    expect(requests().filter((r) => 'insertTableRow' in r).length).toBeGreaterThan(0);
    expect(requests().filter((r) => 'insertTable' in r)).toEqual([]);
  });

  it('keeps the existing rows and their comments when adding one', async () => {
    wireGrowingTable();
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_EXTRA_ROW);

    const wipes = requests().flatMap((r) => {
      const range = r['deleteContentRange']?.range;
      return range && range.startIndex <= TABLE_START ? [range] : [];
    });
    expect(wipes).toEqual([]);
  });

  it('fills the new row with its text', async () => {
    wireGrowingTable();
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_EXTRA_ROW);

    const inserted = requests()
      .flatMap((r) => ('insertText' in r ? [(r as unknown as { insertText: { text: string } }).insertText.text] : []));
    expect(inserted).toContain('c');
    expect(inserted).toContain('d');
  });

  it('removes a row instead of rebuilding the table', async () => {
    let rows = 3;
    mockDocsService.getDocument.mockImplementation(() =>
      Promise.resolve(rows === 3 ? docWithThreeRowTable() : docWithTable()));
    mockDocsService.batchUpdate.mockImplementation((_id: string, reqs: unknown[]) => {
      if ((reqs ?? []).some((r) => r != null && 'deleteTableRow' in (r as object))) rows = 2;
      return Promise.resolve({ replies: [] });
    });

    await service().sync('/test/file.md', 'doc-1', '# Title\n\n| H1 | H2 |\n| --- | --- |\n| a | b |\n');

    expect(requests().filter((r) => 'deleteTableRow' in r).length).toBeGreaterThan(0);
    expect(requests().filter((r) => 'insertTable' in r)).toEqual([]);
  });
});

describe('the cost of an unchanged table', () => {
  let linkStore: GoogleDocsLinkStore;
  let tempDir: string;

  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  const PLAIN = 'Title\nH1\nH2\na\nb\n';

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-cost-test-'));
    linkStore = createGoogleDocsLinkStore(tempDir);
    await linkStore.initialize();
    mockDocsService.batchUpdate.mockResolvedValue({ replies: [] });
    mockDocsService.getDocument.mockResolvedValue(docWithTable());
    mockDocsService.extractPlainText.mockReturnValue(PLAIN);
    await linkStore.saveBaseline('doc-1', PLAIN);
    await linkStore.setLink('/test/file.md', 'doc-1');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function readsFor(markdown: string): Promise<number> {
    mockDocsService.getDocument.mockClear();
    await createGoogleDocsSyncService(
      mockDocsService as unknown as GoogleDocsService,
      linkStore,
    ).sync('/test/file.md', 'doc-1', markdown);
    return mockDocsService.getDocument.mock.calls.length;
  }

  it('costs no extra document read when no cell changed', async () => {
    const unchanged = await readsFor('# Title\n\n| H1 | H2 |\n| --- | --- |\n| a | b |\n');
    const changed = await readsFor('# Title\n\n| H1 | H2 |\n| --- | --- |\n| a | B EDITED |\n');

    expect(changed).toBeGreaterThan(unchanged);
  });
});

describe('changing a table\'s column count', () => {
  let linkStore: GoogleDocsLinkStore;
  let tempDir: string;

  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  const PLAIN = 'Title\nH1\nH2\na\nb\n';

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-col-test-'));
    linkStore = createGoogleDocsLinkStore(tempDir);
    await linkStore.initialize();
    mockDocsService.extractPlainText.mockReturnValue(PLAIN);
    await linkStore.saveBaseline('doc-1', PLAIN);
    await linkStore.setLink('/test/file.md', 'doc-1');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function requests(): Array<Record<string, { range?: { startIndex: number; endIndex: number } }>> {
    return mockDocsService.batchUpdate.mock.calls.flatMap(
      ([, reqs]) => (reqs ?? []) as Array<Record<string, { range?: { startIndex: number; endIndex: number } }>>,
    );
  }

  function service(): ReturnType<typeof createGoogleDocsSyncService> {
    return createGoogleDocsSyncService(
      mockDocsService as unknown as GoogleDocsService,
      linkStore,
    );
  }

  /** Model the Doc actually growing a column when one is inserted. */
  function wireGrowingTable(): void {
    let columns = 2;
    mockDocsService.getDocument.mockImplementation(() =>
      Promise.resolve(columns === 2 ? docWithTable() : docWithThreeColumnTable()));
    mockDocsService.batchUpdate.mockImplementation((_id: string, reqs: unknown[]) => {
      if ((reqs ?? []).some((r) => r != null && 'insertTableColumn' in (r as object))) columns = 3;
      return Promise.resolve({ replies: [] });
    });
  }

  const MARKDOWN_EXTRA_COLUMN =
    '# Title\n\n| H1 | H2 | H3 |\n| --- | --- | --- |\n| a | b | c |\n';

  it('adds a column instead of rebuilding the table', async () => {
    wireGrowingTable();
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_EXTRA_COLUMN);

    expect(requests().filter((r) => 'insertTableColumn' in r).length).toBeGreaterThan(0);
    expect(requests().filter((r) => 'insertTable' in r)).toEqual([]);
  });

  it('keeps the existing cells and their comments when adding a column', async () => {
    wireGrowingTable();
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_EXTRA_COLUMN);

    const wipes = requests().flatMap((r) => {
      const range = r['deleteContentRange']?.range;
      return range && range.startIndex <= TABLE_START ? [range] : [];
    });
    expect(wipes).toEqual([]);
  });

  it('fills the new column with its text', async () => {
    wireGrowingTable();
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_EXTRA_COLUMN);

    const inserted = requests().flatMap((r) =>
      'insertText' in r ? [(r as unknown as { insertText: { text: string } }).insertText.text] : []);
    expect(inserted).toContain('H3');
    expect(inserted).toContain('c');
  });

  it('adds the column at the far edge, not inside the existing ones', async () => {
    // insertRight:false against the last column would put the new column
    // second-from-right, silently shifting every cell after it.
    wireGrowingTable();
    await service().sync('/test/file.md', 'doc-1', MARKDOWN_EXTRA_COLUMN);

    const inserts = requests().flatMap((r) =>
      'insertTableColumn' in r
        ? [(r as unknown as {
            insertTableColumn: { tableCellLocation: { columnIndex: number }; insertRight: boolean };
          }).insertTableColumn]
        : []);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.insertRight).toBe(true);
    // The table had 2 columns, so the last one is index 1.
    expect(inserts[0]?.tableCellLocation.columnIndex).toBe(1);
  });

  it('removes a column instead of rebuilding the table', async () => {
    let columns = 3;
    mockDocsService.getDocument.mockImplementation(() =>
      Promise.resolve(columns === 3 ? docWithThreeColumnTable() : docWithTable()));
    mockDocsService.batchUpdate.mockImplementation((_id: string, reqs: unknown[]) => {
      if ((reqs ?? []).some((r) => r != null && 'deleteTableColumn' in (r as object))) columns = 2;
      return Promise.resolve({ replies: [] });
    });

    await service().sync('/test/file.md', 'doc-1', '# Title\n\n| H1 | H2 |\n| --- | --- |\n| a | b |\n');

    expect(requests().filter((r) => 'deleteTableColumn' in r).length).toBeGreaterThan(0);
    expect(requests().filter((r) => 'insertTable' in r)).toEqual([]);
  });
});
