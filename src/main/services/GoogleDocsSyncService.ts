/**
 * GoogleDocsSyncService — Orchestrates three-way diffing and surgical
 * document updates between local markdown files and Google Docs.
 *
 * Ties together the converter, builder, API wrapper, and link store to
 * detect external edits and apply minimal changes that preserve comments.
 */
import { diffChars, diffArrays } from 'diff';
import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';
import {
  buildInsertRequests,
  buildFormattingFromApiDoc,
  extractApiParagraphs,
  flattenElements,
  getLeafText,
} from '@main/services/DocsDocumentBuilder';
import type { ApiParagraph, PendingTable } from '@main/services/DocsDocumentBuilder';
import type { GoogleDocsService } from '@main/services/GoogleDocsService';
import type { GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import type {
  DocsDocument,
  DocsElement,
  DocsTextRun,
  GDocsApiDocument,
  GDocsStructuralElement,
  GoogleDocsSyncResult,
  MermaidDiagramData,
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
      ops.push({ type: 'delete', index, endIndex: index + change.value.length });
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

  const requests: DocsBatchUpdateRequest[] = [];
  for (let i = allOps.length - 1; i >= 0; i--) {
    const op = allOps[i]!;
    if (op.type === 'delete') {
      let endIdx = op.endIndex ?? op.index;
      // Exclude trailing newline from each paragraph delete
      endIdx = endIdx - 1;
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
      for (const row of el.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          for (const cellContent of cell.content ?? []) {
            if (cellContent.paragraph) {
              for (const pe of cellContent.paragraph.elements ?? []) {
                if (pe.textRun?.content) {
                  cellTexts += pe.textRun.content;
                }
              }
            }
          }
        }
      }
      result.push({
        startIndex: el.startIndex ?? 0,
        endIndex: el.endIndex ?? 0,
        cellTexts,
      });
    }
  }
  return result;
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
 */
function buildCellRequests(
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

      // Bold header row
      if (r === 0) {
        cellRequests.push({
          updateTextStyle: {
            range: { startIndex: cellIndex, endIndex: cellIndex + text.length },
            textStyle: { bold: true },
            fields: 'bold',
          },
        });
      }
    }
  }

  return cellRequests;
}

// ── Sync service class ─────────────────────────────���─────────────────

export class GoogleDocsSyncService {
  private docsService: GoogleDocsService;
  private linkStore: GoogleDocsLinkStore;

  constructor(docsService: GoogleDocsService, linkStore: GoogleDocsLinkStore) {
    this.docsService = docsService;
    this.linkStore = linkStore;
  }

  /**
   * Main sync method — performs three-way diffing to detect external edits
   * and apply minimal changes.
   */
  async sync(filePath: string, docId: string, markdown: string, mermaidDiagrams?: MermaidDiagramData[]): Promise<GoogleDocsSyncResult> {
    try {
      console.warn('[SyncService] Step 1: Loading baseline...');
      const baseline = await this.linkStore.loadBaseline(docId);
      console.warn('[SyncService] Step 2: Reading current doc from API...');
      const currentDoc = await this.docsService.getDocument(docId);
      console.warn('[SyncService] Step 3: Extracting plain text for external-edit check...');
      const theirs = this.docsService.extractPlainText(currentDoc);
      console.warn('[SyncService] Step 4: Converting markdown...');
      const docsDoc = convertMarkdownToDocs(markdown);
      console.warn('[SyncService] Step 5: Processing mermaid diagrams...');
      await this.processMermaidDiagrams(docsDoc, mermaidDiagrams);

      if (baseline === null) {
        console.warn('[SyncService] First sync -> fullPopulate');
        return await this.fullPopulate(docId, filePath, docsDoc);
      }

      if (baseline !== theirs) {
        console.warn('[SyncService] External edits detected');
        return { success: false, externalEditsDetected: true };
      }

      console.warn('[SyncService] Applying paragraph-level diff...');
      return await this.applyDiff(docId, filePath, currentDoc, docsDoc);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : '';
      console.error('[SyncService] ERROR:', message, '\n', stack);
      return { success: false, error: message };
    }
  }

