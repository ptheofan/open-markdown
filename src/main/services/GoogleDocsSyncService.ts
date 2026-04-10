/**
 * GoogleDocsSyncService — Orchestrates three-way diffing and surgical
 * document updates between local markdown files and Google Docs.
 *
 * Ties together the converter, builder, API wrapper, and link store to
 * detect external edits and apply minimal changes that preserve comments.
 */
import { diffChars } from 'diff';
import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';
import { buildInsertRequests, buildFormattingFromApiDoc } from '@main/services/DocsDocumentBuilder';
import type { GoogleDocsService } from '@main/services/GoogleDocsService';
import type { GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import type { DocsDocument, DocsElement, GoogleDocsSyncResult, MermaidDiagramData } from '@shared/types/google-docs';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Plain-text extraction from our DocsDocument structure ────────────

function extractPlainTextFromDocsDoc(doc: DocsDocument): string {
  let text = '';
  for (const element of doc.elements) {
    text += extractElementText(element);
  }
  return text;
}

function extractElementText(element: DocsElement): string {
  let text = '';
  switch (element.type) {
    case 'paragraph':
    case 'heading':
    case 'list_item':
      if (element.runs) {
        for (const run of element.runs) {
          text += run.text;
        }
      }
      text += '\n';
      break;
    case 'code_block':
      text += (element.code ?? '') + '\n';
      break;
    case 'horizontal_rule':
      // Builder inserts '\n' (empty paragraph with border) — API returns '\n'
      text += '\n';
      break;
    case 'table':
      // Match API format: each cell is a paragraph ending with '\n'
      if (element.rows) {
        for (const row of element.rows) {
          for (const cell of row) {
            for (const run of cell) {
              text += run.text;
            }
            text += '\n';
          }
        }
      }
      break;
    case 'blockquote':
      if (element.children) {
        text += extractPlainTextFromDocsDoc({ elements: element.children });
      }
      break;
    case 'image':
      // Match API format: inline image objects produce no text in extractPlainText.
      // Only the accompanying text runs (mermaid link) appear.
      if (element.imageLink) {
        if (element.mermaidLiveUrl) {
          text += '\nEdit in Mermaid Live\n';
        } else {
          text += '\n';
        }
      }
      // If no imageLink (upload failed), builder skips entirely — no text output
      break;
  }
  return text;
}

// ── Diff-based update generation ─────────────────────────────────────

function generateDiffOperations(currentText: string, newText: string, startIndex: number): any[] {
  const changes = diffChars(currentText, newText);
  const operations: any[] = [];
  let index = startIndex;

  // First pass: collect operations with their positions
  const ops: Array<{ type: 'delete' | 'insert'; index: number; endIndex?: number; text?: string }> = [];

  for (const change of changes) {
    if (change.removed) {
      ops.push({
        type: 'delete',
        index,
        endIndex: index + change.value.length,
      });
      index += change.value.length;
    } else if (change.added) {
      ops.push({
        type: 'insert',
        index,
        text: change.value,
      });
      // Don't advance index — inserted text goes at current position
    } else {
      // Unchanged — advance index
      index += change.value.length;
    }
  }

  // Reverse order so earlier indices aren't invalidated
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]!;
    if (op.type === 'delete') {
      operations.push({
        deleteContentRange: {
          range: {
            startIndex: op.index,
            endIndex: op.endIndex,
          },
        },
      });
    } else if (op.type === 'insert') {
      operations.push({
        insertText: {
          text: op.text,
          location: { index: op.index },
        },
      });
    }
  }

  return operations;
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
      console.log('[SyncService] Step 3: Extracting plain text...');
      const theirs = this.docsService.extractPlainText(currentDoc);
      console.log('[SyncService] Step 4: Converting markdown...');
      const docsDoc = convertMarkdownToDocs(markdown);
      console.log('[SyncService] Step 5: Processing mermaid diagrams...');
      await this.processMermaidDiagrams(docsDoc, mermaidDiagrams);
      console.log('[SyncService] Step 6: Extracting our plain text...');
      const ours = extractPlainTextFromDocsDoc(docsDoc);

      if (baseline === null) {
        console.log('[SyncService] First sync → fullPopulate');
        return await this.fullPopulate(docId, filePath, docsDoc);
      }

      if (baseline !== theirs) {
        console.log('[SyncService] External edits detected');
        return { success: false, externalEditsDetected: true };
      }

      console.log('[SyncService] Applying diff...');
      return await this.applyDiff(docId, filePath, theirs, docsDoc, ours);
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
   * Apply diff — computes minimal text changes between current and new
   * content, then reapplies all formatting (paragraph styles, text styles,
   * bullets) so that headings, bold, lists, etc. are correct after the diff.
   *
   * Text diff operations use deleteContentRange / insertText which
   * preserve Google Docs comment anchors on text that was not deleted.
   * Formatting operations (updateParagraphStyle, updateTextStyle) never
   * affect comment anchors.
   */
  private async applyDiff(
    docId: string,
    filePath: string,
    currentText: string,
    newDocsDoc: DocsDocument,
    newText: string,
  ): Promise<GoogleDocsSyncResult> {
    // If content is identical, no update needed
    if (currentText === newText) {
      // Even if text matches, styles might have changed (e.g. paragraph
      // was changed to a heading).  Re-read doc and apply formatting.
      const apiDoc = await this.docsService.getDocument(docId);
      const formattingOps = buildFormattingFromApiDoc(apiDoc, newDocsDoc);
      if (formattingOps.length > 0) {
        console.log(`[SyncService] applyDiff: text identical, reapplying ${formattingOps.length} formatting requests`);
        await this.docsService.batchUpdate(docId, formattingOps);
      }
      const baselineText = this.docsService.extractPlainText(apiDoc);
      await this.linkStore.saveBaseline(docId, baselineText);
      await this.linkStore.updateLastSynced(filePath, new Date().toISOString());
      return { success: true };
    }

    // Step 1: Apply text diff (minimal deletions preserve comment anchors)
    const operations = generateDiffOperations(currentText, newText, 1);
    if (operations.length > 0) {
      console.log(`[SyncService] applyDiff: ${operations.length} text diff operations`);
      await this.docsService.batchUpdate(docId, operations);
    }

    // Step 2: Read doc back to get actual paragraph indices after text changes
    const updatedDoc = await this.docsService.getDocument(docId);

    // Step 3: Apply formatting using actual API indices
    const formattingOps = buildFormattingFromApiDoc(updatedDoc, newDocsDoc);
    if (formattingOps.length > 0) {
      console.log(`[SyncService] applyDiff: ${formattingOps.length} formatting requests`);
      await this.docsService.batchUpdate(docId, formattingOps);
    }

    // Step 4: Save baseline from API text (consistent with future reads)
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
export { extractPlainTextFromDocsDoc, generateDiffOperations };
