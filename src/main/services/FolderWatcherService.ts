/**
 * FolderWatcherService - tells the sidebar when a listed directory changes
 *
 * One shallow chokidar watcher per expanded directory, shared between the
 * windows that show it. Bursts of events (a save that writes a temp file and
 * renames it, a `git checkout`) collapse into one notice per directory.
 */
import path from 'node:path';

import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';

import { DEFAULT_IGNORED_DIRS } from './FolderService';

export type FolderChangeCallback = (dirPath: string) => void;

/** Quiet time after the last event before the sidebar is told */
export const FOLDER_CHANGE_DEBOUNCE_MS = 250;

interface WatchedDirectory {
  watcher: FSWatcher;
  windowIds: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
}

export class FolderWatcherService {
  private readonly watched = new Map<string, WatchedDirectory>();
  private readonly callbacks = new Map<number, Set<FolderChangeCallback>>();

  /** Watch one directory (not its subdirectories) for a window */
  async watch(dirPath: string, windowId: number): Promise<void> {
    const existing = this.watched.get(dirPath);
    if (existing) {
      existing.windowIds.add(windowId);
      return;
    }

    const watcher = watch(dirPath, {
      depth: 0,
      persistent: true,
      ignoreInitial: true,
      ignored: (candidate: string) =>
        candidate !== dirPath && DEFAULT_IGNORED_DIRS.has(path.basename(candidate)),
    });

    const entry: WatchedDirectory = { watcher, windowIds: new Set([windowId]), timer: null };
    const changed = (): void => this.scheduleNotify(dirPath, entry);
    watcher.on('add', changed);
    watcher.on('addDir', changed);
    watcher.on('unlink', changed);
    watcher.on('unlinkDir', changed);
    watcher.on('error', (error: unknown) => {
      console.error('Folder watcher error:', error);
    });

    await new Promise<void>((resolve, reject) => {
      watcher.once('ready', () => resolve());
      watcher.once('error', reject);
    });

    this.watched.set(dirPath, entry);
  }

  async unwatch(dirPath: string, windowId: number): Promise<void> {
    const entry = this.watched.get(dirPath);
    if (!entry) return;
    entry.windowIds.delete(windowId);
    if (entry.windowIds.size === 0) {
      await this.close(dirPath, entry);
    }
  }

  async unwatchAll(windowId: number): Promise<void> {
    for (const dirPath of [...this.watched.keys()]) {
      await this.unwatch(dirPath, windowId);
    }
    this.callbacks.delete(windowId);
  }

  isWatching(dirPath: string): boolean {
    return this.watched.has(dirPath);
  }

  onChange(windowId: number, callback: FolderChangeCallback): () => void {
    let set = this.callbacks.get(windowId);
    if (!set) {
      set = new Set();
      this.callbacks.set(windowId, set);
    }
    set.add(callback);
    return () => {
      set.delete(callback);
    };
  }

  async destroy(): Promise<void> {
    for (const [dirPath, entry] of this.watched) {
      await this.close(dirPath, entry);
    }
    this.callbacks.clear();
  }

  private scheduleNotify(dirPath: string, entry: WatchedDirectory): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      for (const windowId of entry.windowIds) {
        for (const callback of this.callbacks.get(windowId) ?? []) {
          try {
            callback(dirPath);
          } catch (error) {
            console.error('Error in folder change callback:', error);
          }
        }
      }
    }, FOLDER_CHANGE_DEBOUNCE_MS);
  }

  private async close(dirPath: string, entry: WatchedDirectory): Promise<void> {
    if (entry.timer) clearTimeout(entry.timer);
    this.watched.delete(dirPath);
    await entry.watcher.close();
  }
}

let instance: FolderWatcherService | null = null;

export function getFolderWatcherService(): FolderWatcherService {
  if (!instance) instance = new FolderWatcherService();
  return instance;
}
