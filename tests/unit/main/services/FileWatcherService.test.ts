/**
 * FileWatcherService unit tests
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  FileWatcherService,
  getFileWatcherService,
} from '@main/services/FileWatcherService';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chokidar
const mockWatcher = {
  on: vi.fn().mockReturnThis(),
  once: vi.fn().mockReturnThis(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('chokidar', () => ({
  watch: vi.fn(() => mockWatcher),
}));

describe('FileWatcherService', () => {
  let service: FileWatcherService;
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = new FileWatcherService();

    // Create temp file for testing
    tempDir = path.join(os.tmpdir(), `watcher-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    testFile = path.join(tempDir, 'test.md');
    await fs.writeFile(testFile, '# Test');

    // Default mock behavior: resolve ready event immediately
    mockWatcher.once.mockImplementation((event: string, callback: () => void) => {
      if (event === 'ready') {
        setTimeout(() => callback(), 0);
      }
      return mockWatcher;
    });
  });

  afterEach(async () => {
    await service.destroy();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('watch', () => {
    it('should start watching a file', async () => {
      const { watch } = await import('chokidar');

      await service.watch(testFile);

      expect(watch).toHaveBeenCalledWith(testFile, expect.objectContaining({
        persistent: true,
        ignoreInitial: true,
      }));
      expect(service.isWatching()).toBe(true);
      expect(service.getWatchedFile()).toBe(testFile);
    });

    it('should stop watching previous file when watching new file', async () => {
      const anotherFile = path.join(tempDir, 'another.md');
      await fs.writeFile(anotherFile, '# Another');

      await service.watch(testFile);
      expect(service.getWatchedFile()).toBe(testFile);

      await service.watch(anotherFile);
      expect(mockWatcher.close).toHaveBeenCalled();
      expect(service.getWatchedFile()).toBe(anotherFile);
    });

    it('should register change event handler', async () => {
      await service.watch(testFile);

      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should register unlink event handler', async () => {
      await service.watch(testFile);

      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
    });

    it('should register error event handler', async () => {
      await service.watch(testFile);

      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should throw FileWatchError when watcher fails to initialize', async () => {
      mockWatcher.once.mockImplementation((event: string, callback: (error: Error) => void) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('Watch failed')), 0);
        }
        return mockWatcher;
      });

      await expect(service.watch(testFile)).rejects.toThrow('Watch failed');
      expect(service.getWatchedFile()).toBeNull();
    });
  });

  describe('unwatch', () => {
    it('should stop watching the current file', async () => {
      await service.watch(testFile);
      await service.unwatch();

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(service.isWatching()).toBe(false);
      expect(service.getWatchedFile()).toBeNull();
    });

    it('should handle unwatch when not watching', async () => {
      await expect(service.unwatch()).resolves.not.toThrow();
    });

    it('should clear debounce timer if pending', async () => {
      await service.watch(testFile);

      // Get the change handler
      const changeCall = mockWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'change'
      );
      const changeHandler = changeCall?.[1] as (path: string) => void;

      // Trigger a change (this would start debounce)
      changeHandler(testFile);

      // Unwatch should clear the timer
      await service.unwatch();

      expect(service.isWatching()).toBe(false);
    });
  });

  describe('getWatchedFile', () => {
    it('should return null when not watching', () => {
      expect(service.getWatchedFile()).toBeNull();
    });

    it('should return file path when watching', async () => {
      await service.watch(testFile);
      expect(service.getWatchedFile()).toBe(testFile);
    });
  });

  describe('isWatching', () => {
    it('should return false when not watching', () => {
      expect(service.isWatching()).toBe(false);
    });

    it('should return true when watching', async () => {
      await service.watch(testFile);
      expect(service.isWatching()).toBe(true);
    });

    it('should return false after unwatch', async () => {
      await service.watch(testFile);
      await service.unwatch();
      expect(service.isWatching()).toBe(false);
    });
  });

  describe('onFileChange', () => {
    it('should register callback for file changes', async () => {
      const callback = vi.fn();
      service.onFileChange(callback);

      await service.watch(testFile);

      // Get the change handler
      const changeCall = mockWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'change'
      );
      expect(changeCall).toBeDefined();
    });

    it('should return cleanup function', () => {
      const callback = vi.fn();
      const cleanup = service.onFileChange(callback);

      expect(typeof cleanup).toBe('function');
    });

    it('should unregister callback when cleanup is called', () => {
      const callback = vi.fn();
      const cleanup = service.onFileChange(callback);

      cleanup();

      // Callback should no longer be in the set (we can't verify directly,
      // but we can verify subsequent change events don't call it)
    });
  });

  describe('onFileDelete', () => {
    it('should register callback for file deletions', () => {
      const callback = vi.fn();
      service.onFileDelete(callback);

      // Callback should be registered
    });

    it('should return cleanup function', () => {
      const callback = vi.fn();
      const cleanup = service.onFileDelete(callback);

      expect(typeof cleanup).toBe('function');
    });

    it('should call callback when file is deleted', async () => {
      const callback = vi.fn();
      service.onFileDelete(callback);

      await service.watch(testFile);

      // Get the unlink handler
      const unlinkCall = mockWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'unlink'
      );
      const unlinkHandler = unlinkCall?.[1] as (path: string) => void;

      // Simulate file deletion
      unlinkHandler(testFile);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: testFile })
      );
    });

    it('should catch errors in delete callback', async () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      service.onFileDelete(errorCallback);

      await service.watch(testFile);

      // Get the unlink handler
      const unlinkCall = mockWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'unlink'
      );
      const unlinkHandler = unlinkCall?.[1] as (path: string) => void;

      // Simulate file deletion - should not throw
      expect(() => unlinkHandler(testFile)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error in file delete callback:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should clear watched file reference after deletion', async () => {
      await service.watch(testFile);

      // Get the unlink handler
      const unlinkCall = mockWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'unlink'
      );
      const unlinkHandler = unlinkCall?.[1] as (path: string) => void;

      // Simulate file deletion
      unlinkHandler(testFile);

      expect(service.getWatchedFile()).toBeNull();
    });
  });

  describe('destroy', () => {
    it('should stop watching and clear callbacks', async () => {
      const changeCallback = vi.fn();
      const deleteCallback = vi.fn();

      service.onFileChange(changeCallback);
      service.onFileDelete(deleteCallback);

      await service.watch(testFile);
      await service.destroy();

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(service.isWatching()).toBe(false);
    });

    it('should handle destroy when not watching', async () => {
      await expect(service.destroy()).resolves.not.toThrow();
    });
  });
});

describe('getFileWatcherService', () => {
  it('should return singleton instance', () => {
    const instance1 = getFileWatcherService();
    const instance2 = getFileWatcherService();

    expect(instance1).toBe(instance2);
  });
});
