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
  endIndex?: number;
  text?: string;
  /**
   * True for ranges *inside* a paragraph, which carry no trailing newline.
   * Paragraph-level deletes have one and must exclude it; character-level
   * deletes must not have their range shortened, or one character of every
   * removed run survives.
   */
  withinParagraph?: boolean;
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
        withinParagraph: true,
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
): DocsBatchUpdateRequest[] {
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
          // Delete old paragraphs (collect range from first to last)
          const deleteStart = apiParas[apiIdx]!.startIndex;
          const deleteEnd = apiParas[apiIdx + removedCount - 1]!.endIndex;
          allOps.push({ type: 'delete', index: deleteStart, endIndex: deleteEnd });
          // Insert new paragraphs as text
          let newText = '';
          for (let i = 0; i < addedCount; i++) {
            newText += getLeafText(modelElements[modelIdx + i]!) + '\n';
          }
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
          allOps.push({ type: 'delete', index: para.startIndex, endIndex: para.endIndex });
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

  // Build API requests in reverse order for index stability.
  //
  // Google Docs rule: deleteContentRange cannot include the trailing
  // newline of any segment (body, table cell, section).  We handle this
  // by subtracting 1 from endIndex on every delete — paragraph endIndex
  // always includes the trailing `\n`, and the next paragraph's
  // startIndex will be right after it, so the `\n` gets deleted when
  // the adjacent paragraph is processed or stays as a harmless boundary.
  //
  // Additionally, clamp against the document body end to protect the
  // mandatory document-ending newline.
  const maxDeleteEnd = docBodyEndIndex != null ? docBodyEndIndex - 1 : undefined;

  return diffOpsToRequests(allOps, maxDeleteEnd);
}

/**
 * Turn diff operations into batchUpdate requests.
 *
 * Emitted in reverse order so that every index an earlier request refers to is
 * still valid when it runs.
 */
