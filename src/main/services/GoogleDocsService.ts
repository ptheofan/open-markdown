/**
 * GoogleDocsService — thin wrapper around Google Docs API and Drive API.
 *
 * Handles all HTTP communication with Google's APIs using native `fetch`.
 * No Electron dependency — this is pure HTTP.
 */

type TokenProvider = () => Promise<string>;

const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';
const DRIVE_UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

export class GoogleDocsService {
  private tokenProvider: TokenProvider;

  constructor(tokenProvider: TokenProvider) {
    this.tokenProvider = tokenProvider;
  }

  /**
   * Read the full document structure from the Google Docs API.
   */
  async getDocument(docId: string): Promise<any> {
    const token = await this.tokenProvider();
    const response = await fetch(`${DOCS_API_BASE}/${docId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error?.message ?? `API error: ${response.status} ${response.statusText}`,
      );
    }
    return response.json();
  }

  /**
   * Apply batch updates to a document.
   */
  async batchUpdate(docId: string, requests: any[]): Promise<any> {
    const token = await this.tokenProvider();
    console.log(`[DocsAPI] batchUpdate: ${requests.length} requests for doc ${docId}`);
    console.log('[DocsAPI] First 3 requests:', JSON.stringify(requests.slice(0, 3), null, 2));
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
      throw new Error(
        `Google Docs API error (${response.status}): ${errorText}`,
      );
    }
    return response.json();
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
      const error = await response.json();
      throw new Error(error.error?.message ?? `Upload failed: ${response.status}`);
    }
    const result = await response.json();
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
  extractPlainText(document: any): string {
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
