/**
 * Tests for text styling inside Google Docs table cells.
 *
 * Cells are populated by buildCellRequests, which is the *only* place cell
 * text is styled — flattenElements skips tables, so the formatting-reapply
 * pass (buildFormattingFromApiDoc) never sees cell content.
 *
 * Two regressions are covered:
 *  - cell text rendered at a different size from the rest of the document,
 *    because text inserted into a new table does not inherit the document's
 *    NORMAL_TEXT style and nothing carried that style over;
 *  - inline marks inside a cell were dropped, because the runs were flattened
 *    to a single string before insertion.
 *
 * The governing rule for both: reuse whatever the document already defines,
 * never invent a font or a size.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildCellRequests, getNormalTextStyle } from '@main/services/GoogleDocsSyncService';
import type { DocsBatchUpdateRequest } from '@main/services/GoogleDocsService';
import type { DocsTextRun } from '@shared/types';
import type { GDocsApiDocument, GDocsStructuralElement } from '@shared/types/google-docs';

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
    expect(styles[2]!.textStyle['weightedFontFamily']).toEqual({ fontFamily: 'Courier New' });
    // `code` means monospace; the size must stay the document's.
    expect(styles[2]!.textStyle['fontSize']).toBeUndefined();
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

    const kinds = requests.map((r) => (isInsert(r) ? `insert@${r.insertText.location.index}` : 'style'));
    expect(kinds).toEqual(['insert@30', 'style', 'insert@10', 'style']);
  });
});

describe('getNormalTextStyle — reuse the document’s own styles', () => {
  const docWith = (textStyle: Record<string, unknown>): GDocsApiDocument =>
    ({ namedStyles: { styles: [{ namedStyleType: 'NORMAL_TEXT', textStyle }] } });

  it('reads the font and size the document defines for body text', () => {
    const base = getNormalTextStyle(
      docWith({ fontSize: { magnitude: 10, unit: 'PT' }, weightedFontFamily: { fontFamily: 'Verdana' } }),
    );

    expect(base.textStyle['fontSize']).toEqual({ magnitude: 10, unit: 'PT' });
    expect(base.textStyle['weightedFontFamily']).toEqual({ fontFamily: 'Verdana' });
    expect(base.fields.sort()).toEqual(['fontSize', 'weightedFontFamily']);
  });

  it('invents nothing when the document defines nothing', () => {
    expect(getNormalTextStyle(undefined)).toEqual({ textStyle: {}, fields: [] });
    expect(getNormalTextStyle({} as GDocsApiDocument)).toEqual({ textStyle: {}, fields: [] });
    expect(getNormalTextStyle(docWith({}))).toEqual({ textStyle: {}, fields: [] });
  });

  it('ignores other named styles', () => {
    const doc: GDocsApiDocument = {
      namedStyles: {
        styles: [
          { namedStyleType: 'HEADING_1', textStyle: { fontSize: { magnitude: 20, unit: 'PT' } } },
          { namedStyleType: 'NORMAL_TEXT', textStyle: { fontSize: { magnitude: 10, unit: 'PT' } } },
        ],
      },
    };
    expect(getNormalTextStyle(doc).textStyle['fontSize']).toEqual({ magnitude: 10, unit: 'PT' });
  });

  it('applies the document body font to every cell run', () => {
    const base = getNormalTextStyle(docWith({ fontSize: { magnitude: 10, unit: 'PT' } }));
    const requests = buildCellRequests(
      makeTableElement([[10]]),
      [[[{ text: 'plain ' }, { text: 'bold', bold: true }]]],
      base,
    );

    const styles = requests.filter(isStyle).map((r) => r.updateTextStyle);
    expect(styles).toHaveLength(2);
    for (const s of styles) {
      expect(s.textStyle['fontSize']).toEqual({ magnitude: 10, unit: 'PT' });
      expect(s.fields).toContain('fontSize');
    }
  });
});
