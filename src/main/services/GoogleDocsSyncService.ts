/**
 * GoogleDocsSyncService — Orchestrates three-way diffing and surgical
 * document updates between local markdown files and Google Docs.
 *
 * Ties together the converter, builder, API wrapper, and link store to
 * detect external edits and apply minimal changes that preserve comments.
 */
import { diffChars, diffArrays } from 'diff';
import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';
import { convertDocsToMarkdown } from '@main/services/DocsToMarkdownConverter';
import { threeWayMerge, twoWayReview, applyResolutions } from '@main/services/ThreeWayMerge';
import {
  buildInsertRequests,
  CODE_FONT_FAMILY,
  buildFormattingFromApiDoc,
  extractApiParagraphs,
  flattenElements,
  getLeafText,
} from '@main/services/DocsDocumentBuilder';
import crypto from 'node:crypto';

import type { ApiParagraph, PendingTable } from '@main/services/DocsDocumentBuilder';
import type { GoogleDocsService } from '@main/services/GoogleDocsService';
import type { GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import type {
  DocsDocument,
  DocsElement,
  DocsTextRun,
  GDocsApiDocument,
  GDocsStructuralElement,
  GoogleDocsResolveResult,
  GoogleDocsSyncResult,
  MermaidDiagramData,
  SyncPhase,
  SyncResolveMode,
  SyncDirection,
  SyncChangeKind,
  SyncConflictChoice,
  SyncProgressUpdate,
  TableColumnWidths,
} from '@shared/types/google-docs';
import type { DocsBatchUpdateRequest } from '@main/services/GoogleDocsService';

// ── Paragraph-level diff with actual API indices ────────────────────
//
// Instead of diffing flat text (which breaks when structural elements
// like tables/images shift the index space), we diff at the paragraph
// level using diffArrays, then do character-level diffChars within
// modified paragraphs.  All operations use ACTUAL API indices from
// extractApiParagraphs, so they target the correct content regardless
// of tables/images in the document.

interface DiffOp {
  type: 'delete' | 'insert';
  index: number;
  /** Exclusive, and exact: whatever must survive is already excluded. */
  endIndex?: number;
  text?: string;
}

/**
 * Character-level diff within a single paragraph, using actual API indices.
 */
function charDiffWithinParagraph(
  apiPara: ApiParagraph,
  newText: string,
): DiffOp[] {
  const oldText = apiPara.text.replace(/\n$/, '');
  const changes = diffChars(oldText, newText);
  const ops: DiffOp[] = [];
  let index = apiPara.textStartIndex;

  for (const change of changes) {
    if (change.removed) {
      ops.push({
        type: 'delete',
        index,
        endIndex: index + change.value.length,
      });
      index += change.value.length;
    } else if (change.added) {
      ops.push({ type: 'insert', index, text: change.value });
    } else {
      index += change.value.length;
    }
  }
  return ops;
}

/**
 * Generate diff operations using paragraph-level matching with actual
 * API indices.  For 1:1 paragraph modifications, uses character-level
 * diff to preserve comments on unchanged words.
 */
function generateParagraphDiffOperations(
  apiParas: ApiParagraph[],
  modelElements: DocsElement[],
  docBodyEndIndex?: number,
  structuralStarts?: ReadonlySet<number>,
): DocsBatchUpdateRequest[] {
  // A paragraph's trailing newline usually goes with it -- stopping short
  // leaves an empty paragraph where the content used to be. Two newlines
  // cannot be removed, though: the one in front of a table (or table of
  // contents, or section break), which Google refuses to delete unless the
  // element goes too, and the one that ends the body, which every document
  // must have. A run's end index is the following element's start, so a hit
  // in structuralStarts is exactly that boundary.
  const keepsNewline = (end: number): boolean =>
    structuralStarts?.has(end) === true ||
    (docBodyEndIndex != null && end >= docBodyEndIndex);
  const deleteEndFor = (end: number): number => (keepsNewline(end) ? end - 1 : end);

  const oldTexts = apiParas.map(p => p.text.replace(/\n$/, ''));
  const newTexts = modelElements.map(e => getLeafText(e));

  const changes = diffArrays(oldTexts, newTexts);

  // Collect all primitive ops with their absolute positions
  const allOps: DiffOp[] = [];
  let apiIdx = 0;
  let modelIdx = 0;
  let lastKeptEndIndex = 1; // track insertion point for adds at start

  for (let ci = 0; ci < changes.length; ci++) {
    const change = changes[ci]!;
    const count = change.count ?? 0;

    if (!change.added && !change.removed) {
      // ── KEPT — skip these paragraphs, comments fully preserved ──
      for (let i = 0; i < count; i++) {
        lastKeptEndIndex = apiParas[apiIdx]!.endIndex;
        apiIdx++;
        modelIdx++;
      }
    } else if (change.removed) {
      // Check if the next change is an add at the same position (modification)
      const nextChange = changes[ci + 1];
      if (nextChange?.added) {
        const removedCount = count;
        const addedCount = nextChange.count ?? 0;

        if (removedCount === 1 && addedCount === 1) {
          // ── 1:1 MODIFICATION — character-level diff within paragraph ──
          const newText = getLeafText(modelElements[modelIdx]!);
          const ops = charDiffWithinParagraph(apiParas[apiIdx]!, newText);
          allOps.push(...ops);
          lastKeptEndIndex = apiParas[apiIdx]!.endIndex;
          apiIdx++;
          modelIdx++;
        } else {
          // ── N:M REPLACEMENT — delete old paragraphs, insert new text ──
          const insertAt = apiParas[apiIdx]!.startIndex;
          // One range per run of paragraphs that really are adjacent.
          //
          // extractApiParagraphs walks only the body's top level and keeps
          // the paragraphs, so a table between two of them leaves no trace in
          // the list -- they look like neighbours while a whole table sits
          // between them in the document. Taking "first start to last end"
          // then produces a range across the table, and Google refuses the
          // whole batch: deleting the newline before a table, or either of
          // its boundaries, without deleting the table itself is invalid.
          // A gap between one paragraph's end and the next one's start is
          // exactly where something else lives.
          let runStart = apiParas[apiIdx]!.startIndex;
          let deleteEnd = apiParas[apiIdx]!.endIndex;
          // Whether the run the new text lands in keeps its final newline.
          let firstRunKeepsNewline: boolean | null = null;
          for (let i = 1; i < removedCount; i++) {
            const para = apiParas[apiIdx + i]!;
            if (para.startIndex !== deleteEnd) {
              firstRunKeepsNewline ??= keepsNewline(deleteEnd);
              allOps.push({ type: 'delete', index: runStart, endIndex: deleteEndFor(deleteEnd) });
              runStart = para.startIndex;
            }
            deleteEnd = para.endIndex;
          }
          firstRunKeepsNewline ??= keepsNewline(deleteEnd);
          allOps.push({ type: 'delete', index: runStart, endIndex: deleteEndFor(deleteEnd) });
          // Insert new paragraphs as text. When the run keeps its newline,
          // that surviving newline terminates the last inserted paragraph --
          // adding another would show up as a blank line.
          let newText = '';
          for (let i = 0; i < addedCount; i++) {
            newText += getLeafText(modelElements[modelIdx + i]!) + '\n';
          }
          if (firstRunKeepsNewline) newText = newText.slice(0, -1);
          allOps.push({ type: 'insert', index: insertAt, text: newText });
          lastKeptEndIndex = deleteEnd;
          apiIdx += removedCount;
          modelIdx += addedCount;
        }
        ci++; // skip the next (added) change, we handled it
      } else {
        // ── REMOVED ONLY — delete paragraphs ──
        for (let i = 0; i < count; i++) {
          const para = apiParas[apiIdx]!;
          allOps.push({
            type: 'delete',
            index: para.startIndex,
            endIndex: deleteEndFor(para.endIndex),
          });
          apiIdx++;
        }
      }
    } else if (change.added) {
      // ── ADDED ONLY — insert new paragraphs ──
      const insertAt = lastKeptEndIndex;
      let newText = '';
      for (let i = 0; i < count; i++) {
        newText += getLeafText(modelElements[modelIdx + i]!) + '\n';
      }
      allOps.push({ type: 'insert', index: insertAt, text: newText });
      modelIdx += count;
    }
  }

  // Every delete range is already exact. The clamp stays as a backstop: an
  // off-by-one that reached Google would fail the whole batch.
  const maxDeleteEnd = docBodyEndIndex != null ? docBodyEndIndex - 1 : undefined;

  return diffOpsToRequests(allOps, maxDeleteEnd);
}

/** A paragraph with nothing in it but its newline. */
function isBlankParagraph(el: GDocsStructuralElement | undefined): boolean {
  if (!el?.paragraph) return false;
  const text = (el.paragraph.elements ?? []).map((pe) => pe.textRun?.content ?? '').join('');
  return text.replace(/\n$/, '') === '';
}

/** Headings carry space below them, so they need no blank before a table. */
function isHeading(el: GDocsStructuralElement): boolean {
  const style = el.paragraph?.paragraphStyle?.['namedStyleType'];
  return typeof style === 'string' && (style.startsWith('HEADING') || style === 'TITLE');
}

/**
 * Where each table, table of contents or section break begins.
 *
 * These are the boundaries a paragraph delete has to stop short of: Google
 * refuses to delete the newline in front of one unless the element goes with
 * it, and the element is exactly what a sync is protecting -- comments anchor
 * inside tables.
 */
function structuralStartIndices(apiDoc: GDocsApiDocument): Set<number> {
  const starts = new Set<number>();
  for (const el of apiDoc?.body?.content ?? []) {
    if ((el.table || el.tableOfContents || el.sectionBreak) && el.startIndex != null) {
      starts.add(el.startIndex);
    }
  }
  return starts;
}

/**
 * Turn diff operations into batchUpdate requests.
 *
 * Google applies a batch sequentially: each request sees the document as the
 * previous ones left it. So the whole batch is ordered from the end of the
 * document backwards -- nothing that runs earlier can then shift an index a
 * later request depends on.
 *
 * Reversing the generated order is not enough. Operations are produced in
 * document order, and a replacement emits its deletes before its insert; the
 * reversal put the insert first, at the same index the deletes started from.
 * That insert shifted every delete after it by its own length, so the deletes
 * ate the newly inserted text and, past the end of the body, Google rejected
 * the batch outright. Hence an explicit sort, with deletes winning ties: clear
 * the old text out of a position before putting new text there.
 */
function diffOpsToRequests(ops: DiffOp[], maxDeleteEnd?: number): DocsBatchUpdateRequest[] {
  const ordered = [...ops].sort((a, b) =>
    a.index !== b.index ? b.index - a.index : rankForSameIndex(a) - rankForSameIndex(b)
  );

  const requests: DocsBatchUpdateRequest[] = [];
  for (const op of ordered) {
    if (op.type === 'delete') {
      let endIdx = op.endIndex ?? op.index;
      if (maxDeleteEnd != null && endIdx > maxDeleteEnd) {
        endIdx = maxDeleteEnd;
      }
      // Skip no-op deletes (e.g. empty paragraphs with only a newline)
      if (endIdx <= op.index) continue;
      requests.push({
        deleteContentRange: { range: { startIndex: op.index, endIndex: endIdx } },
      });
    } else {
      requests.push({
        insertText: { text: op.text ?? '', location: { index: op.index } },
      });
    }
  }
  return requests;
}

/** Deletes run before inserts at the same index; see diffOpsToRequests. */
function rankForSameIndex(op: DiffOp): number {
  return op.type === 'delete' ? 0 : 1;
}

// ── Structural element extraction from API doc ──────────��───────────

interface ApiTable {
  startIndex: number;
  endIndex: number;
  cellTexts: string; // concatenated cell text for comparison
  /** Each cell's first paragraph, carrying the real Docs indices, so a cell
   *  can be edited in place instead of the table being rebuilt. */
  cells: ApiParagraph[][];
  rowCount: number;
  columnCount: number;
}

interface ApiImageBlock {
  /** startIndex of the first element (paragraph containing the inline image) */
  startIndex: number;
  /** endIndex of the last element (the link paragraph, or the image paragraph if no link) */
  endIndex: number;
  /** The mermaid.live edit URL extracted from the link paragraph, if present */
  mermaidLiveUrl?: string;
}

/**
 * The header row, as the identity of a table across a sync.
 *
 * Ordinal position shifts the moment a table is added or removed, and exact
 * content stops matching the moment anyone edits a cell. A header row
 * survives both, which is what makes it usable for pairing.
 */
/**
 * Pair the Doc's tables with the file's, matching on the header row.
 *
 * Returns only the tables present on both sides; what is left over on either
 * side is an addition or a deletion, which the caller decides about.
 */
/** A row's cell texts: its identity within a table, across an edit. */
function apiRowKey(cells: ApiParagraph[]): string {
  return cells.map((cell) => cell.text.trim()).join('\u0000');
}

function modelRowKey(row: DocsTextRun[][]): string {
  return row.map((cell) => cell.map((run) => run.text).join('').trim()).join('\u0000');
}

/**
 * Where rows have to be added or removed for the Doc's table to match the
 * file's, in the Doc's own row numbers.
 *
 * Rows are matched on their content, so a row missing from the middle is
 * restored in the middle. Appending it instead and letting the text shift up
 * a row rewrites every row below -- and comments anchor to text ranges, so
 * each one ends up attached to whatever moved into its place.
 *
 * A removed run against an added one is a set of rows whose text changed;
 * those stay where they are and the cell pass rewrites them.
 */
function tableRowOperations(
  apiTable: ApiTable,
  modelTable: DocsElement,
): Array<{ type: 'insert' | 'delete'; at: number; count: number }> {
  const changes = diffArrays(
    apiTable.cells.map(apiRowKey),
    (modelTable.rows ?? []).map(modelRowKey),
  );
  const ops: Array<{ type: 'insert' | 'delete'; at: number; count: number }> = [];
  let at = 0;

  for (let ci = 0; ci < changes.length; ci++) {
    const change = changes[ci]!;
    const count = change.value.length;

    if (!change.added && !change.removed) {
      at += count;
      continue;
    }

    if (change.removed) {
      const added = changes[ci + 1]?.added === true ? changes[ci + 1]!.value.length : 0;
      const matched = Math.min(count, added);
      at += matched;
      if (count > matched) {
        ops.push({ type: 'delete', at, count: count - matched });
        at += count - matched;
      }
      if (added > matched) ops.push({ type: 'insert', at, count: added - matched });
      if (added > 0) ci++;
      continue;
    }

    ops.push({ type: 'insert', at, count });
  }

  return ops;
}

function pairTablesByHeader(
  apiTables: ApiTable[],
  modelTables: DocsElement[],
): Array<{ apiTable: ApiTable; modelTable: DocsElement; apiIndex: number; modelIndex: number }> {
  const pairs: Array<{ apiTable: ApiTable; modelTable: DocsElement; apiIndex: number; modelIndex: number }> = [];
  const changes = diffArrays(apiTables.map(apiTableHeaderKey), modelTables.map(modelTableHeaderKey));
  let ai = 0;
  let mi = 0;

  for (let ci = 0; ci < changes.length; ci++) {
    const change = changes[ci]!;
    const count = change.value.length;

    if (!change.added && !change.removed) {
      for (let k = 0; k < count; k++) {
        pairs.push({
          apiTable: apiTables[ai + k]!, modelTable: modelTables[mi + k]!,
          apiIndex: ai + k, modelIndex: mi + k,
        });
      }
      ai += count;
      mi += count;
      continue;
    }

    if (change.removed) {
      const added = changes[ci + 1]?.added === true ? changes[ci + 1]!.value.length : 0;
      // A removed run against an added one is a set of headers that were
      // rewritten; pair as many as line up.
      for (let k = 0; k < Math.min(count, added); k++) {
        pairs.push({
          apiTable: apiTables[ai + k]!, modelTable: modelTables[mi + k]!,
          apiIndex: ai + k, modelIndex: mi + k,
        });
      }
      ai += count;
      mi += added;
      if (added > 0) ci++;
      continue;
    }

    mi += count;
  }

  return pairs;
}

function apiTableHeaderKey(apiTable: ApiTable): string {
  return (apiTable.cells[0] ?? []).map((cell) => cell.text.trim()).join('\u0000');
}

function modelTableHeaderKey(modelTable: DocsElement): string {
  return (modelTable.rows?.[0] ?? [])
    .map((cell) => cell.map((run) => run.text).join('').trim())
    .join('\u0000');
}

function extractApiTables(apiDoc: GDocsApiDocument): ApiTable[] {
  const result: ApiTable[] = [];
  const content = apiDoc?.body?.content;
  if (!content) return result;

  for (const el of content) {
    if (el.table) {
      let cellTexts = '';
      const cells: ApiParagraph[][] = [];
      for (const row of el.table.tableRows ?? []) {
        const rowCells: ApiParagraph[] = [];
        for (const cell of row.tableCells ?? []) {
          let text = '';
          let startIndex = 0;
          let endIndex = 0;
          let textStartIndex = 0;
          let found = false;
          for (const cellContent of cell.content ?? []) {
            if (cellContent.paragraph) {
              for (const pe of cellContent.paragraph.elements ?? []) {
                if (pe.textRun?.content != null) {
                  if (!found) {
                    startIndex = cellContent.startIndex ?? pe.startIndex ?? 0;
                    textStartIndex = pe.startIndex ?? startIndex;
                    found = true;
                  }
                  text += pe.textRun.content;
                  endIndex = pe.endIndex ?? cellContent.endIndex ?? endIndex;
                  cellTexts += pe.textRun.content;
                }
              }
            }
          }
          rowCells.push({ text, startIndex, endIndex, textStartIndex });
        }
        cells.push(rowCells);
      }
      result.push({
        startIndex: el.startIndex ?? 0,
        endIndex: el.endIndex ?? 0,
        cellTexts,
        cells,
        rowCount: cells.length,
        columnCount: cells[0]?.length ?? 0,
      });
    }
  }
  return result;
}

/**
 * Edit a table's changed cells in place.
 *
 * Rebuilding the table would be far simpler, but comments anchor to text
 * ranges: deleting a table detaches every comment in it, and tables are
 * exactly where review comments tend to live. Cells whose text is unchanged
 * emit nothing at all, and within a changed cell only the differing characters
 * move, so a comment on an untouched word survives too.
 *
 * Returns null when the shapes disagree -- adding a column cannot be expressed
 * as a text edit, so the caller falls back to rebuilding.
 */
/**
 * Where a newly added table or diagram belongs in the live document.
 *
 * The paragraph diff has already brought the Doc's text into line with the
 * model, so the leaf preceding this element in the model can be found by its
 * text in the Doc, and the element goes directly after it. Matching counts
 * occurrences, so a document repeating a line ("Notes", "Example") anchors to
 * the right one rather than the first.
 *
 * Falls back to the end of the body when there is no preceding leaf to anchor
 * to -- which is also the correct answer for an element appended at the end.
 */
function insertionIndexFor(
  apiDoc: GDocsApiDocument,
  elements: DocsElement[],
  position: number,
): number {
  const bodyEnd = (apiDoc?.body?.content?.at(-1)?.endIndex ?? 2) - 1;

  // Nearest preceding element that contributes text; tables and images do not.
  let anchorText: string | null = null;
  let occurrence = 0;
  for (let i = position - 1; i >= 0; i--) {
    const el = elements[i];
    if (el == null || el.type === 'table' || el.type === 'image') continue;
    const leaves = flattenElements([el]);
    const last = leaves.at(-1);
    if (last == null) continue;
    anchorText = getLeafText(last);
    // How many earlier leaves carry the same text, so we can match the Nth.
    const earlier = flattenElements(elements.slice(0, i));
    occurrence = earlier.filter((e) => getLeafText(e) === anchorText).length;
    break;
  }
  if (anchorText == null) {
    // Nothing precedes it: the very start of the body.
    return position === 0 ? 1 : bodyEnd;
  }

  let seen = 0;
  for (const para of extractApiParagraphs(apiDoc)) {
    if (para.text.replace(/\n$/, '') !== anchorText) continue;
    // The final paragraph's endIndex covers the document's mandatory trailing
    // newline, which is not a writable position -- clamp to just before it.
    if (seen === occurrence) return Math.min(para.endIndex, bodyEnd);
    seen++;
  }
  return bodyEnd;
}

/** The document index a request acts on, for ordering a mixed batch. */
function requestIndex(request: DocsBatchUpdateRequest): number {
  if ('deleteContentRange' in request) return request.deleteContentRange.range.startIndex;
  if ('insertText' in request) return request.insertText.location.index;
  return 0;
}

function tableCellDiffRequests(
  apiTable: ApiTable,
  modelTable: DocsElement,
): DocsBatchUpdateRequest[] | null {
  const modelRows = modelTable.rows ?? [];
  if (modelRows.length !== apiTable.rowCount) return null;
  if (modelRows.some((row) => row.length !== apiTable.columnCount)) return null;

  const ops: DiffOp[] = [];
  for (let r = 0; r < modelRows.length; r++) {
    const modelRow = modelRows[r] ?? [];
    const apiRow = apiTable.cells[r] ?? [];
    for (let c = 0; c < modelRow.length; c++) {
      const apiCell = apiRow[c];
      if (apiCell == null) return null;
      const newText = (modelRow[c] ?? []).map((run) => run.text).join('');
      if (apiCell.text.replace(/\n$/, '') === newText) continue;
      ops.push(...charDiffWithinParagraph(apiCell, newText));
    }
  }
  // Sorted so the reverse emit keeps every index valid.
  ops.sort((a, b) => a.index - b.index);
  return diffOpsToRequests(ops);
}

function extractApiImageBlocks(apiDoc: GDocsApiDocument): ApiImageBlock[] {
  const result: ApiImageBlock[] = [];
  const content = apiDoc?.body?.content;
  if (!content) return result;

  for (let i = 0; i < content.length; i++) {
    const el = content[i]!;
    if (!el.paragraph) continue;

    // Check if this paragraph contains an inline image object
    let hasInlineImage = false;
    for (const pe of el.paragraph.elements ?? []) {
      if (pe.inlineObjectElement) {
        hasInlineImage = true;
        break;
      }
    }
    if (!hasInlineImage) continue;

    // This paragraph has an inline image.  Check if the next paragraph
    // is the "Edit in Mermaid Live" link.
    let endIndex = el.endIndex ?? 0;
    let mermaidLiveUrl: string | undefined;
    const nextEl = content[i + 1];
    if (nextEl?.paragraph) {
      for (const pe of nextEl.paragraph.elements ?? []) {
        const url = pe.textRun?.textStyle?.link?.url;
        if (typeof url === 'string' && url.includes('mermaid.live')) {
          mermaidLiveUrl = url;
          endIndex = nextEl.endIndex ?? 0;
          break;
        }
      }
    }

    result.push({
      startIndex: el.startIndex ?? 0,
      endIndex,
      mermaidLiveUrl,
    });
  }
  return result;
}

/**
 * Build the cell-text fingerprint for a model table element so we can
 * compare it with an API table's cellTexts.
 */
function modelTableCellTexts(element: DocsElement): string {
  if (!element.rows) return '';
  let text = '';
  for (const row of element.rows) {
    for (const cell of row) {
      for (const run of cell) {
        text += run.text;
      }
      // Each cell in a Google Doc ends with '\n' (paragraph terminator)
      text += '\n';
    }
  }
  return text;
}

/**
 * Helper to find the first table structural element at or after a given index.
 */
function findTableElement(
  content: GDocsStructuralElement[],
  afterIndex: number,
): GDocsStructuralElement | undefined {
  return content.find(el => el.table && (el.startIndex ?? 0) >= afterIndex);
}

/**
 * Build cell insert/format requests for a table element from the API doc.
 * Processes cells in reverse order to preserve indices.
 *
 * Cells are set to the NORMAL_TEXT named style and nothing else: the document
 * already defines what Normal Text looks like, so its font and size follow
 * automatically. No font size is ever written here. The header row adds bold
 * on top, and inline marks from the markdown are layered per run.
 */

/**
 * Width of the document's text column, in points.
 *
 * Table widths are absolute in the Docs API, so the proportions measured in the
 * app have to be scaled to whatever this particular document's page and margins
 * leave for text. Falls back to US Letter with one-inch margins only when the
 * document does not report its own geometry.
 */
export function getUsableWidthPt(doc: GDocsApiDocument | undefined): number {
  const style = doc?.documentStyle;
  const page = style?.pageSize?.width?.magnitude;
  const left = style?.marginLeft?.magnitude;
  const right = style?.marginRight?.magnitude;

  if (page === undefined || left === undefined || right === undefined) {
    return 612 - 72 - 72;
  }
  const usable = page - left - right;
  return usable > 0 ? usable : 612 - 72 - 72;
}

/** The API rejects any column narrower than 5pt with a 400. */
const MIN_COLUMN_WIDTH_PT = 5;

/**
 * Size a table's columns to the proportions measured in the app's view.
 *
 * Returns nothing when no measurement is available or it does not describe this
 * table, leaving Google's own even distribution in place rather than guessing.
 */
export function buildColumnWidthRequests(
  tableStartIndex: number,
  columnCount: number,
  fractions: number[] | undefined,
  usableWidthPt: number,
): DocsBatchUpdateRequest[] {
  if (!fractions || fractions.length !== columnCount || columnCount === 0) return [];

  const total = fractions.reduce((sum, f) => sum + f, 0);
  if (!(total > 0) || fractions.some((f) => !Number.isFinite(f) || f < 0)) return [];

  return fractions.map((fraction, columnIndex) => ({
    updateTableColumnProperties: {
      tableStartLocation: { index: tableStartIndex },
      columnIndices: [columnIndex],
      tableColumnProperties: {
        widthType: 'FIXED_WIDTH' as const,
        width: {
          magnitude: Math.max(
            MIN_COLUMN_WIDTH_PT,
            (fraction / total) * usableWidthPt,
          ),
          unit: 'PT',
        },
      },
      fields: 'width,widthType',
    },
  }));
}

export function buildCellRequests(
  tableEl: GDocsStructuralElement,
  dataRows: DocsTextRun[][][],
): DocsBatchUpdateRequest[] {
  const cellRequests: DocsBatchUpdateRequest[] = [];
  const tableRows = tableEl.table?.tableRows ?? [];

  for (let r = tableRows.length - 1; r >= 0; r--) {
    const cells = tableRows[r]?.tableCells ?? [];
    for (let c = cells.length - 1; c >= 0; c--) {
      const cell = cells[c];
      const cellContent = cell?.content?.[0];
      if (!cellContent?.paragraph) continue;

      const cellIndex = cellContent.paragraph.elements?.[0]?.startIndex;
      if (cellIndex === undefined) continue;

      const dataRow = dataRows[r];
      const dataCell = dataRow?.[c];
      if (!dataCell || dataCell.length === 0) continue;

      const text = dataCell.map((run: DocsTextRun) => run.text).join('');
      if (!text) continue;

      cellRequests.push({
        insertText: {
          text,
          location: { index: cellIndex },
        },
      });

      // Style each run individually so inline marks inside a cell survive.
      // Every run states bold/italic/strikethrough explicitly, including the
      // false case: insertText inherits the style at the insertion point, so
      // omitting them (as buildTextStyleForRun does for unstyled runs) lets a
      // neighbouring bold run bleed across the whole cell.
      //
      // These requests are applied immediately after this cell's insertText and
      // before any later request, which only ever targets a lower index — so
      // offsets computed from cellIndex are still valid when they land.
      const isHeaderRow = r === 0;
      let runOffset = 0;

      // Normal Text carries the document's own font and size, so the cell
      // picks them up without anything here naming a size.
      cellRequests.push({
        updateParagraphStyle: {
          range: { startIndex: cellIndex, endIndex: cellIndex + text.length },
          paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          fields: 'namedStyleType',
        },
      });

      for (const run of dataCell) {
        if (!run.text) continue;

        const start = cellIndex + runOffset;
        const textStyle: Record<string, unknown> = {
          bold: Boolean(run.bold) || isHeaderRow,
          italic: Boolean(run.italic),
          strikethrough: Boolean(run.strikethrough),
        };
        const fields = ['bold', 'italic', 'strikethrough'];

        if (run.link) {
          textStyle['link'] = { url: run.link };
          fields.push('link');
        }
        if (run.code) {
          // Monospace is what `code` means; the size stays whatever the
          // document uses.
          textStyle['weightedFontFamily'] = { fontFamily: CODE_FONT_FAMILY };
          if (!fields.includes('weightedFontFamily')) fields.push('weightedFontFamily');
        }

        cellRequests.push({
          updateTextStyle: {
            range: { startIndex: start, endIndex: start + run.text.length },
            textStyle,
            fields: fields.join(','),
          },
        });

        runOffset += run.text.length;
      }
    }
  }

  return cellRequests;
}

// ── Sync service class ─────────────────────────────���─────────────────

/**
 * Where each phase sits on the 0-100 bar. The two counted phases own a band
 * rather than a point, so a sync spending thirty seconds uploading diagrams
 * shows movement instead of looking hung -- the whole reason this exists.
 */
const PROGRESS_BANDS: Record<SyncPhase, readonly [number, number]> = {
  reading: [0, 10],
  converting: [10, 20],
  diagrams: [25, 70],
  applying: [70, 80],
  tables: [80, 92],
  formatting: [92, 98],
  done: [100, 100],
};

/**
 * Percentage for a point in a sync. Counted phases interpolate across their
 * band by index/total; every other phase reports its band's end.
 */
export function syncProgressPercent(at: {
  phase: SyncPhase;
  index?: number;
  total?: number;
}): number {
  const [start, end] = PROGRESS_BANDS[at.phase];
  const total = at.total ?? 0;
  if (total <= 0) return end;
  const done = Math.min(Math.max(at.index ?? 0, 0), total);
  return Math.round(start + ((end - start) * done) / total);
}

/**
 * Fingerprint of a converted document: text, formatting and diagram sources.
 *
 * Taken before diagram uploads, so it contains no Drive links and is stable
 * across syncs of identical content. Comparing it against the last sync's
 * fingerprint is how an unchanged document is recognised without doing any
 * API work -- rebuilding formatting for a large document costs seconds even
 * when every request is a no-op.
 */
/**
 * True when the Doc holds nothing worth preserving.
 *
 * A brand-new Doc still has one empty paragraph, so its body ends at index 2.
 * Anything beyond that is real content -- which may carry comments, and so must
 * be diffed rather than replaced.
 */
function isBodyEmpty(apiDoc: GDocsApiDocument | null | undefined): boolean {
  const endIndex = apiDoc?.body?.content?.at(-1)?.endIndex;
  return endIndex == null || endIndex <= 2;
}

export function modelFingerprint(docsDoc: DocsDocument): string {
  return crypto.createHash('sha256').update(JSON.stringify(docsDoc)).digest('hex');
}

/** Cache key for an uploaded diagram: a hash of the rendered image bytes. */
export function imageCacheKey(pngBase64: string): string {
  return crypto.createHash('sha256').update(pngBase64).digest('hex');
}

export class GoogleDocsSyncService {
  /**
   * Set for the duration of one sync. Held on the instance rather than passed
   * down so the inner steps can report without every signature growing a
   * parameter it only forwards.
   */
  private progress?: (update: SyncProgressUpdate) => void;

  /** Report a point in the current sync, if anyone is listening. */
  private report(label: string, phase: SyncPhase, index?: number, total?: number): void {
    this.progress?.({ percent: syncProgressPercent({ phase, index, total }), label });
  }

  private docsService: GoogleDocsService;
  private linkStore: GoogleDocsLinkStore;

  constructor(docsService: GoogleDocsService, linkStore: GoogleDocsLinkStore) {
    this.docsService = docsService;
    this.linkStore = linkStore;
  }

  /**
   * Write down what the two sides now agree on.
   *
   * Used when a sync changed only the local file. The pair of snapshots is
   * how every later sync tells a real edit from a difference of dialect, so
   * skipping it would leave the next one comparing against a document that no
   * longer exists on either side.
   */
  private async recordSynced(
    filePath: string,
    docId: string,
    markdown: string,
    apiDoc: GDocsApiDocument,
  ): Promise<void> {
    await this.linkStore.saveBaseline(docId, this.docsService.extractPlainText(apiDoc));
    await this.linkStore.saveMarkdownSnapshots(docId, markdown, convertDocsToMarkdown(apiDoc));
    await this.linkStore.saveModelFingerprint(docId, modelFingerprint(convertMarkdownToDocs(markdown)));
    await this.linkStore.updateLastSynced(filePath, new Date().toISOString());
  }

  /**
   * Push the local markdown over a Doc that has also changed, making the Doc
   * match the file.
   *
   * Deliberately routes through `applyDiff`, never `fullPopulate`. Clearing the
   * body and reinserting it would be far simpler, but Google Docs comments
   * anchor to text ranges -- deleting the range detaches every comment in the
   * document, which defeats the point of syncing into a Doc at all. The diff
   * touches only the paragraphs that actually differ.
   */
  async syncForceOverwrite(
    filePath: string,
    docId: string,
    markdown: string,
    mermaidDiagrams?: MermaidDiagramData[],
    tableWidths?: TableColumnWidths[],
  ): Promise<GoogleDocsSyncResult> {
    try {
      console.warn('[SyncService] Push -- making the Doc match the file');
      const currentDoc = await this.docsService.getDocument(docId);
      const docsDoc = convertMarkdownToDocs(markdown);
      // Taken before the diagrams run, which mutate the model with Drive URLs.
      // sync() fingerprints at the same point, so the two agree.
      const fingerprint = modelFingerprint(docsDoc);
      await this.processMermaidDiagrams(docId, docsDoc, mermaidDiagrams);
      this.applyTableColumnWidths(docsDoc, tableWidths);

      // An empty doc has no comments to keep and no indices to diff against.
      const result = isBodyEmpty(currentDoc)
        ? await this.fullPopulate(docId, filePath, docsDoc, markdown)
        : await this.applyDiff(docId, filePath, currentDoc, docsDoc, markdown);
      // Without this the next sync always redoes the full diff and reformat.
      if (result.success) await this.linkStore.saveModelFingerprint(docId, fingerprint);
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Resolve a sync in two halves: look, then leap.
   *
   * `preview` reads the Doc, works out every difference from the file, and
   * hands them back without touching either side. `apply` takes the markdown
   * the user settled on and makes both sides hold it.
   *
   * The direction sets each difference's default and names the intent. It is
   * deliberately not a read-only lock on the other side: an apply must leave
   * the two sides holding the same content, because the snapshots record what
   * both sides agree on, and a divergence baked into them is invisible to
   * every later sync -- the file would keep an edit the Doc never receives,
   * with nothing left to notice it. Applying still goes through `applyDiff`,
   * never a clear-and-rebuild, so the Doc's comments survive either way.
   */
  async resolve(
    filePath: string,
    docId: string,
    mode: SyncResolveMode,
    direction: SyncDirection,
    markdown: string,
    options: {
      mermaidDiagrams?: MermaidDiagramData[];
      tableWidths?: TableColumnWidths[];
      onProgress?: (update: SyncProgressUpdate) => void;
      /**
       * Write new content to the local markdown file, reporting success.
       *
       * The local write always goes first. Recording a sync the file never
       * received would leave the next sync reading stale content, deciding the
       * local side had changed, and pushing it back over the Doc -- undoing
       * the very edits we just pulled in. Doing the file first means a later
       * failure leaves local ahead of the Doc, which the next sync heals by
       * pushing.
       */
      writeLocal?: (markdown: string) => Promise<boolean>;
      /**
       * The user kept something the direction would have discarded, so the
       * side they were not syncing towards has to receive it too. Without a
       * deviation the source already holds what the target is about to, and
       * writing it is pure damage: a pull would rewrite every block whose two
       * dialects differ, which is most of them.
       */
      alsoWriteSource?: boolean;
    } = {},
  ): Promise<GoogleDocsResolveResult> {
    this.progress = options.onProgress;
    try {
      if (mode === 'apply') {
        // `markdown` is what the user approved, so there is nothing left to
        // decide -- only which sides have to be told about it.
        const touchFile = direction === 'pull' || options.alsoWriteSource === true;
        const touchDoc = direction === 'push' || options.alsoWriteSource === true;

        if (touchFile && options.writeLocal && !(await options.writeLocal(markdown))) {
          return { success: false, error: 'Could not write the local file' };
        }

        // The label names the direction the user asked for: "applying
        // changes" says nothing about which document is about to move.
        const label = direction === 'pull'
          ? 'Pulling updates from the Google Doc'
          : 'Pushing updates to the Google Doc';

        if (!touchDoc) {
          // A pull the user took wholesale. The Doc is already right, so it is
          // read once for the record and left completely alone.
          this.report(label, 'applying');
          const currentDoc = await this.docsService.getDocument(docId);
          await this.recordSynced(filePath, docId, markdown, currentDoc);
          return { success: true, markdown };
        }

        this.report(label, 'applying');
        const pushed = await this.syncForceOverwrite(
          filePath, docId, markdown, options.mermaidDiagrams, options.tableWidths,
        );
        return pushed.success ? { ...pushed, markdown } : pushed;
      }

      this.report('Reading the Google Doc', 'reading');
      const currentDoc = await this.docsService.getDocument(docId);
      const remote = convertDocsToMarkdown(currentDoc);
      // Snapshots are keyed by document, but "has this file ever synced here"
      // is a fact about the (file, document) pair. Two files can point at one
      // Doc; without this the second inherits the first one's baseline, gets a
      // three-way merge against a document it has never seen, and every one of
      // its own blocks reads as unchanged.
      const link = this.linkStore.getLink(filePath);
      const neverSyncedThisFile = link != null && link.lastSyncedAt == null;
      const snapshots = neverSyncedThisFile
        ? null
        : await this.linkStore.loadMarkdownSnapshots(docId);

      // With snapshots, each side is diffed against its own dialect and the
      // lossiness cancels. Without them -- a first sync into a Doc that
      // already holds content -- the two documents as they stand are still a
      // perfectly good diff, just a noisier one.
      const outcome = snapshots !== null
        ? threeWayMerge({
          localBase: snapshots.local,
          local: markdown,
          remoteBase: snapshots.remote,
          remote,
        })
        : twoWayReview(markdown, remote);

      // The direction is every difference's default, so accepting the preview
      // wholesale makes the target say exactly what the source says.
      const preferred: SyncConflictChoice = direction === 'pull' ? 'remote' : 'local';
      const changes = outcome.changes.map((change) => ({ ...change, choice: preferred }));
      const blocks = applyResolutions(
        outcome.blocks, outcome.changes, changes.map((change) => change.choice),
      );

      // "Nothing to push" means the Doc already says what the file says --
      // not merely that the file has not moved. A Doc someone else edited has
      // drifted from the file, and making it match again is exactly the work
      // a push is for. Any difference at all is work in either direction.
      //
      // What the *other* side changed is what makes the defaults worth seeing
      // first, since applying them wholesale would revert it.
      const atStake: SyncChangeKind = direction === 'pull' ? 'local-only' : 'remote-only';

      return {
        success: true,
        changes,
        blocks,
        nothingToDo: changes.length === 0,
        needsReview: changes.some((c) => c.kind === atStake || c.kind === 'conflict'),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, status: (err as { status?: number }).status };
    } finally {
      this.report('Done', 'done');
      this.progress = undefined;
    }
  }


  /**
   * Process mermaid diagrams — match DocsElements with renderer-provided
   * diagram data, upload PNGs to Google Drive, and set imageLink on the
   * element so the builder can insert them as inline images.
   */
  /**
   * Attach column widths measured in the app's view to the model's tables.
   *
   * Matched by document order — the renderer walks the rendered tables in the
   * same sequence the converter produces them. A table whose column count does
   * not agree with its measurement is left alone, so a mismatch degrades to
   * Google's even distribution rather than skewing the wrong table.
   */
  private applyTableColumnWidths(
    docsDoc: DocsDocument,
    tableWidths?: TableColumnWidths[],
  ): void {
    if (!tableWidths || tableWidths.length === 0) return;

    let tableIdx = 0;
    for (const element of docsDoc.elements) {
      if (element.type !== 'table') continue;

      const measured = tableWidths[tableIdx];
      tableIdx++;
      if (!measured) continue;

      const columnCount = element.rows?.[0]?.length ?? 0;
      if (measured.fractions.length !== columnCount) continue;

      element.columnWidths = measured.fractions;
    }
  }

  private async processMermaidDiagrams(
    docId: string,
    docsDoc: DocsDocument,
    mermaidDiagrams?: MermaidDiagramData[],
  ): Promise<void> {
    if (!mermaidDiagrams || mermaidDiagrams.length === 0) return;

    const uploads = docsDoc.elements.filter(
      (el) => el.type === 'image' && el.code && mermaidDiagrams.some((d) => d.code === el.code),
    );
    const total = uploads.length;
    let done = 0;
    this.report('Preparing diagrams', 'diagrams', 0, total);

    const cache = await this.linkStore.loadImageCache(docId);
    let cacheChanged = false;

    for (const element of docsDoc.elements) {
      if (element.type === 'image' && element.code) {
        const diagram = mermaidDiagrams.find(d => d.code === element.code);
        if (!diagram) continue;

        // Identical bytes mean Drive already holds this image; uploading it
        // again costs a round trip and produces a duplicate file.
        const key = imageCacheKey(diagram.pngBase64);
        const cachedFileId = cache[key];
        if (cachedFileId) {
          element.imageLink = `https://drive.google.com/uc?id=${cachedFileId}`;
          element.mermaidLiveUrl = diagram.liveUrl;
          done += 1;
          this.report(`Diagram ${done} of ${total} unchanged`, 'diagrams', done, total);
          continue;
        }

        this.report(`Uploading diagram ${done + 1} of ${total}`, 'diagrams', done, total);

        try {
          // Upload PNG to Google Drive
          const imageBuffer = Buffer.from(diagram.pngBase64, 'base64');
          const fileId = await this.docsService.uploadImage(
            imageBuffer,
            `mermaid-${Date.now()}.png`,
          );

          // Set image link to Drive URI for insertInlineImage
          element.imageLink = `https://drive.google.com/uc?id=${fileId}`;
          element.mermaidLiveUrl = diagram.liveUrl;
          cache[key] = fileId;
          cacheChanged = true;
          done += 1;
          this.report(`Uploaded diagram ${done} of ${total}`, 'diagrams', done, total);
        } catch (error) {
          console.warn('Failed to upload mermaid diagram to Drive:', error);
          // Continue without the image — it will be skipped by the builder
        }
      }
    }

    if (cacheChanged) {
      await this.linkStore.saveImageCache(docId, cache);
    }
  }

  /**
   * Full populate — used on first sync when no baseline exists.
   */
  private async fullPopulate(
    docId: string,
    filePath: string,
    docsDoc: DocsDocument,
    markdown: string,
  ): Promise<GoogleDocsSyncResult> {
    // First, clear any existing content from the doc
    const currentDoc = await this.docsService.getDocument(docId);
    const endIndex = currentDoc?.body?.content?.at(-1)?.endIndex;
    if (endIndex && endIndex > 2) {
      console.warn('[SyncService] Clearing existing doc content (endIndex: %d)', endIndex);
      await this.docsService.batchUpdate(docId, [{
        deleteContentRange: {
          range: { startIndex: 1, endIndex: endIndex - 1 },
        },
      }]);
    }

    // Phase 1: Insert all text content (tables as placeholders)
    this.report('Writing the document text', 'applying');
    const { requests, pendingTables } = buildInsertRequests(docsDoc, 1);
    console.warn('[SyncService] fullPopulate: %d requests, %d pending tables', requests.length, pendingTables.length);
    if (requests.length > 0) {
      await this.docsService.batchUpdate(docId, requests);
    }

    // Phase 2: Replace table placeholders with real tables
    if (pendingTables.length > 0) {
      await this.populateTables(docId, pendingTables);
    }

    // Read back the doc from API and save its text as baseline.
    // This ensures baseline matches future API reads (avoiding false
    // external-edit detection from format differences in tables/images).
    this.report('Applying formatting', 'formatting');
    const populatedDoc = await this.docsService.getDocument(docId);
    const actualText = this.docsService.extractPlainText(populatedDoc);
    await this.linkStore.saveBaseline(docId, actualText);
    await this.linkStore.saveMarkdownSnapshots(docId, markdown, convertDocsToMarkdown(populatedDoc));
    await this.linkStore.updateLastSynced(filePath, new Date().toISOString());
    return { success: true };
  }

  /**
   * Phase 2: Find table placeholders in the doc, replace each with a real table,
   * then populate cells.
   */

  /**
   * Bring the blank paragraphs in front of a structural element back to what
   * the document should have: one after body text, which separates the two,
   * and none after a heading, which already carries space below it.
   *
   * They accumulate because Docs writes a newline ahead of every table it
   * inserts, and because emptying a paragraph that precedes a table cannot
   * take that paragraph's own newline with it.
   *
   * The obvious range is illegal. The blank's own newline is "the newline
   * character before a Table", which Google refuses to delete unless the
   * table goes too -- and the table is exactly what a comment-preserving sync
   * protects. So the newlines above it go instead: the blanks merge upward,
   * the surviving paragraph keeps the text and style of the one above, and
   * the newline in front of the table is never touched.
   *
   * Returns the request for one element, or null when there is nothing to do.
   */
  private blankMergeRequest(
    doc: GDocsApiDocument,
    structuralStartIndex: number,
  ): DocsBatchUpdateRequest | null {
    const content = doc?.body?.content ?? [];
    const at = content.findIndex((el) => el.startIndex === structuralStartIndex);
    if (at < 1) return null;

    let first = at;
    while (first > 0 && isBlankParagraph(content[first - 1])) first--;
    const blanks = at - first;
    if (blanks === 0) return null;

    const above = content[first - 1];
    // Only a paragraph's newline can be taken. A table above ends in its own
    // undeletable boundary, and the top of the body has nothing at all -- in
    // either case the blanks stay, because deleting their own newlines is
    // what Google refuses.
    if (!above?.paragraph) return null;

    const wanted = isHeading(above) ? 0 : 1;
    const excess = blanks - wanted;
    if (excess <= 0) return null;

    const from = above.endIndex;
    if (from == null || from - 1 < 1) return null;

    return {
      deleteContentRange: { range: { startIndex: from - 1, endIndex: from - 1 + excess } },
    };
  }

  /**
   * Apply blankMergeRequest to every table, table of contents and section
   * break in the document.
   *
   * Failure is tolerated: the spacing is cosmetic and must not take down a
   * sync that has otherwise succeeded.
   */
  private async removeBlanksBeforeStructuralElements(docId: string): Promise<void> {
    try {
      const doc = await this.docsService.getDocument(docId);
      // Bottom-up, so an earlier deletion cannot shift a later range.
      const starts = [...structuralStartIndices(doc)].sort((a, b) => b - a);
      const requests = starts
        .map((start) => this.blankMergeRequest(doc, start))
        .filter((r): r is DocsBatchUpdateRequest => r != null);

      if (requests.length > 0) {
        await this.docsService.batchUpdate(docId, requests);
      }
    } catch (error) {
      console.warn('[SyncService] Could not tidy the blank lines before a table:', error);
    }
  }


  private async populateTables(
    docId: string,
    pendingTables: PendingTable[],
  ): Promise<void> {
    let built = 0;
    for (const table of pendingTables) {
      // Each table costs a document read and two round trips, so on a
      // table-heavy document this loop is most of the sync. Reporting it is
      // what keeps the bar from sitting on the last diagram for a minute.
      this.report(
        `Building table ${built + 1} of ${pendingTables.length}`,
        'tables', built, pendingTables.length,
      );
      built += 1;
      // Read doc to find the placeholder
      const doc = await this.docsService.getDocument(docId);
      const content = doc?.body?.content ?? [];

      let placeholderIndex = -1;
      let placeholderEndIndex = -1;

      for (const el of content) {
        if (el.paragraph) {
          for (const pe of el.paragraph.elements ?? []) {
            if (pe.textRun?.content?.includes(table.placeholderText.trim())) {
              placeholderIndex = el.startIndex ?? -1;
              placeholderEndIndex = el.endIndex ?? -1;
              break;
            }
          }
          if (placeholderIndex >= 0) break;
        }
      }

      if (placeholderIndex < 0) {
        console.warn('[SyncService] Table placeholder not found:', table.placeholderText.trim());
        continue;
      }

      const numRows = table.rows.length;
      const numCols = table.rows[0]?.length ?? 1;

      // Delete placeholder paragraph, then insert table at that position
      await this.docsService.batchUpdate(docId, [
        { deleteContentRange: { range: { startIndex: placeholderIndex, endIndex: placeholderEndIndex } } },
        { insertTable: { rows: numRows, columns: numCols, location: { index: placeholderIndex } } },
      ]);

      // Read doc to find actual cell indices
      const docAfterTable = await this.docsService.getDocument(docId);
      const tableEl = findTableElement(docAfterTable?.body?.content ?? [], placeholderIndex);

      if (!tableEl?.table) {
        console.warn('[SyncService] Inserted table not found at index', placeholderIndex);
        continue;
      }

      // Populate cells — insert text into each cell's paragraph
      // Process in reverse order to preserve indices
      const cellRequests = buildCellRequests(tableEl, table.rows);

      // Column widths go last: they do not move text, and computing them from
      // the pre-insert table start keeps the location valid.
      const widthRequests = buildColumnWidthRequests(
        tableEl.startIndex ?? placeholderIndex,
        numCols,
        table.columnWidths,
        getUsableWidthPt(docAfterTable),
      );

      const allRequests = [...cellRequests, ...widthRequests];
      if (allRequests.length > 0) {
        await this.docsService.batchUpdate(docId, allRequests);
      }

    }

    await this.removeBlanksBeforeStructuralElements(docId);
  }

  /**
   * Apply diff — uses paragraph-level diffing with actual API indices to
   * compute minimal changes, then syncs structural elements (tables/images),
   * then reapplies formatting.
   *
   * Comment preservation:
   * - Unchanged paragraphs are skipped entirely -> all comments preserved
   * - 1:1 modified paragraphs use character-level diff -> comments on
   *   unchanged words within the paragraph are preserved
   * - Deleted paragraphs lose their comments (unavoidable)
   * - Formatting operations never affect comment anchors
   * - Unchanged tables/images are skipped -> comments preserved
   * - Changed tables/images are deleted and re-inserted (comments on them lost)
   */
  private async applyDiff(
    docId: string,
    filePath: string,
    currentApiDoc: GDocsApiDocument,
    newDocsDoc: DocsDocument,
    markdown: string,
  ): Promise<GoogleDocsSyncResult> {
    // Phase 1: Text paragraph diff
    this.report('Updating the document text', 'applying');
    const apiParas = extractApiParagraphs(currentApiDoc);
    const modelElements = flattenElements(newDocsDoc.elements);

    const docBodyEndIndex = currentApiDoc?.body?.content?.at(-1)?.endIndex;
    const operations = generateParagraphDiffOperations(
      apiParas,
      modelElements,
      docBodyEndIndex,
      structuralStartIndices(currentApiDoc),
    );
    if (operations.length > 0) {
      console.warn('[SyncService] applyDiff: %d paragraph-diff operations', operations.length);
      await this.docsService.batchUpdate(docId, operations);
    }

    // Phase 2: Structural element sync (tables and images)
    await this.syncStructuralElements(docId, newDocsDoc);

    // Emptying a paragraph that sits in front of a table cannot take its
    // newline with it, so the paragraph is left behind as a blank line.
    await this.removeBlanksBeforeStructuralElements(docId);

    // Phase 3: Read doc back and apply formatting
    this.report('Applying formatting', 'formatting');
    const finalDoc = await this.docsService.getDocument(docId);
    const formattingOps = buildFormattingFromApiDoc(finalDoc, newDocsDoc);
    if (formattingOps.length > 0) {
      console.warn('[SyncService] applyDiff: %d formatting requests', formattingOps.length);
      await this.docsService.batchUpdate(docId, formattingOps);
    }

    // Phase 4: Save baseline from API text
    const baselineText = this.docsService.extractPlainText(finalDoc);
    await this.linkStore.saveBaseline(docId, baselineText);
    // Both dialects of this moment, so the next merge has something to diff
    // each side against. finalDoc is already in hand -- no extra API call.
    await this.linkStore.saveMarkdownSnapshots(docId, markdown, convertDocsToMarkdown(finalDoc));
    await this.linkStore.updateLastSynced(filePath, new Date().toISOString());
    return { success: true };
  }

  /**
   * Sync structural elements (tables and images) that were excluded from
   * the paragraph-level diff.  Compares API tables/images with model
   * elements by position, and deletes + re-inserts any that changed.
   */
  private async syncStructuralElements(
    docId: string,
    newDocsDoc: DocsDocument,
  ): Promise<void> {
    // Read current doc to get structural element positions
    const doc = await this.docsService.getDocument(docId);

    // ── Tables ────��────────────────────────��────────────────────
    const apiTables = extractApiTables(doc);
    // Positions are kept so a newly added table can be placed where the
    // markdown puts it rather than appended to the end of the document.
    const modelTableEntries = newDocsDoc.elements
      .map((el, position) => ({ el, position }))
      .filter(({ el }) => el.type === 'table');
    const modelTables = modelTableEntries.map((e) => e.el);

    // Pair the two lists by their header row, not by ordinal.
    //
    // Deleting a table in the Doc used to shift every table after it by one,
    // so each was compared against its neighbour's twin: the survivors were
    // rewritten into each other and the deleted one reappended at the end.
    // Exact content is no good as the key either -- a table someone edited no
    // longer matches its own twin -- but a header row survives ordinary edits,
    // which is exactly what has to be seen through.
    const pairs: Array<{ apiTable: ApiTable; modelTable: DocsElement }> = [];
    const tablesToDelete: ApiTable[] = [];
    const tablesToAdd: Array<{ el: DocsElement; position: number }> = [];

    {
      const changes = diffArrays(
        apiTables.map(apiTableHeaderKey),
        modelTables.map(modelTableHeaderKey),
      );
      let ai = 0;
      let mi = 0;
      for (let ci = 0; ci < changes.length; ci++) {
        const change = changes[ci]!;
        const count = change.value.length;

        if (!change.added && !change.removed) {
          for (let k = 0; k < count; k++) {
            pairs.push({ apiTable: apiTables[ai + k]!, modelTable: modelTables[mi + k]! });
          }
          ai += count;
          mi += count;
          continue;
        }

        if (change.removed) {
          const added = changes[ci + 1]?.added === true ? changes[ci + 1]!.value.length : 0;
          // A removed run against an added one is a set of headers that were
          // rewritten; pair as many as line up and treat the rest as real
          // additions and deletions.
          const matched = Math.min(count, added);
          for (let k = 0; k < matched; k++) {
            pairs.push({ apiTable: apiTables[ai + k]!, modelTable: modelTables[mi + k]! });
          }
          for (let k = matched; k < count; k++) tablesToDelete.push(apiTables[ai + k]!);
          for (let k = matched; k < added; k++) tablesToAdd.push(modelTableEntries[mi + k]!);
          ai += count;
          mi += added;
          if (added > 0) ci++;
          continue;
        }

        for (let k = 0; k < count; k++) tablesToAdd.push(modelTableEntries[mi + k]!);
        mi += count;
      }
    }

    // Track tables that need replacement (process in reverse for index stability)
    const tablesToReplace: Array<{ apiTable: ApiTable; modelTable: DocsElement }> = [];

    // Cell-level edits for every table whose shape still matches. Collected
    // across all tables and sent as one batch; emitted in reverse index order,
    // so earlier tables' indices stay valid.
    // Tables whose row count changed but whose columns still line up. Adding
    // or removing a row is an ordinary edit and must not cost the table its
    // comments, so the rows are inserted or deleted in place and the text is
    // filled in afterwards.
    const tablesToResize: Array<{ apiTable: ApiTable; modelTable: DocsElement; columnDelta: number }> = [];
    let anyCellChanged = false;

    console.warn(
      '[SyncService] tables: %d in the Doc, %d in the file -> %d paired, %d to add, %d to delete',
      apiTables.length, modelTables.length, pairs.length, tablesToAdd.length, tablesToDelete.length,
    );
    for (const t of tablesToDelete) console.warn('[SyncService]   deleting: %s', apiTableHeaderKey(t));
    for (const t of tablesToAdd) console.warn('[SyncService]   adding: %s', modelTableHeaderKey(t.el));

    for (const { apiTable, modelTable } of pairs) {
      if (apiTable.cellTexts === modelTableCellTexts(modelTable)) continue;
      console.warn(
        '[SyncService]   changed: %s (Doc %dx%d, file %dx%d)',
        apiTableHeaderKey(apiTable),
        apiTable.rowCount, apiTable.columnCount,
        (modelTable.rows ?? []).length, (modelTable.rows?.[0] ?? []).length,
      );
      anyCellChanged = true;

      const modelRows = modelTable.rows ?? [];
      const modelColumns = modelRows[0]?.length ?? 0;
      // A ragged table has no single column count to reshape towards. Markdown
      // cannot express one, so this is a converter fault rather than an edit.
      const ragged = modelColumns === 0 || modelRows.some((row) => row.length !== modelColumns);

      if (ragged) {
        tablesToReplace.push({ apiTable, modelTable });
        continue;
      }

      // Always offered for reshaping: rows are matched by content, so a row
      // moved or replaced needs work even when the count has not changed.
      // resizeTable sends nothing when there is nothing to do.
      tablesToResize.push({
        apiTable,
        modelTable,
        columnDelta: modelColumns - apiTable.columnCount,
      });
    }

    // Process table deletions and replacements in reverse document order
    const allTableOps = [
      ...tablesToReplace.map(t => ({ type: 'replace' as const, ...t })),
      ...tablesToDelete.map(t => ({ type: 'delete' as const, apiTable: t })),
    ].sort((a, b) => b.apiTable.endIndex - a.apiTable.endIndex);

    // Each of these is a round trip to Google, and on a table-heavy document
    // they are most of the sync. Counted up front so the bar can move through
    // them rather than sitting on whatever the diagram pass last said.
    const tableSteps = allTableOps.length
      + (tablesToAdd.length > 0 ? 1 : 0)
      + tablesToResize.length
      + (anyCellChanged ? 1 : 0);
    let tableStep = 0;
    const reportTable = (what: string): void => {
      tableStep += 1;
      this.report(`${what} ${tableStep} of ${tableSteps}`, 'tables', tableStep - 1, tableSteps);
    };

    for (const op of allTableOps) {
      reportTable(op.type === 'delete' ? 'Removing table' : 'Rebuilding table');
      if (op.type === 'delete') {
        await this.docsService.batchUpdate(docId, [{
          deleteContentRange: { range: { startIndex: op.apiTable.startIndex, endIndex: op.apiTable.endIndex } },
        }]);
      } else {
        // Replace: delete old table then insert new one at the same position
        await this.replaceTable(docId, op.apiTable, op.modelTable);
      }
    }

    // Insert new tables (added in markdown)
    if (tablesToAdd.length > 0) {
      reportTable('Adding tables, step');
      await this.insertNewTables(docId, tablesToAdd, newDocsDoc.elements);
    }

    // Resize in reverse document order so earlier tables keep their indices.
    for (const op of [...tablesToResize].sort((a, b) => b.apiTable.startIndex - a.apiTable.startIndex)) {
      reportTable('Resizing table');
      await this.resizeTable(docId, op.apiTable, op.modelTable, op.columnDelta);
    }

    // Finally, fill in the text. Re-read first: anything above did move
    // indices, and the cell diff addresses real positions.
    if (anyCellChanged) {
      reportTable('Filling in table text, step');
      await this.applyTableCellEdits(docId, modelTables);
    }

    // ── Images (mermaid diagrams) ────────────���──────────────────
    const modelImageEntries = newDocsDoc.elements
      .map((el, position) => ({ el, position }))
      .filter(({ el }) => el.type === 'image' && el.imageLink);
    const modelImages = modelImageEntries.map((e) => e.el);
    if (modelImages.length === 0) return;

    const imgDoc = await this.docsService.getDocument(docId);
    const apiImages = extractApiImageBlocks(imgDoc);

    // Paired on the mermaid.live URL, which is the diagram's identity -- for
    // the same reason tables are paired on their header row. By ordinal, a
    // diagram deleted in the Doc shifted every one after it, and the survivor
    // was rewritten into its neighbour.
    const imagesToReplace: Array<{ apiImage: ApiImageBlock; modelImage: DocsElement }> = [];
    const imagesToDelete: ApiImageBlock[] = [];
    const imagesToAdd: Array<{ el: DocsElement; position: number }> = [];

    {
      const changes = diffArrays(
        apiImages.map((img) => img.mermaidLiveUrl ?? ''),
        modelImages.map((img) => img.mermaidLiveUrl ?? ''),
      );
      let ai = 0;
      let mi = 0;
      for (let ci = 0; ci < changes.length; ci++) {
        const change = changes[ci]!;
        const count = change.value.length;

        if (!change.added && !change.removed) {
          // Same URL means the same diagram, unchanged. Nothing to do.
          ai += count;
          mi += count;
          continue;
        }

        if (change.removed) {
          const added = changes[ci + 1]?.added === true ? changes[ci + 1]!.value.length : 0;
          const matched = Math.min(count, added);
          for (let k = 0; k < matched; k++) {
            imagesToReplace.push({ apiImage: apiImages[ai + k]!, modelImage: modelImages[mi + k]! });
          }
          for (let k = matched; k < count; k++) imagesToDelete.push(apiImages[ai + k]!);
          for (let k = matched; k < added; k++) imagesToAdd.push(modelImageEntries[mi + k]!);
          ai += count;
          mi += added;
          if (added > 0) ci++;
          continue;
        }

        for (let k = 0; k < count; k++) imagesToAdd.push(modelImageEntries[mi + k]!);
        mi += count;
      }
    }

    // Process image replacements and deletions in reverse document order
    const allImageOps = [
      ...imagesToReplace.map(t => ({ type: 'replace' as const, ...t })),
      ...imagesToDelete.map(t => ({ type: 'delete' as const, apiImage: t })),
    ].sort((a, b) => b.apiImage.endIndex - a.apiImage.endIndex);

    let imageStep = 0;
    for (const op of allImageOps) {
      imageStep += 1;
      this.report(
        `Placing diagram ${imageStep} of ${allImageOps.length}`,
        'tables', tableSteps + imageStep - 1, tableSteps + allImageOps.length,
      );
      if (op.type === 'delete') {
        await this.docsService.batchUpdate(docId, [{
          deleteContentRange: { range: { startIndex: op.apiImage.startIndex, endIndex: op.apiImage.endIndex } },
        }]);
      } else {
        await this.replaceImage(docId, op.apiImage, op.modelImage);
      }
    }

    // New images go where the markdown puts them, not at the end.
    for (const { el: modelImage, position } of imagesToAdd) {
      // Re-read each time: the previous insert moved everything after it.
      const currentDoc = await this.docsService.getDocument(docId);
      const insertAt = insertionIndexFor(currentDoc, newDocsDoc.elements, position);
      await this.insertImageAtIndex(docId, insertAt, modelImage);
    }
  }

  /**
   * Reshape a table to the markdown's dimensions, keeping the rest of it intact.
   *
   * Rows and columns are added at the far edge, or removed from the far edge
   * inwards, so every surviving cell -- and the comments anchored in it --
   * stays exactly where it was. Rebuilding the table would be simpler and
   * would detach all of them.
   *
   * Row operations address column 0 and column operations address row 0, both
   * of which survive any resize, so the two can share one batch.
   */
  private async resizeTable(
    docId: string,
    apiTable: ApiTable,
    modelTable: DocsElement,
    columnDelta: number,
  ): Promise<void> {
    const tableStartLocation = { index: apiTable.startIndex };
    const requests: DocsBatchUpdateRequest[] = [];

    // Bottom up, so a row added or removed above does not move the rows an
    // operation further down still refers to.
    const rowOps = tableRowOperations(apiTable, modelTable)
      .sort((a, b) => b.at - a.at);

    for (const op of rowOps) {
      if (op.type === 'insert') {
        for (let n = 0; n < op.count; n++) {
          // Inserting above row `at` puts it where it went missing. Past the
          // last row there is nothing to sit above, so it goes below instead.
          const append = op.at >= apiTable.rowCount;
          requests.push({
            insertTableRow: {
              tableCellLocation: {
                tableStartLocation,
                rowIndex: append ? apiTable.rowCount - 1 : op.at,
                columnIndex: 0,
              },
              insertBelow: append,
            },
          });
        }
        continue;
      }
      for (let n = op.count - 1; n >= 0; n--) {
        requests.push({
          deleteTableRow: {
            tableCellLocation: { tableStartLocation, rowIndex: op.at + n, columnIndex: 0 },
          },
        });
      }
    }

    for (let n = 0; n < columnDelta; n++) {
      requests.push({
        insertTableColumn: {
          tableCellLocation: {
            tableStartLocation,
            rowIndex: 0,
            columnIndex: apiTable.columnCount - 1 + n,
          },
          insertRight: true,
        },
      });
    }
    // Likewise right to left, so the columns to the left are unaffected.
    for (let n = 0; n < -columnDelta; n++) {
      requests.push({
        deleteTableColumn: {
          tableCellLocation: {
            tableStartLocation,
            rowIndex: 0,
            columnIndex: apiTable.columnCount - 1 - n,
          },
        },
      });
    }

    if (requests.length > 0) {
      console.warn(
        '[SyncService] table reshape: %d row op(s), %d column op(s) on %s',
        rowOps.reduce((n, op) => n + op.count, 0), Math.abs(columnDelta),
        apiTableHeaderKey(apiTable),
      );
      await this.docsService.batchUpdate(docId, requests);
    }
  }

  /**
   * Bring every table's text up to date, editing cells in place.
   *
   * Runs from a fresh read so the indices are the ones that exist now, after
   * any rows were added or removed.
   */
  private async applyTableCellEdits(docId: string, modelTables: DocsElement[]): Promise<void> {
    const apiTables = extractApiTables(await this.docsService.getDocument(docId));
    const requests: DocsBatchUpdateRequest[] = [];

    // Paired on the header row, not by ordinal -- for the same reason the
    // outer pass is. One table missing on either side would otherwise shift
    // every table after it and write each one's text into its neighbour.
    for (const { apiTable, modelTable } of pairTablesByHeader(apiTables, modelTables)) {
      const edits = tableCellDiffRequests(apiTable, modelTable);
      if (edits === null) {
        console.warn('[SyncService] table cell diff skipped (shape mismatch): %s',
          apiTableHeaderKey(apiTable));
        continue;
      }
      requests.push(...edits);
    }

    if (requests.length === 0) return;
    console.warn('[SyncService] table cell edits: %d request(s)', requests.length);
    // Descending by the index each request touches, so nothing shifts beneath
    // a request that has not run yet.
    requests.sort((a, b) => requestIndex(b) - requestIndex(a));
    await this.docsService.batchUpdate(docId, requests);
  }

  /**
   * Replace a table at its current position: delete old, insert new.
   */
  private async replaceTable(
    docId: string,
    apiTable: ApiTable,
    modelTable: DocsElement,
  ): Promise<void> {
    const insertAt = apiTable.startIndex;
    const rows = modelTable.rows ?? [];
    if (rows.length === 0) return;

    const numRows = rows.length;
    const numCols = rows[0]!.length;

    // Delete old table, insert new one at same position
    await this.docsService.batchUpdate(docId, [
      { deleteContentRange: { range: { startIndex: apiTable.startIndex, endIndex: apiTable.endIndex } } },
      { insertTable: { rows: numRows, columns: numCols, location: { index: insertAt } } },
    ]);

    // Read doc to get cell indices, then populate cells
    const pendingTable: PendingTable = {
      placeholderText: '', // not used for direct table insertion
      rows,
      ...(modelTable.columnWidths && { columnWidths: modelTable.columnWidths }),
      ...(modelTable.suppressLeadingBlank && { suppressLeadingBlank: true }),
    };
    await this.populateTableAtIndex(docId, insertAt, pendingTable);
  }

  /**
   * Populate a table that was just inserted at a known index position.
   * Similar to populateTables but for a single table at a known location.
   */
  private async populateTableAtIndex(
    docId: string,
    afterIndex: number,
    table: PendingTable,
  ): Promise<void> {
    const doc = await this.docsService.getDocument(docId);
    const tableEl = findTableElement(doc?.body?.content ?? [], afterIndex);

    if (!tableEl?.table) {
      console.warn('[SyncService] Table not found at index', afterIndex);
      return;
    }

    const cellRequests = buildCellRequests(tableEl, table.rows);

    const widthRequests = buildColumnWidthRequests(
      tableEl.startIndex ?? afterIndex,
      tableEl.table?.tableRows?.[0]?.tableCells?.length ?? 0,
      table.columnWidths,
      getUsableWidthPt(doc),
    );

    const allRequests = [...cellRequests, ...widthRequests];
    if (allRequests.length > 0) {
      await this.docsService.batchUpdate(docId, allRequests);
    }

  }

  /**
   * Insert new tables that were added in the markdown.
   * Uses the two-phase placeholder approach from fullPopulate.
   */
  private async insertNewTables(
    docId: string,
    newTables: Array<{ el: DocsElement; position: number }>,
    elements: DocsElement[],
  ): Promise<void> {
    for (const { el: modelTable, position } of newTables) {
      const rows = modelTable.rows ?? [];
      if (rows.length === 0) continue;

      // Re-read each time: the previous insert moved everything after it.
      const currentDoc = await this.docsService.getDocument(docId);
      const insertAt = insertionIndexFor(currentDoc, elements, position);

      const numRows = rows.length;
      const numCols = rows[0]!.length;

      await this.docsService.batchUpdate(docId, [
        { insertTable: { rows: numRows, columns: numCols, location: { index: insertAt } } },
      ]);

      const pendingTable: PendingTable = { placeholderText: '', rows };
      await this.populateTableAtIndex(docId, insertAt, pendingTable);
    }
  }

  /**
   * Replace an image block (inline image + optional link paragraph).
   */
  private async replaceImage(
    docId: string,
    apiImage: ApiImageBlock,
    modelImage: DocsElement,
  ): Promise<void> {
    // Delete old image block
    await this.docsService.batchUpdate(docId, [{
      deleteContentRange: { range: { startIndex: apiImage.startIndex, endIndex: apiImage.endIndex } },
    }]);

    // Insert new image at the same position
    await this.insertImageAtIndex(docId, apiImage.startIndex, modelImage);
  }

  /**
   * Insert an image element at a specific document index.
   */
  private async insertImageAtIndex(
    docId: string,
    insertAt: number,
    element: DocsElement,
  ): Promise<void> {
    if (!element.imageLink) return;

    const requests: DocsBatchUpdateRequest[] = [];
    let idx = insertAt;

    requests.push({
      insertInlineImage: {
        uri: element.imageLink,
        location: { index: idx },
        objectSize: {
          width: { magnitude: 400, unit: 'PT' },
          height: { magnitude: 300, unit: 'PT' },
        },
      },
    });
    idx += 1;

    if (element.mermaidLiveUrl) {
      const linkText = '\nEdit in Mermaid Live\n';
      requests.push({
        insertText: { text: linkText, location: { index: idx } },
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: idx + 1, endIndex: idx + linkText.length - 1 },
          textStyle: {
            link: { url: element.mermaidLiveUrl },
          },
          fields: 'link',
        },
      });
    } else {
      requests.push({
        insertText: { text: '\n', location: { index: idx } },
      });
    }

    await this.docsService.batchUpdate(docId, requests);
  }
}

// ── Factory ───��──────────────────────────────────────────────────────

export function createGoogleDocsSyncService(
  docsService: GoogleDocsService,
  linkStore: GoogleDocsLinkStore,
): GoogleDocsSyncService {
  return new GoogleDocsSyncService(docsService, linkStore);
}

// Exported for testing
export { generateParagraphDiffOperations };