  /**
   * Force overwrite — same as sync but skips external edit detection.
   */
  async syncForceOverwrite(
    filePath: string,
    docId: string,
    markdown: string,
    mermaidDiagrams?: MermaidDiagramData[],
  ): Promise<GoogleDocsSyncResult> {
    try {
      console.warn('[SyncService] Force overwrite -- clearing doc and repopulating');
      const docsDoc = convertMarkdownToDocs(markdown);
      await this.processMermaidDiagrams(docsDoc, mermaidDiagrams);

      // Full clear + repopulate (same as first sync)
      return await this.fullPopulate(docId, filePath, docsDoc);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Process mermaid diagrams — match DocsElements with renderer-provided
   * diagram data, upload PNGs to Google Drive, and set imageLink on the
   * element so the builder can insert them as inline images.
   */
  private async processMermaidDiagrams(
    docsDoc: DocsDocument,
    mermaidDiagrams?: MermaidDiagramData[],
  ): Promise<void> {
    if (!mermaidDiagrams || mermaidDiagrams.length === 0) return;

    for (const element of docsDoc.elements) {
      if (element.type === 'image' && element.code) {
        const diagram = mermaidDiagrams.find(d => d.code === element.code);
        if (!diagram) continue;

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
        } catch (error) {
          console.warn('Failed to upload mermaid diagram to Drive:', error);
          // Continue without the image — it will be skipped by the builder
        }
      }
    }
  }

  /**
   * Full populate — used on first sync when no baseline exists.
   */
  private async fullPopulate(
    docId: string,
    filePath: string,
    docsDoc: DocsDocument,
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
    await this.linkStore.updateLastSynced(filePath, new Date().toISOString());
    return { success: true };
  }

  /**
   * Phase 2: Find table placeholders in the doc, replace each with a real table,
   * then populate cells.
   */
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

      if (cellRequests.length > 0) {
        await this.docsService.batchUpdate(docId, cellRequests);
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
    const modelTables = newDocsDoc.elements.filter(e => e.type === 'table');

    // Match by position (1st model table <-> 1st API table, etc.)
    const tableCount = Math.min(apiTables.length, modelTables.length);
    // Track tables that need replacement (process in reverse for index stability)
    const tablesToReplace: Array<{ apiTable: ApiTable; modelTable: DocsElement }> = [];

    for (let i = 0; i < tableCount; i++) {
      const apiTable = apiTables[i]!;
      const modelTable = modelTables[i]!;
      const modelCellTexts = modelTableCellTexts(modelTable);

      if (apiTable.cellTexts !== modelCellTexts) {
        tablesToReplace.push({ apiTable, modelTable });
      }
    }

    // Tables removed from markdown (more API tables than model tables)
    const tablesToDelete: ApiTable[] = [];
    for (let i = tableCount; i < apiTables.length; i++) {
      tablesToDelete.push(apiTables[i]!);
    }

    // Tables added in markdown (more model tables than API tables)
    // These need to be inserted at the correct position — we use the
    // end of the document as insertion point for new tables.
    const tablesToAdd: DocsElement[] = [];
    for (let i = tableCount; i < modelTables.length; i++) {
      tablesToAdd.push(modelTables[i]!);
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
      await this.insertNewTables(docId, tablesToAdd);
    }

    // ── Images (mermaid diagrams) ────────────���──────────────────
    const modelImages = newDocsDoc.elements.filter(
      e => e.type === 'image' && e.imageLink
    );
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

    // New images added in markdown — these are inserted at doc end for now
    for (let i = imageCount; i < modelImages.length; i++) {
      const modelImage = modelImages[i]!;
      const currentDoc = await this.docsService.getDocument(docId);
      const endIdx = currentDoc?.body?.content?.at(-1)?.endIndex ?? 2;
      await this.insertImageAtIndex(docId, endIdx - 1, modelImage);
    }
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

    if (cellRequests.length > 0) {
      await this.docsService.batchUpdate(docId, cellRequests);
    }
  }

  /**
   * Insert new tables that were added in the markdown.
   * Uses the two-phase placeholder approach from fullPopulate.
   */
  private async insertNewTables(
    docId: string,
    modelTables: DocsElement[],
  ): Promise<void> {
    for (const modelTable of modelTables) {
      const rows = modelTable.rows ?? [];
      if (rows.length === 0) continue;

      // Insert at end of document
      const currentDoc = await this.docsService.getDocument(docId);
      const endIdx = currentDoc?.body?.content?.at(-1)?.endIndex ?? 2;
      const insertAt = endIdx - 1;

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
            fontSize: { magnitude: 9, unit: 'PT' },
          },
          fields: 'link,fontSize',
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