function diffOpsToRequests(ops: DiffOp[], maxDeleteEnd?: number): DocsBatchUpdateRequest[] {
  const requests: DocsBatchUpdateRequest[] = [];
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]!;
    if (op.type === 'delete') {
      let endIdx = op.endIndex ?? op.index;
      // Exclude the trailing newline from paragraph-level deletes only. A
      // character-level range has no newline to exclude, and shortening it
      // leaves the last character of every removed run behind.
      if (!op.withinParagraph) {
        endIdx = endIdx - 1;
      }
      // Also clamp to doc body end
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
  applying: [70, 85],
  tables: [90, 100],
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
    } = {},
  ): Promise<GoogleDocsResolveResult> {
    this.progress = options.onProgress;
    try {
      if (mode === 'apply') {
        // `markdown` is what the user approved, so there is nothing left to
        // decide -- write it, then make the Doc match.
        if (options.writeLocal && !(await options.writeLocal(markdown))) {
          return { success: false, error: 'Could not write the local file' };
        }
        this.report('Applying changes', 'applying');
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

      // A pull carries what the Doc changed, a push what the file did. What
      // the *other* side changed is what makes the defaults worth seeing
      // before they are applied -- accepting them wholesale would revert it.
      const carried: SyncChangeKind = direction === 'pull' ? 'remote-only' : 'local-only';
      const atStake: SyncChangeKind = direction === 'pull' ? 'local-only' : 'remote-only';

      return {
        success: true,
        changes,
        blocks,
        nothingToDo: !changes.some((c) => c.kind === carried || c.kind === 'conflict'),
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
   * Remove the blank paragraph Docs puts before a table.
   *
   * insertTable always writes a newline ahead of the table, so the table starts
   * one index after the requested location. This runs after the cells and
   * widths, because deleting the newline shifts every index inside the table.
   *
   * Failure is tolerated: the spacing is cosmetic and must not take down a
   * sync that has otherwise succeeded.
   */
  private async removeLeadingBlankParagraph(
    docId: string,
    tableStartIndex: number,
  ): Promise<void> {
    // Index 1 is the start of the body; there is nothing before it to remove.
    if (tableStartIndex <= 1) return;

    try {
      await this.docsService.batchUpdate(docId, [
        {
          deleteContentRange: {
            range: { startIndex: tableStartIndex - 1, endIndex: tableStartIndex },
          },
        },
      ]);
    } catch (error) {
      console.warn('[SyncService] Could not remove the blank line before a table:', error);
    }
  }

  private async populateTables(
    docId: string,
    pendingTables: PendingTable[],
  ): Promise<void> {
    for (const table of pendingTables) {
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

      if (table.suppressLeadingBlank && tableEl.startIndex !== undefined) {
        await this.removeLeadingBlankParagraph(docId, tableEl.startIndex);
      }
    }
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
    const apiParas = extractApiParagraphs(currentApiDoc);
    const modelElements = flattenElements(newDocsDoc.elements);

    const docBodyEndIndex = currentApiDoc?.body?.content?.at(-1)?.endIndex;
    const operations = generateParagraphDiffOperations(apiParas, modelElements, docBodyEndIndex);
    if (operations.length > 0) {
      console.warn('[SyncService] applyDiff: %d paragraph-diff operations', operations.length);
      await this.docsService.batchUpdate(docId, operations);
    }

    // Phase 2: Structural element sync (tables and images)
    await this.syncStructuralElements(docId, newDocsDoc);

    // Phase 3: Read doc back and apply formatting
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

    // Match by position (1st model table <-> 1st API table, etc.)
    const tableCount = Math.min(apiTables.length, modelTables.length);
    // Track tables that need replacement (process in reverse for index stability)
    const tablesToReplace: Array<{ apiTable: ApiTable; modelTable: DocsElement }> = [];

    // Cell-level edits for every table whose shape still matches. Collected
    // across all tables and sent as one batch; emitted in reverse index order,
    // so earlier tables' indices stay valid.
    // Tables whose row count changed but whose columns still line up. Adding
    // or removing a row is an ordinary edit and must not cost the table its
    // comments, so the rows are inserted or deleted in place and the text is
    // filled in afterwards.
    const tablesToResize: Array<{ apiTable: ApiTable; rowDelta: number; columnDelta: number }> = [];
    let anyCellChanged = false;

    for (let i = 0; i < tableCount; i++) {
      const apiTable = apiTables[i]!;
      const modelTable = modelTables[i]!;

      if (apiTable.cellTexts === modelTableCellTexts(modelTable)) continue;
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

      const rowDelta = modelRows.length - apiTable.rowCount;
      const columnDelta = modelColumns - apiTable.columnCount;
      if (rowDelta !== 0 || columnDelta !== 0) {
        tablesToResize.push({ apiTable, rowDelta, columnDelta });
      }
      // Same shape: nothing structural to do; the cell pass below handles it.
    }

    // Tables removed from markdown (more API tables than model tables)
    const tablesToDelete: ApiTable[] = [];
    for (let i = tableCount; i < apiTables.length; i++) {
      tablesToDelete.push(apiTables[i]!);
    }

    // Tables added in markdown (more model tables than API tables)
    // These need to be inserted at the correct position — we use the
    // end of the document as insertion point for new tables.
    const tablesToAdd: Array<{ el: DocsElement; position: number }> = [];
    for (let i = tableCount; i < modelTableEntries.length; i++) {
      tablesToAdd.push(modelTableEntries[i]!);
    }

    // Process table deletions and replacements in reverse document order
    const allTableOps = [
      ...tablesToReplace.map(t => ({ type: 'replace' as const, ...t })),
      ...tablesToDelete.map(t => ({ type: 'delete' as const, apiTable: t })),
    ].sort((a, b) => b.apiTable.endIndex - a.apiTable.endIndex);

    for (const op of allTableOps) {
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
      await this.insertNewTables(docId, tablesToAdd, newDocsDoc.elements);
    }

    // Resize in reverse document order so earlier tables keep their indices.
    for (const op of [...tablesToResize].sort((a, b) => b.apiTable.startIndex - a.apiTable.startIndex)) {
      await this.resizeTable(docId, op.apiTable, op.rowDelta, op.columnDelta);
    }

    // Finally, fill in the text. Re-read first: anything above did move
    // indices, and the cell diff addresses real positions.
    if (anyCellChanged) {
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

    const imageCount = Math.min(apiImages.length, modelImages.length);
    // Track images that need replacement (reverse order)
    const imagesToReplace: Array<{ apiImage: ApiImageBlock; modelImage: DocsElement }> = [];

    for (let i = 0; i < imageCount; i++) {
      const apiImage = apiImages[i]!;
      const modelImage = modelImages[i]!;

      // Compare mermaid.live URLs — if the diagram code changed, the URL changed
      if (apiImage.mermaidLiveUrl !== modelImage.mermaidLiveUrl) {
        imagesToReplace.push({ apiImage, modelImage });
      }
    }

    // Images removed from markdown
    const imagesToDelete: ApiImageBlock[] = [];
    for (let i = imageCount; i < apiImages.length; i++) {
      imagesToDelete.push(apiImages[i]!);
    }

    // Process image replacements and deletions in reverse document order
    const allImageOps = [
      ...imagesToReplace.map(t => ({ type: 'replace' as const, ...t })),
      ...imagesToDelete.map(t => ({ type: 'delete' as const, apiImage: t })),
    ].sort((a, b) => b.apiImage.endIndex - a.apiImage.endIndex);

    for (const op of allImageOps) {
      if (op.type === 'delete') {
        await this.docsService.batchUpdate(docId, [{
          deleteContentRange: { range: { startIndex: op.apiImage.startIndex, endIndex: op.apiImage.endIndex } },
        }]);
      } else {
        await this.replaceImage(docId, op.apiImage, op.modelImage);
      }
    }

    // New images go where the markdown puts them, not at the end.
    for (let i = imageCount; i < modelImageEntries.length; i++) {
      const { el: modelImage, position } = modelImageEntries[i]!;
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
    rowDelta: number,
    columnDelta: number,
  ): Promise<void> {
    const tableStartLocation = { index: apiTable.startIndex };
    const requests: DocsBatchUpdateRequest[] = [];

    for (let n = 0; n < rowDelta; n++) {
      requests.push({
        insertTableRow: {
          // Each insert goes below what is by then the last row.
          tableCellLocation: {
            tableStartLocation,
            rowIndex: apiTable.rowCount - 1 + n,
            columnIndex: 0,
          },
          insertBelow: true,
        },
      });
    }
    // Delete from the bottom up so the rows above keep their indices.
    for (let n = 0; n < -rowDelta; n++) {
      requests.push({
        deleteTableRow: {
          tableCellLocation: {
            tableStartLocation,
            rowIndex: apiTable.rowCount - 1 - n,
            columnIndex: 0,
          },
        },
      });
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
        '[SyncService] table resize: %d row / %d column op(s)',
        Math.abs(rowDelta), Math.abs(columnDelta),
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

    for (let i = 0; i < Math.min(apiTables.length, modelTables.length); i++) {
      const edits = tableCellDiffRequests(apiTables[i]!, modelTables[i]!);
      if (edits !== null) requests.push(...edits);
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

    if (table.suppressLeadingBlank && tableEl.startIndex !== undefined) {
      await this.removeLeadingBlankParagraph(docId, tableEl.startIndex);
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
