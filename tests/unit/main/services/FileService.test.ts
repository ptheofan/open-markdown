import { dialog } from 'electron';
import * as fs from 'node:fs/promises';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FileService } from '../../../../src/main/services/FileService';
import { MAX_FILE_SIZE_BYTES } from '../../../../src/shared/constants';

// Mock Electron dialog
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

describe('FileService', () => {
  let fileService: FileService;

  beforeEach(() => {
    fileService = new FileService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('openFileDialog', () => {
    it('should return cancelled result when dialog is cancelled', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      const result = await fileService.openFileDialog();

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('should return cancelled result when no files selected', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [],
      });

      const result = await fileService.openFileDialog();

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('should return error for non-markdown files', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/path/to/file.txt'],
      });

      const result = await fileService.openFileDialog();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported');
    });

    it('should successfully open and read a markdown file', async () => {
      const filePath = '/path/to/file.md';
      const content = '# Hello World';

      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [filePath],
      });

      vi.mocked(fs.stat).mockResolvedValue({
        size: 100,
        mtime: new Date(),
        birthtime: new Date(),
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);

      vi.mocked(fs.readFile).mockResolvedValue(content);

      const result = await fileService.openFileDialog();

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(filePath);
      expect(result.content).toBe(content);
    });

    it('should return error when file read fails', async () => {
      const filePath = '/path/to/file.md';

      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [filePath],
      });

      vi.mocked(fs.stat).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' })
      );

      const result = await fileService.openFileDialog();

      expect(result.success).toBe(false);
      expect(result.filePath).toBe(filePath);
      expect(result.error).toContain('could not be found');
    });
  });

  describe('readFile', () => {
    const filePath = '/path/to/test.md';

    it('should successfully read a markdown file', async () => {
      const content = '# Test Content\n\nSome text';
      const mockStats = {
        size: 100,
        mtime: new Date('2024-01-15'),
        birthtime: new Date('2024-01-01'),
      };

      vi.mocked(fs.stat).mockResolvedValue(
        mockStats as unknown as Awaited<ReturnType<typeof fs.stat>>
      );
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const result = await fileService.readFile(filePath);

      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
      expect(result.stats).toBeDefined();
      expect(result.stats?.size).toBe(100);
    });

    it('should return error for non-existent file', async () => {
      vi.mocked(fs.stat).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      const result = await fileService.readFile(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('could not be found');
    });

    it('should return error for file without read permission', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        size: 100,
        mtime: new Date(),
        birthtime: new Date(),
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);

      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error('EACCES'), { code: 'EACCES' })
      );

      const result = await fileService.readFile(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('permission');
    });

    it('should return error for files exceeding max size', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        size: MAX_FILE_SIZE_BYTES + 1,
        mtime: new Date(),
        birthtime: new Date(),
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);

      const result = await fileService.readFile(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should handle generic read errors', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        size: 100,
        mtime: new Date(),
        birthtime: new Date(),
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);

      vi.mocked(fs.readFile).mockRejectedValue(new Error('Unknown error'));

      const result = await fileService.readFile(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getFileStats', () => {
    const filePath = '/path/to/file.md';

    it('should return stats for existing file', async () => {
      const mtime = new Date('2024-01-15');
      const birthtime = new Date('2024-01-01');

      vi.mocked(fs.stat).mockResolvedValue({
        size: 1024,
        mtime,
        birthtime,
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);

      const stats = await fileService.getFileStats(filePath);

      expect(stats).not.toBeNull();
      expect(stats?.size).toBe(1024);
      expect(stats?.modifiedAt).toEqual(mtime);
      expect(stats?.createdAt).toEqual(birthtime);
    });

    it('should return null for non-existent file', async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

      const stats = await fileService.getFileStats(filePath);

      expect(stats).toBeNull();
    });
  });

  describe('isMarkdownFile', () => {
    it('should recognize .md extension', () => {
      expect(fileService.isMarkdownFile('.md')).toBe(true);
      expect(fileService.isMarkdownFile('md')).toBe(true);
    });

    it('should recognize .markdown extension', () => {
      expect(fileService.isMarkdownFile('.markdown')).toBe(true);
      expect(fileService.isMarkdownFile('markdown')).toBe(true);
    });

    it('should recognize .mdown extension', () => {
      expect(fileService.isMarkdownFile('.mdown')).toBe(true);
      expect(fileService.isMarkdownFile('mdown')).toBe(true);
    });

    it('should recognize .mkd extension', () => {
      expect(fileService.isMarkdownFile('.mkd')).toBe(true);
      expect(fileService.isMarkdownFile('mkd')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(fileService.isMarkdownFile('.MD')).toBe(true);
      expect(fileService.isMarkdownFile('.Markdown')).toBe(true);
      expect(fileService.isMarkdownFile('MDOWN')).toBe(true);
    });

    it('should reject non-markdown extensions', () => {
      expect(fileService.isMarkdownFile('.txt')).toBe(false);
      expect(fileService.isMarkdownFile('.html')).toBe(false);
      expect(fileService.isMarkdownFile('.js')).toBe(false);
      expect(fileService.isMarkdownFile('.mdx')).toBe(false);
    });
  });
});
