/**
 * FileWatcherService - Watches files for changes using chokidar
 */
import { readFile, stat } from 'node:fs/promises';

import { FILE_WATCH_DEBOUNCE_MS } from '@shared/constants';
import { FileWatchError } from '@shared/errors';
import { watch } from 'chokidar';

import type { FileChangeEvent, FileDeleteEvent, FileStats } from '@shared/types';
import type { FSWatcher } from 'chokidar';

/**
 * Callback types for file events
 */
export type FileChangeCallback = (event: FileChangeEvent) => void;
export type FileDeleteCallback = (event: FileDeleteEvent) => void;

/**
 * Service for watching file changes
 */
export class FileWatcherService {
  private watcher: FSWatcher | null = null;
  private watchedFilePath: string | null = null;
  private changeCallbacks: Set<FileChangeCallback> = new Set();
  private deleteCallbacks: Set<FileDeleteCallback> = new Set();
  private debounceTimer: NodeJS.Timeout | null = null;

  /**
   * Start watching a file for changes
   * @param filePath - Path to the file to watch
   */
  async watch(filePath: string): Promise<void> {
    // Stop watching previous file if any
    await this.unwatch();

    try {
      this.watchedFilePath = filePath;

      this.watcher = watch(filePath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: FILE_WATCH_DEBOUNCE_MS,
          pollInterval: 100,
        },
      });

      // Handle file changes
      this.watcher.on('change', (changedPath: string) => {
        void this.handleFileChange(changedPath);
      });

      // Handle file deletion
      this.watcher.on('unlink', (deletedPath: string) => {
        this.handleFileDelete(deletedPath);
      });

      // Handle errors
      this.watcher.on('error', (error: unknown) => {
        console.error('File watcher error:', error);
      });

      // Wait for watcher to be ready
      await new Promise<void>((resolve, reject) => {
        if (!this.watcher) {
          reject(new FileWatchError(filePath, 'Watcher not initialized'));
          return;
        }
        this.watcher.once('ready', () => resolve());
        this.watcher.once('error', reject);
      });
    } catch (error) {
      this.watchedFilePath = null;
      throw new FileWatchError(
        filePath,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Stop watching the current file
   */
  async unwatch(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.watchedFilePath = null;
  }

  /**
   * Get the currently watched file path
   */
  getWatchedFile(): string | null {
    return this.watchedFilePath;
  }

  /**
   * Check if currently watching a file
   */
  isWatching(): boolean {
    return this.watcher !== null && this.watchedFilePath !== null;
  }

  /**
   * Register callback for file changes
   */
  onFileChange(callback: FileChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  /**
   * Register callback for file deletion
   */
  onFileDelete(callback: FileDeleteCallback): () => void {
    this.deleteCallbacks.add(callback);
    return () => {
      this.deleteCallbacks.delete(callback);
    };
  }

  /**
   * Handle file change event with debouncing
   */
  private handleFileChange(filePath: string): void {
    // Clear existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Debounce the change notification
    this.debounceTimer = setTimeout(() => {
      void this.processFileChange(filePath);
    }, FILE_WATCH_DEBOUNCE_MS);
  }

  /**
   * Process the file change after debounce
   */
  private async processFileChange(filePath: string): Promise<void> {
    try {
      const [content, stats] = await Promise.all([
        readFile(filePath, 'utf-8'),
        this.getFileStats(filePath),
      ]);

      if (!stats) {
        return;
      }

      const event: FileChangeEvent = {
        filePath,
        content,
        stats,
      };

      this.changeCallbacks.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error('Error in file change callback:', error);
        }
      });
    } catch (error) {
      console.error('Error reading changed file:', error);
    }
  }

  /**
   * Handle file deletion event
   */
  private handleFileDelete(filePath: string): void {
    const event: FileDeleteEvent = { filePath };

    this.deleteCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in file delete callback:', error);
      }
    });

    // Clear watched file reference since it's deleted
    this.watchedFilePath = null;
  }

  /**
   * Get file statistics
   */
  private async getFileStats(filePath: string): Promise<FileStats | null> {
    try {
      const stats = await stat(filePath);
      return {
        size: stats.size,
        modifiedAt: stats.mtime,
        createdAt: stats.birthtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    await this.unwatch();
    this.changeCallbacks.clear();
    this.deleteCallbacks.clear();
  }
}

/**
 * Singleton instance
 */
let fileWatcherInstance: FileWatcherService | null = null;

/**
 * Get the FileWatcherService singleton instance
 */
export function getFileWatcherService(): FileWatcherService {
  if (!fileWatcherInstance) {
    fileWatcherInstance = new FileWatcherService();
  }
  return fileWatcherInstance;
}
