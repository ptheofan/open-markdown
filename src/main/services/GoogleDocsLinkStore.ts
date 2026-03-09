/**
 * GoogleDocsLinkStore - Manages file-to-Google-Doc mappings and baseline snapshots
 *
 * Stores a JSON file mapping local file paths to doc IDs and last sync timestamps,
 * plus baseline text files used for three-way diffing during sync.
 */
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import type { GoogleDocLink } from '@shared/types/google-docs';

interface LinksData {
  [filePath: string]: GoogleDocLink;
}

export class GoogleDocsLinkStore {
  private linksPath: string;
  private baselineDir: string;
  private links: LinksData = {};
  private initialized = false;

  constructor(dataDir?: string) {
    const dir = dataDir ?? app.getPath('userData');
    this.linksPath = path.join(dir, 'google-docs-links.json');
    this.baselineDir = path.join(dir, 'google-docs-sync');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.linksPath), { recursive: true });
    await fs.mkdir(this.baselineDir, { recursive: true });
    try {
      const data = await fs.readFile(this.linksPath, 'utf-8');
      this.links = JSON.parse(data) as LinksData;
    } catch {
      this.links = {};
    }
    this.initialized = true;
  }

  getLink(filePath: string): GoogleDocLink | null {
    return this.links[filePath] ?? null;
  }

  async setLink(filePath: string, docId: string): Promise<void> {
    this.links[filePath] = { docId, lastSyncedAt: null };
    await this.save();
  }

  async removeLink(filePath: string): Promise<void> {
    const link = this.links[filePath];
    if (link) {
      await this.deleteBaseline(link.docId);
    }
    delete this.links[filePath];
    await this.save();
  }

  async updateLastSynced(filePath: string, timestamp: string): Promise<void> {
    if (this.links[filePath]) {
      this.links[filePath]!.lastSyncedAt = timestamp;
      await this.save();
    }
  }

  async saveBaseline(docId: string, content: string): Promise<void> {
    const baselinePath = path.join(this.baselineDir, `${docId}.baseline.txt`);
    await fs.writeFile(baselinePath, content, 'utf-8');
  }

  async loadBaseline(docId: string): Promise<string | null> {
    const baselinePath = path.join(this.baselineDir, `${docId}.baseline.txt`);
    try {
      return await fs.readFile(baselinePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async deleteBaseline(docId: string): Promise<void> {
    const baselinePath = path.join(this.baselineDir, `${docId}.baseline.txt`);
    try {
      await fs.unlink(baselinePath);
    } catch {
      // ignore if not found
    }
  }

  private async save(): Promise<void> {
    await fs.writeFile(this.linksPath, JSON.stringify(this.links, null, 2), 'utf-8');
  }
}

// Singleton
let instance: GoogleDocsLinkStore | null = null;

export function getGoogleDocsLinkStore(): GoogleDocsLinkStore {
  if (!instance) {
    instance = new GoogleDocsLinkStore();
  }
  return instance;
}

export function createGoogleDocsLinkStore(dataDir?: string): GoogleDocsLinkStore {
  return new GoogleDocsLinkStore(dataDir);
}

export function resetGoogleDocsLinkStore(): void {
  instance = null;
}
