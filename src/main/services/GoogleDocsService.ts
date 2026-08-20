/**
 * GoogleDocsService — thin wrapper around Google Docs API and Drive API.
 *
 * Handles all HTTP communication with Google's APIs using native `fetch`.
 * No Electron dependency — this is pure HTTP.
 */
import type { GDocsApiDocument } from '@shared/types/google-docs';

type TokenProvider = () => Promise<string>;

const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

/** An error from a Google API call, carrying the HTTP status. */
export interface GoogleApiError extends Error {
  status: number;
}

function apiError(message: string, status: number): GoogleApiError {
  return Object.assign(new Error(message), { status });
}
const DRIVE_UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

// ── Google API response types ────────────────────────────────

/** Google API error response shape */
interface GoogleApiErrorResponse {
  error?: {
    message?: string;
  };
}

/** Google Drive file upload response */
interface DriveFileResponse {
  id: string;
}

/** Range within a Google Docs document */
export interface DocsRange {
  startIndex: number;
  endIndex: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** A single batch update request (various Google Docs API request types) */
/** Where a table operation applies, per the Docs API TableCellLocation. */
export interface DocsTableCellLocation {
  tableStartLocation: { index: number };
  rowIndex: number;
  columnIndex: number;
}

export type DocsBatchUpdateRequest =
  | { insertText: { text: string; location: { index: number } } }
  | { updateTextStyle: { range: DocsRange; textStyle: Record<string, any>; fields: string } }
  | { updateParagraphStyle: { range: DocsRange; paragraphStyle: Record<string, any>; fields: string } }
  | { createParagraphBullets: { range: DocsRange; bulletPreset: string } }
  | { insertInlineImage: { uri: string; location: { index: number }; objectSize: Record<string, any> } }
  | { deleteContentRange: { range: DocsRange } }
  | { insertTable: { rows: number; columns: number; location: { index: number } } }
  | { insertTableRow: { tableCellLocation: DocsTableCellLocation; insertBelow: boolean } }
  | { deleteTableRow: { tableCellLocation: DocsTableCellLocation } }
  | { insertTableColumn: { tableCellLocation: DocsTableCellLocation; insertRight: boolean } }
  | { deleteTableColumn: { tableCellLocation: DocsTableCellLocation } }
  | {
      updateTableColumnProperties: {
        tableStartLocation: { index: number };
        columnIndices: number[];
        tableColumnProperties: {
          widthType: 'FIXED_WIDTH' | 'EVENLY_DISTRIBUTED';
          width?: { magnitude: number; unit: string };
        };
        fields: string;
      };
    };
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Response from batchUpdate */
interface DocsBatchUpdateResponse {
  documentId?: string;
  replies?: Record<string, unknown>[];
}

export class GoogleDocsService {
  private tokenProvider: TokenProvider;

  constructor(tokenProvider: TokenProvider) {
    this.tokenProvider = tokenProvider;
  }

  /**
   * Read the full document structure from the Google Docs API.
   */
  async getDocument(docId: string): Promise<GDocsApiDocument> {
    const token = await this.tokenProvider();
    const response = await fetch(`${DOCS_API_BASE}/${docId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const error = (await response.json()) as GoogleApiErrorResponse;
      throw apiError(
        error.error?.message ?? `API error: ${response.status} ${response.statusText}`,
        response.status,
      );
    }
    return (await response.json()) as GDocsApiDocument;
  }

  /**
   * Apply batch updates to a document.
   */
  async batchUpdate(docId: string, requests: DocsBatchUpdateRequest[]): Promise<DocsBatchUpdateResponse> {
    const token = await this.tokenProvider();
    console.warn(`[DocsAPI] batchUpdate: ${requests.length} requests for doc ${docId}`);
    console.warn('[DocsAPI] First 3 requests:', JSON.stringify(requests.slice(0, 3), null, 2));
    const response = await fetch(`${DOCS_API_BASE}/${docId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DocsAPI] batchUpdate failed (${response.status}):`, errorText);
      throw apiError(
        `Google Docs API error (${response.status}): ${errorText}`,
        response.status,
      );
    }
    return (await response.json()) as DocsBatchUpdateResponse;
  }

  /**
   * Upload an image to Google Drive via multipart upload.
   * Returns the Drive file ID for use in InsertInlineImage requests.
   */
  async uploadImage(imageData: Buffer, filename: string): Promise<string> {
    const token = await this.tokenProvider();
    const boundary = 'boundary_' + Date.now();
    const metadata = JSON.stringify({ name: filename, mimeType: 'image/png' });

    const body = [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      metadata + '\r\n',
      `--${boundary}\r\n`,
      'Content-Type: image/png\r\n\r\n',
    ].join('');

    const bodyBuffer = Buffer.concat([
      Buffer.from(body),
      imageData,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const response = await fetch(DRIVE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyBuffer,
    });
    if (!response.ok) {
      const error = (await response.json()) as GoogleApiErrorResponse;
      throw apiError(error.error?.message ?? `Upload failed: ${response.status}`, response.status);
    }
    const result = (await response.json()) as DriveFileResponse;
    const fileId = result.id;

    // Make the image publicly accessible so insertInlineImage can use it
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    return fileId;
  }

  /**
   * Extract plain text content from a Google Docs API document response.
   * Walks the body.content array and concatenates textRun.content values.
   */
  extractPlainText(document: GDocsApiDocument): string {
    let text = '';
    const content = document?.body?.content;
    if (!Array.isArray(content)) return text;

    for (const element of content) {
      if (element.paragraph) {
        for (const el of element.paragraph.elements ?? []) {
          if (el.textRun?.content) {
            text += el.textRun.content;
          }
        }
      }
      // Tables are more complex but we extract what we can
      if (element.table) {
        for (const row of element.table.tableRows ?? []) {
          for (const cell of row.tableCells ?? []) {
            for (const cellContent of cell.content ?? []) {
              if (cellContent.paragraph) {
                for (const el of cellContent.paragraph.elements ?? []) {
                  if (el.textRun?.content) {
                    text += el.textRun.content;
                  }
                }
              }
            }
          }
        }
      }
    }
    return text;
  }
}

// ── Factory + singleton ───────────────────────────────────────

let instance: GoogleDocsService | null = null;

export function getGoogleDocsService(tokenProvider: TokenProvider): GoogleDocsService {
  if (!instance) {
    instance = new GoogleDocsService(tokenProvider);
  }
  return instance;
}

export function createGoogleDocsService(tokenProvider: TokenProvider): GoogleDocsService {
  return new GoogleDocsService(tokenProvider);
}

export function resetGoogleDocsService(): void {
  instance = null;
}
