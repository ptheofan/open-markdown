/**
 * RecentFilesService - Manages recently opened files
 *
 * Stores recent file entries in a separate JSON file (not preferences).
 * Integrates with OS recent documents (macOS dock, Windows taskbar).
 */
import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';

import type { RecentFileEntry } from '@shared/types';

const MAX_RECENT_FILES = 10;
const RECENT_FILES_FILENAME = 'recent-files.json';

interface RecentFilesData {
  version: number;
  files: RecentFileEntry[];
}

export class RecentFilesService {
  private dataPath: string;
  private files: RecentFileEntry[] = [];
  private initialized = false;
  private changeListeners: Set<(files: RecentFileEntry[]) => void> = new Set();

  constructor(dataDir?: string) {
    const dir = dataDir ?? app.getPath('userData');
    this.dataPath = path.join(dir, RECENT_FILES_FILENAME);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.load();
    } catch {
      this.files = [];
    }

    this.initialized = true;
  }

  getRecentFiles(): RecentFileEntry[] {
    return structuredClone(this.files);
  }

  async addRecentFile(filePath: string): Promise<void> {
    // Remove existing entry (dedup)
    this.files = this.files.filter((f) => f.filePath !== filePath);

    // Prepend new entry
    const fileName = path.basename(filePath);
    this.files.unshift({
      filePath,
      fileName,
      openedAt: new Date().toISOString(),
    });

    // Trim to max
    if (this.files.length > MAX_RECENT_FILES) {
      this.files = this.files.slice(0, MAX_RECENT_FILES);
    }

    // OS integration
    app.addRecentDocument(filePath);

    await this.save();
    this.notifyListeners();
  }

  async removeRecentFile(filePath: string): Promise<void> {
    const before = this.files.length;
    this.files = this.files.filter((f) => f.filePath !== filePath);

    if (this.files.length !== before) {
      await this.save();
      this.notifyListeners();
    }
  }

  async clearRecentFiles(): Promise<void> {
    this.files = [];
    app.clearRecentDocuments();
    await this.save();
    this.notifyListeners();
  }

  onRecentFilesChange(callback: (files: RecentFileEntry[]) => void): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  getDataPath(): string {
    return this.dataPath;
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.dataPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;

      if (this.isValidData(parsed)) {
        this.files = parsed.files;
      } else {
        this.files = [];
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to load recent files:', error);
      }
      this.files = [];
    }
  }

  private async save(): Promise<void> {
    try {
      const dir = path.dirname(this.dataPath);
      await fs.mkdir(dir, { recursive: true });

      const data: RecentFilesData = {
        version: 1,
        files: this.files,
      };

      await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save recent files:', error);
      throw error;
    }
  }

  private notifyListeners(): void {
    const filesCopy = this.getRecentFiles();
    for (const listener of this.changeListeners) {
      try {
        listener(filesCopy);
      } catch (error) {
        console.error('Error in recent files change listener:', error);
      }
    }
  }

  private isValidData(value: unknown): value is RecentFilesData {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    if (typeof obj['version'] !== 'number') return false;
    if (!Array.isArray(obj['files'])) return false;
    return true;
  }
}

// Singleton
let instance: RecentFilesService | null = null;

export function getRecentFilesService(): RecentFilesService {
  if (!instance) {
    instance = new RecentFilesService();
  }
  return instance;
}

export function createRecentFilesService(dataDir?: string): RecentFilesService {
  return new RecentFilesService(dataDir);
}

export function resetRecentFilesService(): void {
  instance = null;
}
