import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';

// Mock the converter module
vi.mock('@main/services/MarkdownToDocsConverter', () => ({
  convertMarkdownToDocs: vi.fn(),
}));

import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

describe('GoogleDocsSyncService', () => {
  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
    extractPlainText: vi.fn(),
  };

  const mockLinkStore = {
    loadBaseline: vi.fn(),
    saveBaseline: vi.fn(),
    updateLastSynced: vi.fn(),
    getLink: vi.fn(),
    setLink: vi.fn(),
    removeLink: vi.fn(),
    initialize: vi.fn(),
    deleteBaseline: vi.fn(),
  };

  let syncService: ReturnType<typeof createGoogleDocsSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = createGoogleDocsSyncService(
      mockDocsService as any,
      mockLinkStore as any,
    );
  });

  describe('first sync (no baseline)', () => {
    it('should do full populate when no baseline exists', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue(null);
      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ endIndex: 1 }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('');
      mockDocsService.batchUpdate.mockResolvedValue({});

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello' }] }],
      });

      const result = await syncService.sync('/file.md', 'doc-123', '# Hello');
      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();
      expect(mockLinkStore.saveBaseline).toHaveBeenCalled();
      expect(mockLinkStore.updateLastSynced).toHaveBeenCalled();
    });
  });

  describe('external edit detection', () => {
    it('should detect external edits when baseline differs from current doc', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue('original text\n');
      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ paragraph: { elements: [{ textRun: { content: 'edited text\n' } }] } }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('edited text\n');

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'new content' }] }],
      });

      const result = await syncService.sync('/file.md', 'doc-123', 'new content');
      expect(result.success).toBe(false);
      expect(result.externalEditsDetected).toBe(true);
      expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('force overwrite', () => {
    it('should overwrite even when external edits detected', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue('original text\n');
      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ paragraph: { elements: [{ textRun: { content: 'edited text\n' } }] } }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('edited text\n');
      mockDocsService.batchUpdate.mockResolvedValue({});

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'new content' }] }],
      });

      const result = await syncService.syncForceOverwrite('/file.md', 'doc-123', 'new content');
      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();
    });
  });

  describe('diff-based update', () => {
    it('should apply minimal diff when no external edits', async () => {
      const baselineText = 'Hello world\n';
      mockLinkStore.loadBaseline.mockResolvedValue(baselineText);
      mockDocsService.getDocument.mockResolvedValue({
        body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Hello world\n' } }] } }] },
      });
      mockDocsService.extractPlainText.mockReturnValue('Hello world\n');
      mockDocsService.batchUpdate.mockResolvedValue({});

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello universe' }] }],
      });

      const result = await syncService.sync('/file.md', 'doc-123', 'Hello universe');
      expect(result.success).toBe(true);
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();

      // Should have generated diff operations, not full populate
      const batchArgs = mockDocsService.batchUpdate.mock.calls[0];
      expect(batchArgs).toBeDefined();
      const requests = batchArgs![1] as any[];
      // Should contain delete and/or insert operations (not a full document build)
      const hasDeleteOrInsert = requests.some((r: any) => r.deleteContentRange || r.insertText);
      expect(hasDeleteOrInsert).toBe(true);
    });

    it('should still apply formatting when text is unchanged', async () => {
      const text = 'Hello world\n';
      mockLinkStore.loadBaseline.mockResolvedValue(text);
      mockDocsService.getDocument.mockResolvedValue({
        body: {
          content: [{
            paragraph: { elements: [{ textRun: { content: text } }] },
            startIndex: 1,
            endIndex: 13,
          }],
        },
      });
      mockDocsService.extractPlainText.mockReturnValue(text);
      mockDocsService.batchUpdate.mockResolvedValue({});

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello world' }] }],
      });

      const result = await syncService.sync('/file.md', 'doc-123', 'Hello world');
      expect(result.success).toBe(true);
      // Even when text is identical, formatting is reapplied to ensure
      // paragraph styles are correct (e.g. if a paragraph was changed to a heading)
      expect(mockDocsService.batchUpdate).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return error result on API failure', async () => {
      mockLinkStore.loadBaseline.mockResolvedValue(null);
      mockDocsService.getDocument.mockRejectedValue(new Error('API error'));

      vi.mocked(convertMarkdownToDocs).mockReturnValue({
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello' }] }],
      });

      const result = await syncService.sync('/file.md', 'doc-123', 'Hello');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
