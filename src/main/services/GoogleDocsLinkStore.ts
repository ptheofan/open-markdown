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
      this.links[filePath].lastSyncedAt = timestamp;
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

  /**
   * Fingerprint of the converted document as it stood at the last successful
   * sync. Lets an unchanged document be recognised before any API work.
   */
  async getModelFingerprint(docId: string): Promise<string | null> {
    const p = path.join(this.baselineDir, `${docId}.model`);
    try {
      return (await fs.readFile(p, 'utf-8')).trim();
    } catch {
      return null;
    }
  }

  async saveModelFingerprint(docId: string, fingerprint: string): Promise<void> {
    await fs.writeFile(path.join(this.baselineDir, `${docId}.model`), fingerprint, 'utf-8');
  }

  /**
   * Drive file ids for diagram images already uploaded for this document,
   * keyed by a hash of the image bytes. Re-uploading an identical diagram on
   * every sync is pure latency: the bytes are the same and Drive already has
   * them.
   */
  async loadImageCache(docId: string): Promise<Record<string, string>> {
    const cachePath = path.join(this.baselineDir, `${docId}.images.json`);
    try {
      return JSON.parse(await fs.readFile(cachePath, 'utf-8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async saveImageCache(docId: string, cache: Record<string, string>): Promise<void> {
    const cachePath = path.join(this.baselineDir, `${docId}.images.json`);
    await fs.writeFile(cachePath, JSON.stringify(cache), 'utf-8');
  }

  /**
   * The two markdown snapshots a merge needs: the file as it stood at the last
   * sync, and the Doc reverse-converted at that same moment.
   *
   * They are kept apart because they are different dialects of one document --
   * a mermaid fence locally is a PNG remotely. Diffing each side against its
   * own snapshot is what stops that gap from looking like an edit. See
   * ThreeWayMerge for the full reasoning.
   */
  async saveMarkdownSnapshots(docId: string, local: string, remote: string): Promise<void> {
    await Promise.all([
      fs.writeFile(path.join(this.baselineDir, `${docId}.local.md`), local, 'utf-8'),
      fs.writeFile(path.join(this.baselineDir, `${docId}.remote.md`), remote, 'utf-8'),
    ]);
  }

  async loadMarkdownSnapshots(
    docId: string,
  ): Promise<{ local: string; remote: string } | null> {
    try {
      const [local, remote] = await Promise.all([
        fs.readFile(path.join(this.baselineDir, `${docId}.local.md`), 'utf-8'),
        fs.readFile(path.join(this.baselineDir, `${docId}.remote.md`), 'utf-8'),
      ]);
      return { local, remote };
    } catch {
      // Either is missing: this link predates snapshotting, or was never
      // synced. A merge is impossible without both, so say so plainly.
      return null;
    }
  }

  async deleteBaseline(docId: string): Promise<void> {
    const stale = [
      `${docId}.baseline.txt`,
      `${docId}.images.json`,
      `${docId}.model`,
      `${docId}.local.md`,
      `${docId}.remote.md`,
    ];
    await Promise.all(stale.map(async (name) => {
      try {
        await fs.unlink(path.join(this.baselineDir, name));
      } catch {
        // ignore if not found
      }
    }));
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
