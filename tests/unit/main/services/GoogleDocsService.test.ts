import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GoogleDocsService,
  createGoogleDocsService,
  getGoogleDocsService,
  resetGoogleDocsService,
} from '@main/services/GoogleDocsService';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GoogleDocsService', () => {
  const tokenProvider = (): Promise<string> => Promise.resolve('fake-token');
  let service: GoogleDocsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetGoogleDocsService();
    service = createGoogleDocsService(tokenProvider);
  });

  describe('getDocument', () => {
    it('should call correct URL with auth header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ body: { content: [] } }),
      });

      await service.getDocument('doc-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://docs.googleapis.com/v1/documents/doc-123',
        expect.objectContaining({
          headers: { Authorization: 'Bearer fake-token' },
        }),
      );
    });

    it('should return the parsed JSON response', async () => {
      const docResponse = { body: { content: [{ paragraph: {} }] } };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(docResponse),
      });

      const result = await service.getDocument('doc-123');
      expect(result).toEqual(docResponse);
    });

    it('should throw on API error with message from response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: { message: 'No access' } }),
      });

      await expect(service.getDocument('doc-123')).rejects.toThrow('No access');
    });

    it('should throw with status text when no error message in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });

      await expect(service.getDocument('doc-123')).rejects.toThrow(
        'API error: 500 Internal Server Error',
      );
    });
  });

  describe('batchUpdate', () => {
    it('should POST with correct URL and body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ replies: [] }),
      });

      const requests = [{ insertText: { text: 'Hello', location: { index: 1 } } }];
      await service.batchUpdate('doc-123', requests);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://docs.googleapis.com/v1/documents/doc-123:batchUpdate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ requests }),
        }),
      );
    });

    it('should include correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ replies: [] }),
      });

      await service.batchUpdate('doc-456', []);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer fake-token',
            'Content-Type': 'application/json',
          },
        }),
      );
    });

    it('should return the parsed JSON response', async () => {
      const batchResponse = { replies: [{ insertText: {} }] };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(batchResponse),
      });

      const result = await service.batchUpdate('doc-123', []);
      expect(result).toEqual(batchResponse);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('{"error":{"message":"Invalid request"}}'),
      });

      await expect(service.batchUpdate('doc-123', [])).rejects.toThrow(
        'Google Docs API error (400): {"error":{"message":"Invalid request"}}',
      );
    });
  });

  describe('uploadImage', () => {
    it('should upload with multipart body and return file ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'file-123' }),
      });

      const imageId = await service.uploadImage(Buffer.from('png-data'), 'diagram.png');
      expect(imageId).toBe('file-123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('googleapis.com/upload/drive'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should use multipart/related content type with boundary', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'file-456' }),
      });

      await service.uploadImage(Buffer.from('png-data'), 'test.png');

      const call = mockFetch.mock.calls[0]!;
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['Content-Type']).toMatch(/^multipart\/related; boundary=boundary_\d+$/);
      expect(headers['Authorization']).toBe('Bearer fake-token');
    });

    it('should include image metadata in the multipart body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'file-789' }),
      });

      await service.uploadImage(Buffer.from('png-data'), 'screenshot.png');

      const call = mockFetch.mock.calls[0]!;
      const body = call[1]?.body as Buffer;
      const bodyStr = body.toString();
      expect(bodyStr).toContain('"name":"screenshot.png"');
      expect(bodyStr).toContain('"mimeType":"image/png"');
      expect(bodyStr).toContain('png-data');
    });

    it('should throw on upload failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: { message: 'Quota exceeded' } }),
      });

      await expect(
        service.uploadImage(Buffer.from('data'), 'img.png'),
      ).rejects.toThrow('Quota exceeded');
    });

    it('should throw with status code when no error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: () => Promise.resolve({}),
      });

      await expect(
        service.uploadImage(Buffer.from('data'), 'img.png'),
      ).rejects.toThrow('Upload failed: 500');
    });
  });

  describe('extractPlainText', () => {
    it('should extract text from paragraph elements', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'Hello ' } },
                  { textRun: { content: 'world\n' } },
                ],
              },
            },
          ],
        },
      };
      expect(service.extractPlainText(doc)).toBe('Hello world\n');
    });

    it('should extract text from multiple paragraphs', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'First\n' } }],
              },
            },
            {
              paragraph: {
                elements: [{ textRun: { content: 'Second\n' } }],
              },
            },
          ],
        },
      };
      expect(service.extractPlainText(doc)).toBe('First\nSecond\n');
    });

    it('should extract text from table cells', () => {
      const doc = {
        body: {
          content: [
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Cell 1\n' } }] } },
                        ],
                      },
                      {
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Cell 2\n' } }] } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      };
      expect(service.extractPlainText(doc)).toBe('Cell 1\nCell 2\n');
    });

    it('should return empty string for empty document', () => {
      expect(service.extractPlainText({ body: { content: [] } })).toBe('');
    });

    it('should return empty string for missing body', () => {
      expect(service.extractPlainText({})).toBe('');
    });

    it('should return empty string for null/undefined', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      expect(service.extractPlainText(null as any)).toBe('');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      expect(service.extractPlainText(undefined as any)).toBe('');
    });

    it('should skip elements without textRun', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { inlineObjectElement: { inlineObjectId: 'obj-1' } },
                  { textRun: { content: 'After image\n' } },
                ],
              },
            },
          ],
        },
      };
      expect(service.extractPlainText(doc)).toBe('After image\n');
    });
  });

  describe('token provider', () => {
    it('should call token provider for each request', async () => {
      const tp = vi.fn().mockResolvedValue('token-1');
      const svc = createGoogleDocsService(tp);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ body: { content: [] } }),
      });

      await svc.getDocument('doc-1');
      await svc.getDocument('doc-2');

      expect(tp).toHaveBeenCalledTimes(2);
    });
  });

  describe('singleton', () => {
    it('should return the same instance from getGoogleDocsService', () => {
      const a = getGoogleDocsService(tokenProvider);
      const b = getGoogleDocsService(tokenProvider);
      expect(a).toBe(b);
    });

    it('should reset singleton on resetGoogleDocsService', () => {
      const a = getGoogleDocsService(tokenProvider);
      resetGoogleDocsService();
      const b = getGoogleDocsService(tokenProvider);
      expect(a).not.toBe(b);
    });

    it('should create independent instances with createGoogleDocsService', () => {
      const a = createGoogleDocsService(tokenProvider);
      const b = createGoogleDocsService(tokenProvider);
      expect(a).not.toBe(b);
    });
  });
});
