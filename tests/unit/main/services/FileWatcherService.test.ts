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

interface MockWatcher {
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockWatcher(): MockWatcher {
  const watcher: MockWatcher = {
    on: vi.fn().mockReturnThis(),
    once: vi.fn().mockImplementation((event: string, callback: () => void) => {
      if (event === 'ready') {
        setTimeout(() => callback(), 0);
      }
      return watcher;
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return watcher;
}

let mockWatchers: MockWatcher[] = [];

function getWatcher(index: number): MockWatcher {
  const watcher = mockWatchers[index];
  if (!watcher) {
    throw new Error(`No mock watcher at index ${index}`);
  }
  return watcher;
}

vi.mock('chokidar', () => ({
  watch: vi.fn(() => {
    const watcher = createMockWatcher();
    mockWatchers.push(watcher);
    return watcher;
  }),
}));

describe('FileWatcherService', () => {
  let service: FileWatcherService;
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockWatchers = [];
    service = new FileWatcherService();

    tempDir = path.join(os.tmpdir(), `watcher-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    testFile = path.join(tempDir, 'test.md');
    await fs.writeFile(testFile, '# Test');
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
    it('should start watching a file for a window', async () => {
      const { watch } = await import('chokidar');

      await service.watch(testFile, 1);

      expect(watch).toHaveBeenCalledWith(testFile, expect.objectContaining({
        persistent: true,
        ignoreInitial: true,
      }));
      expect(service.isWatching()).toBe(true);
      expect(service.isWatchingFile(testFile)).toBe(true);
    });

    it('should register change event handler', async () => {
      await service.watch(testFile, 1);

      expect(getWatcher(0).on).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should register unlink event handler', async () => {
      await service.watch(testFile, 1);

      expect(getWatcher(0).on).toHaveBeenCalledWith('unlink', expect.any(Function));
    });

    it('should register error event handler', async () => {
      await service.watch(testFile, 1);

      expect(getWatcher(0).on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should throw FileWatchError when watcher fails to initialize', async () => {
      // Override the mock factory for this test - we need a watcher that errors
      const { watch } = await import('chokidar');
      const errorWatcher = createMockWatcher();
      errorWatcher.once.mockImplementation((event: string, callback: (error: Error) => void) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('Watch failed')), 0);
        }
        return errorWatcher;
      });
      vi.mocked(watch).mockReturnValueOnce(errorWatcher as unknown as ReturnType<typeof watch>);

      await expect(service.watch(testFile, 1)).rejects.toThrow('Watch failed');
      expect(service.isWatchingFile(testFile)).toBe(false);
    });
  });

  describe('unwatch', () => {
    it('should stop watching a file for a window', async () => {
      await service.watch(testFile, 1);
      await service.unwatch(testFile, 1);

      expect(getWatcher(0).close).toHaveBeenCalled();
      expect(service.isWatching()).toBe(false);
      expect(service.isWatchingFile(testFile)).toBe(false);
    });

    it('should handle unwatch when not watching', async () => {
      await expect(service.unwatch(testFile, 1)).resolves.not.toThrow();
    });

    it('should clear debounce timer if pending', async () => {
      await service.watch(testFile, 1);

      const changeCall = getWatcher(0).on.mock.calls.find(
        (call: unknown[]) => call[0] === 'change'
      );
      const changeHandler = changeCall?.[1] as (path: string) => void;

      changeHandler(testFile);

      await service.unwatch(testFile, 1);

      expect(service.isWatching()).toBe(false);
    });
  });

  describe('isWatchingFile', () => {
    it('should return false when not watching', () => {
      expect(service.isWatchingFile(testFile)).toBe(false);
    });

    it('should return true when watching the file', async () => {
      await service.watch(testFile, 1);
      expect(service.isWatchingFile(testFile)).toBe(true);
    });

    it('should return false for a different file', async () => {
      await service.watch(testFile, 1);
      expect(service.isWatchingFile('/some/other/file.md')).toBe(false);
    });
  });

  describe('isWatching', () => {
    it('should return false when not watching', () => {
      expect(service.isWatching()).toBe(false);
    });

    it('should return true when watching', async () => {
      await service.watch(testFile, 1);
      expect(service.isWatching()).toBe(true);
    });

    it('should return false after unwatch', async () => {
      await service.watch(testFile, 1);
      await service.unwatch(testFile, 1);
      expect(service.isWatching()).toBe(false);
    });
  });

  describe('onFileChange', () => {
    it('should register callback for file changes', async () => {
      const callback = vi.fn();
      service.onFileChange(1, callback);

      await service.watch(testFile, 1);

      const changeCall = getWatcher(0).on.mock.calls.find(
        (call: unknown[]) => call[0] === 'change'
      );
      expect(changeCall).toBeDefined();
    });

    it('should return cleanup function', () => {
      const callback = vi.fn();
      const cleanup = service.onFileChange(1, callback);

      expect(typeof cleanup).toBe('function');
    });

    it('should unregister callback when cleanup is called', () => {
      const callback = vi.fn();
      const cleanup = service.onFileChange(1, callback);

      cleanup();
    });
  });

  describe('onFileDelete', () => {
    it('should register callback for file deletions', () => {
      const callback = vi.fn();
      service.onFileDelete(1, callback);
    });

    it('should return cleanup function', () => {
      const callback = vi.fn();
      const cleanup = service.onFileDelete(1, callback);

      expect(typeof cleanup).toBe('function');
    });

    it('should call callback when file is deleted', async () => {
      const callback = vi.fn();
      service.onFileDelete(1, callback);

      await service.watch(testFile, 1);

      const unlinkCall = getWatcher(0).on.mock.calls.find(
        (call: unknown[]) => call[0] === 'unlink'
      );
      const unlinkHandler = unlinkCall?.[1] as (path: string) => void;

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

      service.onFileDelete(1, errorCallback);

      await service.watch(testFile, 1);

      const unlinkCall = getWatcher(0).on.mock.calls.find(
        (call: unknown[]) => call[0] === 'unlink'
      );
      const unlinkHandler = unlinkCall?.[1] as (path: string) => void;

      expect(() => unlinkHandler(testFile)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error in file delete callback:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should remove window from watcher after deletion', async () => {
      await service.watch(testFile, 1);

      const unlinkCall = getWatcher(0).on.mock.calls.find(
        (call: unknown[]) => call[0] === 'unlink'
      );
      const unlinkHandler = unlinkCall?.[1] as (path: string) => void;

      unlinkHandler(testFile);

      expect(service.isWatchingFile(testFile)).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should stop watching and clear callbacks', async () => {
      const changeCallback = vi.fn();
      const deleteCallback = vi.fn();

      service.onFileChange(1, changeCallback);
      service.onFileDelete(1, deleteCallback);

      await service.watch(testFile, 1);
      await service.destroy();

      expect(getWatcher(0).close).toHaveBeenCalled();
      expect(service.isWatching()).toBe(false);
    });

    it('should handle destroy when not watching', async () => {
      await expect(service.destroy()).resolves.not.toThrow();
    });
  });

  describe('multi-file watching', () => {
    let secondFile: string;

    beforeEach(async () => {
      secondFile = path.join(tempDir, 'second.md');
      await fs.writeFile(secondFile, '# Second');
    });

    it('should watch multiple files simultaneously', async () => {
      const { watch: chokidarWatch } = await import('chokidar');

      await service.watch(testFile, 1);
      await service.watch(secondFile, 2);

      expect(chokidarWatch).toHaveBeenCalledTimes(2);
      expect(service.isWatchingFile(testFile)).toBe(true);
      expect(service.isWatchingFile(secondFile)).toBe(true);
      expect(mockWatchers).toHaveLength(2);
    });

    it('should reference-count when same file watched by multiple windows', async () => {
      const { watch: chokidarWatch } = await import('chokidar');

      await service.watch(testFile, 1);
      await service.watch(testFile, 2);

      // Should only create one chokidar watcher for the same file
      expect(chokidarWatch).toHaveBeenCalledTimes(1);
      expect(service.isWatchingFile(testFile)).toBe(true);
      expect(mockWatchers).toHaveLength(1);
    });

    it('should only notify windows watching a specific file on change', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      service.onFileChange(1, callback1);
      service.onFileChange(2, callback2);

      await service.watch(testFile, 1);
      await service.watch(secondFile, 2);

      // Trigger change on testFile (watched by window 1)
      const changeCall = getWatcher(0).on.mock.calls.find(
        (call: unknown[]) => call[0] === 'change'
      );
      const changeHandler = changeCall?.[1] as (path: string) => void;

      changeHandler(testFile);

      // Wait for debounce
      await vi.waitFor(() => {
        expect(callback1).toHaveBeenCalledWith(
          expect.objectContaining({ filePath: testFile })
        );
      });

      expect(callback2).not.toHaveBeenCalled();
    });

    it('should only notify windows watching a specific file on delete', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      service.onFileDelete(1, callback1);
      service.onFileDelete(2, callback2);

      await service.watch(testFile, 1);
      await service.watch(secondFile, 2);

      // Trigger delete on secondFile (watched by window 2)
      const unlinkCall = getWatcher(1).on.mock.calls.find(
        (call: unknown[]) => call[0] === 'unlink'
      );
      const unlinkHandler = unlinkCall?.[1] as (path: string) => void;

      unlinkHandler(secondFile);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: secondFile })
      );
    });

    it('should clean up all subscriptions for a window via unwatchAll', async () => {
      await service.watch(testFile, 1);
      await service.watch(secondFile, 1);

      expect(service.isWatchingFile(testFile)).toBe(true);
      expect(service.isWatchingFile(secondFile)).toBe(true);

      await service.unwatchAll(1);

      expect(service.isWatchingFile(testFile)).toBe(false);
      expect(service.isWatchingFile(secondFile)).toBe(false);
      expect(service.isWatching()).toBe(false);
    });

    it('should close watcher when last window unwatches a file', async () => {
      await service.watch(testFile, 1);
      await service.watch(testFile, 2);

      await service.unwatch(testFile, 1);
      // First window unwatched, but window 2 still watching - watcher should stay
      expect(getWatcher(0).close).not.toHaveBeenCalled();
      expect(service.isWatchingFile(testFile)).toBe(true);

      await service.unwatch(testFile, 2);
      // Last window unwatched - watcher should be closed
      expect(getWatcher(0).close).toHaveBeenCalled();
      expect(service.isWatchingFile(testFile)).toBe(false);
    });

    it('should not close watcher when other windows still watch the file', async () => {
      await service.watch(testFile, 1);
      await service.watch(testFile, 2);
      await service.watch(testFile, 3);

      await service.unwatch(testFile, 1);

      expect(getWatcher(0).close).not.toHaveBeenCalled();
      expect(service.isWatchingFile(testFile)).toBe(true);

      await service.unwatch(testFile, 2);

      expect(getWatcher(0).close).not.toHaveBeenCalled();
      expect(service.isWatchingFile(testFile)).toBe(true);
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
