/**
 * GoogleDocsSyncService — Orchestrates three-way diffing and surgical
 * document updates between local markdown files and Google Docs.
 *
 * Ties together the converter, builder, API wrapper, and link store to
 * detect external edits and apply minimal changes that preserve comments.
 */
import { diffChars } from 'diff';
import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';
import { buildInsertRequests } from '@main/services/DocsDocumentBuilder';
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
      text += '───\n';
      break;
    case 'table':
      if (element.rows) {
        for (const row of element.rows) {
          for (const cell of row) {
            for (const run of cell) {
              text += run.text;
            }
            text += '\t';
          }
          text += '\n';
        }
      }
      break;
    case 'blockquote':
      if (element.children) {
        text += extractPlainTextFromDocsDoc({ elements: element.children });
      }
      break;
    case 'image':
      text += '[image]\n';
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
        return await this.fullPopulate(docId, filePath, docsDoc, ours);
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
      const ours = extractPlainTextFromDocsDoc(docsDoc);

      // Full clear + repopulate (same as first sync)
      return await this.fullPopulate(docId, filePath, docsDoc, ours);
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
    plainText: string,
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

    // Now insert our content into the clean doc
    const requests = buildInsertRequests(docsDoc, 1);
    console.log(`[SyncService] fullPopulate: ${requests.length} total requests`);
    if (requests.length > 0) {
      await this.docsService.batchUpdate(docId, requests);
    }
    await this.linkStore.saveBaseline(docId, plainText);
    await this.linkStore.updateLastSynced(filePath, new Date().toISOString());
    return { success: true };
  }

  /**
   * Apply diff — computes minimal changes between current and new text,
   * then applies them in reverse document order to preserve indices.
   */
  private async applyDiff(
    docId: string,
    filePath: string,
    currentText: string,
    _newDocsDoc: DocsDocument,
    newText: string,
  ): Promise<GoogleDocsSyncResult> {
    // If content is identical, no update needed
    if (currentText === newText) {
      await this.linkStore.saveBaseline(docId, newText);
      await this.linkStore.updateLastSynced(filePath, new Date().toISOString());
      return { success: true };
    }

    // Google Docs body content starts at index 1
    const operations = generateDiffOperations(currentText, newText, 1);

    if (operations.length > 0) {
      await this.docsService.batchUpdate(docId, operations);
    }

    await this.linkStore.saveBaseline(docId, newText);
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
