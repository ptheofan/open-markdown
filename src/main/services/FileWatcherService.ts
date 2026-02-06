/**
 * FileWatcherService - Watches multiple files for changes using chokidar
 * with reference counting for multi-window support
 */
import { readFile, stat } from 'node:fs/promises';

import { FILE_WATCH_DEBOUNCE_MS } from '@shared/constants';
import { FileWatchError } from '@shared/errors';
import { watch } from 'chokidar';

import type { FileChangeEvent, FileDeleteEvent, FileStats } from '@shared/types';
import type { FSWatcher } from 'chokidar';

export type FileChangeCallback = (event: FileChangeEvent) => void;
export type FileDeleteCallback = (event: FileDeleteEvent) => void;

interface WatchedFileEntry {
  watcher: FSWatcher;
  windowIds: Set<number>;
}

interface WindowCallbacks {
  changeCallbacks: Set<FileChangeCallback>;
  deleteCallbacks: Set<FileDeleteCallback>;
}

export class FileWatcherService {
  private watchedFiles: Map<string, WatchedFileEntry> = new Map();
  private windowCallbacks: Map<number, WindowCallbacks> = new Map();

  /**
   * Start watching a file for a specific window.
   * If the file is already watched, adds the window to the reference set.
   */
  async watch(filePath: string, windowId: number): Promise<void> {
    const existing = this.watchedFiles.get(filePath);

    if (existing) {
      existing.windowIds.add(windowId);
      return;
    }

    try {
      const watcher = watch(filePath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: FILE_WATCH_DEBOUNCE_MS,
          pollInterval: 100,
        },
      });

      const entry: WatchedFileEntry = {
        watcher,
        windowIds: new Set([windowId]),
      };

      watcher.on('change', (changedPath: string) => {
        void this.processFileChange(changedPath);
      });

      watcher.on('unlink', (deletedPath: string) => {
        this.handleFileDelete(deletedPath);
      });

      watcher.on('error', (error: unknown) => {
        console.error('File watcher error:', error);
      });

      await new Promise<void>((resolve, reject) => {
        watcher.once('ready', () => resolve());
        watcher.once('error', reject);
      });

      this.watchedFiles.set(filePath, entry);
    } catch (error) {
      throw new FileWatchError(
        filePath,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Stop watching a file for a specific window.
   * Closes the chokidar watcher only when no windows remain.
   */
  async unwatch(filePath: string, windowId: number): Promise<void> {
    const entry = this.watchedFiles.get(filePath);
    if (!entry) return;

    entry.windowIds.delete(windowId);

    if (entry.windowIds.size === 0) {
      await this.closeWatcherEntry(filePath, entry);
    }
  }

  /**
   * Stop watching all files for a specific window (window close cleanup).
   */
  async unwatchAll(windowId: number): Promise<void> {
    const filePaths = [...this.watchedFiles.keys()];
    for (const filePath of filePaths) {
      await this.unwatch(filePath, windowId);
    }
    this.windowCallbacks.delete(windowId);
  }

  /**
   * Check if a specific file is being watched by any window
   */
  isWatchingFile(filePath: string): boolean {
    return this.watchedFiles.has(filePath);
  }

  /**
   * Check if watching any files
   */
  isWatching(): boolean {
    return this.watchedFiles.size > 0;
  }

  /**
   * Register callback for file changes on a specific window
   */
  onFileChange(windowId: number, callback: FileChangeCallback): () => void {
    const callbacks = this.getOrCreateWindowCallbacks(windowId);
    callbacks.changeCallbacks.add(callback);
    return () => {
      callbacks.changeCallbacks.delete(callback);
    };
  }

  /**
   * Register callback for file deletion on a specific window
   */
  onFileDelete(windowId: number, callback: FileDeleteCallback): () => void {
    const callbacks = this.getOrCreateWindowCallbacks(windowId);
    callbacks.deleteCallbacks.add(callback);
    return () => {
      callbacks.deleteCallbacks.delete(callback);
    };
  }

  /**
   * Cleanup all resources
   */
  async destroy(): Promise<void> {
    for (const [filePath, entry] of this.watchedFiles) {
      await this.closeWatcherEntry(filePath, entry);
    }
    this.windowCallbacks.clear();
  }

  private getOrCreateWindowCallbacks(windowId: number): WindowCallbacks {
    let callbacks = this.windowCallbacks.get(windowId);
    if (!callbacks) {
      callbacks = {
        changeCallbacks: new Set(),
        deleteCallbacks: new Set(),
      };
      this.windowCallbacks.set(windowId, callbacks);
    }
    return callbacks;
  }

  private async closeWatcherEntry(filePath: string, entry: WatchedFileEntry): Promise<void> {
    await entry.watcher.close();
    this.watchedFiles.delete(filePath);
  }

  /**
   * Process file change - only notify windows watching this file.
   * Debouncing is handled by chokidar's awaitWriteFinish option.
   */
  private async processFileChange(filePath: string): Promise<void> {
    try {
      const [content, stats] = await Promise.all([
        readFile(filePath, 'utf-8'),
        this.getFileStats(filePath),
      ]);

      if (!stats) return;

      const event: FileChangeEvent = { filePath, content, stats };

      const entry = this.watchedFiles.get(filePath);
      if (!entry) return;

      for (const windowId of entry.windowIds) {
        const callbacks = this.windowCallbacks.get(windowId);
        if (!callbacks) continue;

        callbacks.changeCallbacks.forEach((callback) => {
          try {
            callback(event);
          } catch (error) {
            console.error('Error in file change callback:', error);
          }
        });
      }
    } catch (error) {
      console.error('Error reading changed file:', error);
    }
  }

  /**
   * Handle file deletion - only notify windows watching this file
   */
  private handleFileDelete(filePath: string): void {
    const entry = this.watchedFiles.get(filePath);
    if (!entry) return;

    const event: FileDeleteEvent = { filePath };

    for (const windowId of entry.windowIds) {
      const callbacks = this.windowCallbacks.get(windowId);
      if (!callbacks) continue;

      callbacks.deleteCallbacks.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error('Error in file delete callback:', error);
        }
      });
    }

    // Remove the entry and close the watcher (fire-and-forget since file is already gone)
    this.watchedFiles.delete(filePath);
    void entry.watcher.close();
  }

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
}

let fileWatcherInstance: FileWatcherService | null = null;

export function getFileWatcherService(): FileWatcherService {
  if (!fileWatcherInstance) {
    fileWatcherInstance = new FileWatcherService();
  }
  return fileWatcherInstance;
}
