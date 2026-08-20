/**
 * Tests for carrying table column widths from the app's view into the document.
 *
 * The renderer measures each table's columns and reports them as fractions of
 * that table's width. Only proportions transfer — the document's text column is
 * a different size from the app window — so the sync scales them to whatever
 * this document's page and margins actually leave for text.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildColumnWidthRequests,
  getUsableWidthPt,
} from '@main/services/GoogleDocsSyncService';
import type { DocsBatchUpdateRequest } from '@main/services/GoogleDocsService';
import type { GDocsApiDocument } from '@shared/types/google-docs';
import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-userdata' },
}));

type WidthRequest = Extract<DocsBatchUpdateRequest, { updateTableColumnProperties: unknown }>;
const isWidth = (r: DocsBatchUpdateRequest): r is WidthRequest =>
  'updateTableColumnProperties' in r;

const widthsOf = (reqs: DocsBatchUpdateRequest[]): number[] =>
  reqs
    .filter(isWidth)
    .map((r) => r.updateTableColumnProperties.tableColumnProperties.width!.magnitude);

describe('getUsableWidthPt', () => {
  it('measures the text column from the document\'s own page and margins', () => {
    const doc: GDocsApiDocument = {
      documentStyle: {
        pageSize: { width: { magnitude: 595, unit: 'PT' } },
        marginLeft: { magnitude: 50, unit: 'PT' },
        marginRight: { magnitude: 45, unit: 'PT' },
      },
    };
    expect(getUsableWidthPt(doc)).toBe(500);
  });

  it('falls back to Letter with one-inch margins when geometry is missing', () => {
    expect(getUsableWidthPt(undefined)).toBe(468);
    expect(getUsableWidthPt({})).toBe(468);
    expect(getUsableWidthPt({ documentStyle: { pageSize: {} } })).toBe(468);
  });

  it('ignores nonsensical geometry rather than producing a negative width', () => {
    const doc: GDocsApiDocument = {
      documentStyle: {
        pageSize: { width: { magnitude: 100, unit: 'PT' } },
        marginLeft: { magnitude: 90, unit: 'PT' },
        marginRight: { magnitude: 90, unit: 'PT' },
      },
    };
    expect(getUsableWidthPt(doc)).toBe(468);
  });
});

describe('buildColumnWidthRequests', () => {
  it('divides the text column in the measured proportions', () => {
    const reqs = buildColumnWidthRequests(10, 2, [0.25, 0.75], 400);

    expect(widthsOf(reqs)).toEqual([100, 300]);
  });

  it('normalises fractions that do not sum to one', () => {
    // The renderer divides by its own total, but rounding can drift.
    const reqs = buildColumnWidthRequests(10, 2, [1, 3], 400);

    expect(widthsOf(reqs)).toEqual([100, 300]);
  });

  it('targets the table and names one column per request', () => {
    const reqs = buildColumnWidthRequests(42, 3, [1, 1, 1], 300).filter(isWidth);

    expect(reqs).toHaveLength(3);
    reqs.forEach((r, i) => {
      const req = r.updateTableColumnProperties;
      expect(req.tableStartLocation).toEqual({ index: 42 });
      expect(req.columnIndices).toEqual([i]);
      expect(req.tableColumnProperties.widthType).toBe('FIXED_WIDTH');
      expect(req.fields).toBe('width,widthType');
    });
  });

  it('never asks for a column under 5pt, which the API rejects with a 400', () => {
    // A hair-thin column: 0.001 of 400pt is 0.4pt.
    const reqs = buildColumnWidthRequests(10, 2, [0.001, 0.999], 400);

    expect(Math.min(...widthsOf(reqs))).toBeGreaterThanOrEqual(5);
  });

  it('leaves the table alone when the measurement does not fit it', () => {
    // Wrong column count — sizing by it would skew the table.
    expect(buildColumnWidthRequests(10, 3, [0.5, 0.5], 400)).toEqual([]);
    expect(buildColumnWidthRequests(10, 2, undefined, 400)).toEqual([]);
    expect(buildColumnWidthRequests(10, 0, [], 400)).toEqual([]);
  });

  it('leaves the table alone when the measurement is degenerate', () => {
    // An unlaid-out table measures zero, and negatives are never meaningful.
    expect(buildColumnWidthRequests(10, 2, [0, 0], 400)).toEqual([]);
    expect(buildColumnWidthRequests(10, 2, [-1, 2], 400)).toEqual([]);
    expect(buildColumnWidthRequests(10, 2, [NaN, 1], 400)).toEqual([]);
  });
});

describe('spacing after tables', () => {
  const types = (md: string): string[] =>
    convertMarkdownToDocs(md).elements.map((e) => e.type);

  const table = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');

  it('separates a table from body text that follows it', () => {
    expect(types(`${table}\n\nSome prose.\n`)).toEqual(['table', 'paragraph', 'paragraph']);

    const [, spacer] = convertMarkdownToDocs(`${table}\n\nSome prose.\n`).elements;
    expect(spacer!.runs).toEqual([]);
  });

  it('leaves headings alone, since they bring their own space', () => {
    expect(types(`${table}\n\n## Heading\n`)).toEqual(['table', 'heading']);
    expect(types(`${table}\n\n# Title\n`)).toEqual(['table', 'heading']);
  });

  it('adds nothing after a table that ends the document', () => {
    expect(types(`${table}\n`)).toEqual(['table']);
  });

  it('adds nothing between two adjacent tables', () => {
    expect(types(`${table}\n\n${table}\n`)).toEqual(['table', 'table']);
  });

  it('spaces every table that needs it', () => {
    expect(types(`${table}\n\nOne.\n\n${table}\n\nTwo.\n`)).toEqual([
      'table', 'paragraph', 'paragraph',
      'table', 'paragraph', 'paragraph',
    ]);
  });

  it('keeps table order intact for width matching', () => {
    // applyTableColumnWidths pairs measurements with tables by order, so the
    // spacer must not disturb the sequence of table elements.
    const tables = convertMarkdownToDocs(`${table}\n\nOne.\n\n${table}\n\nTwo.\n`)
      .elements.filter((e) => e.type === 'table');
    expect(tables).toHaveLength(2);
  });
});
