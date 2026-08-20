/**
 * Tests for text styling inside Google Docs table cells.
 *
 * Cells are populated by buildCellRequests, which is the *only* place cell
 * text is styled — flattenElements skips tables, so the formatting-reapply
 * pass (buildFormattingFromApiDoc) never sees cell content.
 *
 * The rule: a cell is Normal Text, the header row is Normal Text + bold, and
 * nothing here ever writes a font size. Naming the size is what made cell text
 * drift away from the rest of the document.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildCellRequests } from '@main/services/GoogleDocsSyncService';
import type { DocsBatchUpdateRequest } from '@main/services/GoogleDocsService';
import type { DocsTextRun } from '@shared/types';
import type { GDocsStructuralElement } from '@shared/types/google-docs';
import { CODE_FONT_FAMILY } from '@main/services/DocsDocumentBuilder';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-userdata' },
}));

type StyleRequest = Extract<DocsBatchUpdateRequest, { updateTextStyle: unknown }>;
type InsertRequest = Extract<DocsBatchUpdateRequest, { insertText: unknown }>;

const isStyle = (r: DocsBatchUpdateRequest): r is StyleRequest => 'updateTextStyle' in r;
const isInsert = (r: DocsBatchUpdateRequest): r is InsertRequest => 'insertText' in r;

/**
 * Build a minimal API table element whose cells report the given start
 * indices, mirroring the shape returned by documents.get for an empty table.
 */
function makeTableElement(cellStartIndices: number[][]): GDocsStructuralElement {
  return {
    table: {
      tableRows: cellStartIndices.map((row) => ({
        tableCells: row.map((startIndex) => ({
          content: [{ paragraph: { elements: [{ startIndex }] } }],
        })),
      })),
    },
  } as GDocsStructuralElement;
}

/** Collect the updateTextStyle requests that cover a given index range. */
function stylesFor(
  requests: DocsBatchUpdateRequest[],
  from: number,
  to: number,
): StyleRequest['updateTextStyle'][] {
  return requests
    .filter(isStyle)
    .map((r) => r.updateTextStyle)
    .filter((s) => s.range.startIndex >= from && s.range.endIndex <= to);
}

