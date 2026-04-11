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
import type { ApiParagraph } from '@main/services/DocsDocumentBuilder';
import type { GoogleDocsService } from '@main/services/GoogleDocsService';
import type { GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import type { DocsDocument, DocsElement, GoogleDocsSyncResult, MermaidDiagramData } from '@shared/types/google-docs';

/* eslint-disable @typescript-eslint/no-explicit-any */

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
): any[] {
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

  // Build API requests in reverse order for index stability
  const requests: any[] = [];
  for (let i = allOps.length - 1; i >= 0; i--) {
    const op = allOps[i]!;
    if (op.type === 'delete') {
      requests.push({
        deleteContentRange: { range: { startIndex: op.index, endIndex: op.endIndex } },
      });
    } else {
      requests.push({
        insertText: { text: op.text, location: { index: op.index } },
      });
    }
  }
  return requests;
}

// ── Sync service class ───────────────────────────────────────────────

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
      console.log('[SyncService] Step 1: Loading baseline...');
      const baseline = await this.linkStore.loadBaseline(docId);
      console.log('[SyncService] Step 2: Reading current doc from API...');
      const currentDoc = await this.docsService.getDocument(docId);
      console.log('[SyncService] Step 3: Extracting plain text for external-edit check...');
      const theirs = this.docsService.extractPlainText(currentDoc);
      console.log('[SyncService] Step 4: Converting markdown...');
      const docsDoc = convertMarkdownToDocs(markdown);
      console.log('[SyncService] Step 5: Processing mermaid diagrams...');
      await this.processMermaidDiagrams(docsDoc, mermaidDiagrams);

      if (baseline === null) {
        console.log('[SyncService] First sync → fullPopulate');
        return await this.fullPopulate(docId, filePath, docsDoc);
      }

      if (baseline !== theirs) {
        console.log('[SyncService] External edits detected');
        return { success: false, externalEditsDetected: true };
      }

      console.log('[SyncService] Applying paragraph-level diff...');
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
      console.log('[SyncService] Force overwrite — clearing doc and repopulating');
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
      console.log(`[SyncService] Clearing existing doc content (endIndex: ${endIndex})`);
      await this.docsService.batchUpdate(docId, [{
        deleteContentRange: {
          range: { startIndex: 1, endIndex: endIndex - 1 },
        },
      }]);
    }

    // Phase 1: Insert all text content (tables as placeholders)
    const { requests, pendingTables } = buildInsertRequests(docsDoc, 1);
    console.log(`[SyncService] fullPopulate: ${requests.length} requests, ${pendingTables.length} pending tables`);
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
    pendingTables: import('./DocsDocumentBuilder').PendingTable[],
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
              placeholderIndex = el.startIndex;
              placeholderEndIndex = el.endIndex;
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
      const tableEl = (docAfterTable?.body?.content ?? []).find(
        (el: any) => el.table && el.startIndex >= placeholderIndex
      );

      if (!tableEl?.table) {
        console.warn('[SyncService] Inserted table not found at index', placeholderIndex);
        continue;
      }

      // Populate cells — insert text into each cell's paragraph
      // Process in reverse order to preserve indices
      const cellRequests: any[] = [];
      const tableRows = tableEl.table.tableRows ?? [];

      for (let r = tableRows.length - 1; r >= 0; r--) {
        const cells = tableRows[r].tableCells ?? [];
        for (let c = cells.length - 1; c >= 0; c--) {
          const cell = cells[c];
          const cellContent = cell.content?.[0];
          if (!cellContent?.paragraph) continue;

          const cellIndex = cellContent.paragraph.elements?.[0]?.startIndex;
          if (cellIndex === undefined) continue;

          const dataRow = table.rows[r];
          const dataCell = dataRow?.[c];
          if (!dataCell || dataCell.length === 0) continue;

          const text = dataCell.map((run: any) => run.text).join('');
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

      if (cellRequests.length > 0) {
        await this.docsService.batchUpdate(docId, cellRequests);
      }
    }
  }

  /**
   * Apply diff — uses paragraph-level diffing with actual API indices to
   * compute minimal changes, then reapplies formatting.
   *
   * Comment preservation:
   * - Unchanged paragraphs are skipped entirely → all comments preserved
   * - 1:1 modified paragraphs use character-level diff → comments on
   *   unchanged words within the paragraph are preserved
   * - Deleted paragraphs lose their comments (unavoidable)
   * - Formatting operations never affect comment anchors
   */
  private async applyDiff(
    docId: string,
    filePath: string,
    currentApiDoc: any,
    newDocsDoc: DocsDocument,
  ): Promise<GoogleDocsSyncResult> {
    // Step 1: Extract paragraphs from API doc (with actual indices)
    const apiParas = extractApiParagraphs(currentApiDoc);
    const modelElements = flattenElements(newDocsDoc.elements);

    // Step 2: Compute paragraph-level diff operations
    const operations = generateParagraphDiffOperations(apiParas, modelElements);

    if (operations.length > 0) {
      console.log(`[SyncService] applyDiff: ${operations.length} paragraph-diff operations`);
      await this.docsService.batchUpdate(docId, operations);
    }

    // Step 3: Read doc back to get actual paragraph indices after changes
    const updatedDoc = await this.docsService.getDocument(docId);

    // Step 4: Apply formatting using actual API indices
    const formattingOps = buildFormattingFromApiDoc(updatedDoc, newDocsDoc);
    if (formattingOps.length > 0) {
      console.log(`[SyncService] applyDiff: ${formattingOps.length} formatting requests`);
      await this.docsService.batchUpdate(docId, formattingOps);
    }

    // Step 5: Save baseline from API text (consistent with future reads)
    const baselineText = this.docsService.extractPlainText(updatedDoc);
    await this.linkStore.saveBaseline(docId, baselineText);
    await this.linkStore.updateLastSynced(filePath, new Date().toISOString());
    return { success: true };
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createGoogleDocsSyncService(
  docsService: GoogleDocsService,
  linkStore: GoogleDocsLinkStore,
): GoogleDocsSyncService {
  return new GoogleDocsSyncService(docsService, linkStore);
}

// Exported for testing
export { generateParagraphDiffOperations };
