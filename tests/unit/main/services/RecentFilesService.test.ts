/**
 * RecentFilesService unit tests
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createRecentFilesService,
  resetRecentFilesService,
} from '@main/services/RecentFilesService';

import type { RecentFilesService } from '@main/services/RecentFilesService';

// Mock Electron modules
vi.mock('electron', async () => {
  const pathModule = await import('path');
  return {
    app: {
      getPath: vi.fn(() => pathModule.join('mock', 'user', 'data')),
      addRecentDocument: vi.fn(),
      clearRecentDocuments: vi.fn(),
    },
  };
});

describe('RecentFilesService', () => {
  let tempDir: string;
  let service: RecentFilesService;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `recent-files-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    resetRecentFilesService();
    service = createRecentFilesService(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialize', () => {
    it('should initialize with empty list when no file exists', async () => {
      await service.initialize();
      expect(service.getRecentFiles()).toEqual([]);
    });

    it('should load saved recent files on initialize', async () => {
      const data = {
        version: 1,
        files: [
          { filePath: '/test/file.md', fileName: 'file.md', openedAt: '2026-01-01T00:00:00.000Z' },
        ],
      };
      await fs.writeFile(
        path.join(tempDir, 'recent-files.json'),
        JSON.stringify(data),
        'utf-8'
      );

      await service.initialize();
      const files = service.getRecentFiles();
      expect(files).toHaveLength(1);
      expect(files[0].filePath).toBe('/test/file.md');
    });

    it('should handle corrupt JSON gracefully', async () => {
      await fs.writeFile(
        path.join(tempDir, 'recent-files.json'),
        'not valid json{{{',
        'utf-8'
      );

      await service.initialize();
      expect(service.getRecentFiles()).toEqual([]);
    });

    it('should handle invalid structure gracefully', async () => {
      await fs.writeFile(
        path.join(tempDir, 'recent-files.json'),
        JSON.stringify({ wrong: 'structure' }),
        'utf-8'
      );

      await service.initialize();
      expect(service.getRecentFiles()).toEqual([]);
    });

    it('should be idempotent', async () => {
      await service.initialize();
      await service.initialize();
      expect(service.getRecentFiles()).toEqual([]);
    });
  });

  describe('addRecentFile', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should add a file to the list', async () => {
      await service.addRecentFile('/test/file.md');
      const files = service.getRecentFiles();
      expect(files).toHaveLength(1);
      expect(files[0].filePath).toBe('/test/file.md');
      expect(files[0].fileName).toBe('file.md');
      expect(files[0].openedAt).toBeDefined();
    });

    it('should prepend new files (most recent first)', async () => {
      await service.addRecentFile('/test/first.md');
      await service.addRecentFile('/test/second.md');
      const files = service.getRecentFiles();
      expect(files[0].filePath).toBe('/test/second.md');
      expect(files[1].filePath).toBe('/test/first.md');
    });

    it('should deduplicate by moving existing entry to top', async () => {
      await service.addRecentFile('/test/first.md');
      await service.addRecentFile('/test/second.md');
      await service.addRecentFile('/test/first.md');
      const files = service.getRecentFiles();
      expect(files).toHaveLength(2);
      expect(files[0].filePath).toBe('/test/first.md');
      expect(files[1].filePath).toBe('/test/second.md');
    });

    it('should trim to max 10 entries', async () => {
      for (let i = 0; i < 12; i++) {
        await service.addRecentFile(`/test/file${i}.md`);
      }
      const files = service.getRecentFiles();
      expect(files).toHaveLength(10);
      expect(files[0].filePath).toBe('/test/file11.md');
    });

    it('should call app.addRecentDocument', async () => {
      const { app } = await import('electron');
      await service.addRecentFile('/test/file.md');
      expect(app.addRecentDocument).toHaveBeenCalledWith('/test/file.md');
    });

    it('should notify change listeners', async () => {
      const listener = vi.fn();
      service.onRecentFilesChange(listener);
      await service.addRecentFile('/test/file.md');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ filePath: '/test/file.md' }),
      ]));
    });

    it('should persist to disk', async () => {
      await service.addRecentFile('/test/file.md');

      const service2 = createRecentFilesService(tempDir);
      await service2.initialize();
      const files = service2.getRecentFiles();
      expect(files).toHaveLength(1);
      expect(files[0].filePath).toBe('/test/file.md');
    });
  });

  describe('removeRecentFile', () => {
    beforeEach(async () => {
      await service.initialize();
      await service.addRecentFile('/test/first.md');
      await service.addRecentFile('/test/second.md');
    });

    it('should remove a file from the list', async () => {
      await service.removeRecentFile('/test/first.md');
      const files = service.getRecentFiles();
      expect(files).toHaveLength(1);
      expect(files[0].filePath).toBe('/test/second.md');
    });

    it('should be a no-op for non-existent file', async () => {
      await service.removeRecentFile('/test/nonexistent.md');
      expect(service.getRecentFiles()).toHaveLength(2);
    });

    it('should notify change listeners', async () => {
      const listener = vi.fn();
      service.onRecentFilesChange(listener);
      await service.removeRecentFile('/test/first.md');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearRecentFiles', () => {
    beforeEach(async () => {
      await service.initialize();
      await service.addRecentFile('/test/file.md');
    });

    it('should clear all entries', async () => {
      await service.clearRecentFiles();
      expect(service.getRecentFiles()).toEqual([]);
    });

    it('should call app.clearRecentDocuments', async () => {
      const { app } = await import('electron');
      await service.clearRecentFiles();
      expect(app.clearRecentDocuments).toHaveBeenCalled();
    });

    it('should notify change listeners', async () => {
      const listener = vi.fn();
      service.onRecentFilesChange(listener);
      await service.clearRecentFiles();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith([]);
    });
  });

  describe('onRecentFilesChange', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return a cleanup function that unsubscribes', async () => {
      const listener = vi.fn();
      const cleanup = service.onRecentFilesChange(listener);
      cleanup();
      await service.addRecentFile('/test/file.md');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getRecentFiles', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return a cloned array (not a reference)', async () => {
      await service.addRecentFile('/test/file.md');
      const files1 = service.getRecentFiles();
      const files2 = service.getRecentFiles();
      expect(files1).toEqual(files2);
      expect(files1).not.toBe(files2);
    });
  });
});