describe('buildCellRequests — inline formatting in table cells', () => {
  const bodyCell: DocsTextRun[] = [
    { text: 'Hosting: ' },
    { text: 'MongoDB Atlas', bold: true },
    { text: ' (real Mongo).' },
  ];

  it('inserts the full cell text as a single run of text', () => {
    const requests = buildCellRequests(makeTableElement([[10]]), [[bodyCell]]);
    const inserts = requests.filter(isInsert).map((r) => r.insertText);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.text).toBe('Hosting: MongoDB Atlas (real Mongo).');
    expect(inserts[0]!.location.index).toBe(10);
  });

  it('bolds only the bold run, not the whole cell', () => {
    // Row 1 so the header rule does not apply.
    const requests = buildCellRequests(
      makeTableElement([[10], [40]]),
      [[[{ text: 'Header' }]], [bodyCell]],
    );

    const styles = stylesFor(requests, 40, 40 + 36);
    const bolded = styles.filter((s) => s.textStyle['bold'] === true);

    expect(bolded).toHaveLength(1);
    // 'Hosting: ' is 9 chars, so the bold run starts at 40 + 9.
    expect(bolded[0]!.range).toEqual({ startIndex: 49, endIndex: 62 });
  });

  it('states bold:false on unstyled runs so inherited bold cannot bleed', () => {
    const requests = buildCellRequests(
      makeTableElement([[10], [40]]),
      [[[{ text: 'Header' }]], [bodyCell]],
    );

    const styles = stylesFor(requests, 40, 40 + 36);
    const plain = styles.filter((s) => s.textStyle['bold'] === false);

    // Both unstyled runs must explicitly clear bold.
    expect(plain).toHaveLength(2);
    for (const s of plain) {
      expect(s.fields).toContain('bold');
    }
  });

  it('still bolds every run of the header row', () => {
    const requests = buildCellRequests(
      makeTableElement([[10, 20]]),
      [[[{ text: 'ID' }], [{ text: 'Description' }]]],
    );

    const bolded = requests
      .filter(isStyle)
      .map((r) => r.updateTextStyle)
      .filter((s) => s.textStyle['bold'] === true);

    expect(bolded).toHaveLength(2);
  });

  it('preserves italic, strikethrough, code and links within a cell', () => {
    const cell: DocsTextRun[] = [
      { text: 'a', italic: true },
      { text: 'b', strikethrough: true },
      { text: 'c', code: true },
      { text: 'd', link: 'https://example.com' },
    ];
    const requests = buildCellRequests(makeTableElement([[100]]), [[cell]]);
    const styles = stylesFor(requests, 100, 104);

    expect(styles[0]!.textStyle['italic']).toBe(true);
    expect(styles[1]!.textStyle['strikethrough']).toBe(true);
    expect(styles[2]!.textStyle['weightedFontFamily']).toEqual({ fontFamily: CODE_FONT_FAMILY });
    expect(styles[3]!.textStyle['link']).toEqual({ url: 'https://example.com' });
  });

  it('styles each cell after its own insert, before any lower-index insert', () => {
    // Cells are emitted in reverse order; a cell's style requests must sit
    // between its own insertText and the next (lower-index) insertText, or the
    // offsets they were computed from will have shifted by the time they land.
    const requests = buildCellRequests(
      makeTableElement([[10, 30]]),
      [[[{ text: 'left' }], [{ text: 'right' }]]],
    );

    const kinds = requests.map((r) =>
      isInsert(r) ? `insert@${r.insertText.location.index}` : isStyle(r) ? 'text' : 'para',
    );
    expect(kinds).toEqual(['insert@30', 'para', 'text', 'insert@10', 'para', 'text']);
  });
});

describe('buildCellRequests — the document keeps its own font', () => {
  const isParagraph = (
    r: DocsBatchUpdateRequest,
  ): r is Extract<DocsBatchUpdateRequest, { updateParagraphStyle: unknown }> =>
    'updateParagraphStyle' in r;

  const table = (): DocsBatchUpdateRequest[] =>
    buildCellRequests(
      makeTableElement([[10, 30], [60, 80]]),
      [
        [[{ text: 'ID' }], [{ text: 'Description' }]],
        [[{ text: 'D1' }], [{ text: 'plain ' }, { text: 'bold', bold: true }]],
      ],
    );

  it('never writes a font size or family for ordinary text', () => {
    const serialised = JSON.stringify(table());
    expect(serialised).not.toContain('fontSize');
    // Courier is only ever emitted for `code`, and none of these runs are code.
    expect(serialised).not.toContain('weightedFontFamily');
  });

  it('sets every populated cell to Normal Text', () => {
    const paragraphs = table().filter(isParagraph).map((r) => r.updateParagraphStyle);

    expect(paragraphs).toHaveLength(4);
    for (const p of paragraphs) {
      expect(p.paragraphStyle['namedStyleType']).toBe('NORMAL_TEXT');
      expect(p.fields).toBe('namedStyleType');
    }
  });

  it('bolds the header row and leaves body cells unbolded', () => {
    const styles = table().filter(isStyle).map((r) => r.updateTextStyle);

    // Header cells (indices 10 and 30) are bold; body text is not, except the
    // run the markdown marked bold.
    const header = styles.filter((s) => s.range.startIndex < 60);
    const body = styles.filter((s) => s.range.startIndex >= 60);

    expect(header.every((s) => s.textStyle['bold'] === true)).toBe(true);
    expect(body.filter((s) => s.textStyle['bold'] === true)).toHaveLength(1);
    expect(body.filter((s) => s.textStyle['bold'] === false)).toHaveLength(2);
  });
});
