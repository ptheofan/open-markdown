/**
 * SecurityBookmarkService - Keeps the macOS sandbox's file access across launches
 *
 * In the Mac App Store build the app may only read what the user picked in an
 * open dialog, and only until it quits. A dialog asked for security-scoped
 * bookmarks returns one per pick; stored here and handed back to macOS at the
 * next launch, they restore that access. Picking a folder covers everything
 * inside it, so a remembered folder brings back its documents and images too.
 *
 * Outside the Mac App Store build there is no sandbox and this does nothing.
 */
import { app, dialog, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const BOOKMARKS_FILENAME = 'security-bookmarks.json';
/** Oldest picks are forgotten past this many */
const MAX_BOOKMARKS = 200;

interface BookmarksData {
  version: number;
  bookmarks: Record<string, string>;
}

export interface SecurityBookmarkDeps {
  /** Whether the sandbox is in force; defaults to the Mac App Store build */
  enabled?: boolean;
  dataDir?: string;
  startAccess?: (bookmark: string) => void;
}

export class SecurityBookmarkService {
  private readonly enabled: boolean;
  private readonly dataDir: string | undefined;
  private readonly startAccess: (bookmark: string) => void;
  /** Path to bookmark, oldest first */
  private bookmarks = new Map<string, string>();

  constructor(deps: SecurityBookmarkDeps = {}) {
    this.enabled = deps.enabled ?? Boolean(process.mas);
    this.dataDir = deps.dataDir;
    this.startAccess =
      deps.startAccess ??
      ((bookmark) => {
        app.startAccessingSecurityScopedResource(bookmark);
      });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Load the stored bookmarks and get back access to everything they cover */
  async initialize(): Promise<void> {
    if (!this.enabled) return;
    try {
      const raw = await fs.readFile(this.dataPath(), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<BookmarksData>;
      if (parsed && typeof parsed.bookmarks === 'object' && parsed.bookmarks) {
        for (const [filePath, bookmark] of Object.entries(parsed.bookmarks)) {
          if (typeof bookmark === 'string') this.bookmarks.set(filePath, bookmark);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to load security bookmarks:', error);
      }
    }

    for (const bookmark of this.bookmarks.values()) {
      try {
        this.startAccess(bookmark);
      } catch (error) {
        console.warn('Failed to restore access from a bookmark:', error);
      }
    }
  }

  /** Whether a stored pick covers this path (the path itself or a folder above it) */
  covers(target: string): boolean {
    for (const picked of this.bookmarks.keys()) {
      const relative = path.relative(picked, target);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) return true;
    }
    return false;
  }

  /** Remember the bookmarks a dialog returned for the paths it returned */
  async remember(paths: string[], bookmarks: string[] | undefined): Promise<void> {
    if (!this.enabled || !bookmarks) return;
    let changed = false;
    paths.forEach((picked, i) => {
      const bookmark = bookmarks[i];
      if (!bookmark) return;
      this.bookmarks.delete(picked);
      this.bookmarks.set(picked, bookmark);
      changed = true;
    });
    if (!changed) return;

    while (this.bookmarks.size > MAX_BOOKMARKS) {
      const oldest = this.bookmarks.keys().next().value;
      if (oldest === undefined) break;
      this.bookmarks.delete(oldest);
    }
    await this.save();
  }

  /**
   * Show an open dialog and keep the access its picks grant beyond this
   * launch. Use in place of dialog.showOpenDialog wherever the user picks
   * something the app should be able to open again later.
   */
  async showOpenDialog(
    parentWindow: BrowserWindow | undefined,
    options: Electron.OpenDialogOptions
  ): Promise<Electron.OpenDialogReturnValue> {
    const withBookmarks: Electron.OpenDialogOptions = this.enabled
      ? { ...options, securityScopedBookmarks: true }
      : options;
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, withBookmarks)
      : await dialog.showOpenDialog(withBookmarks);
    if (!result.canceled) {
      try {
        await this.remember(result.filePaths, result.bookmarks);
      } catch (error) {
        console.warn('Failed to store security bookmarks:', error);
      }
    }
    return result;
  }

  private dataPath(): string {
    return path.join(this.dataDir ?? app.getPath('userData'), BOOKMARKS_FILENAME);
  }

  private async save(): Promise<void> {
    const data: BookmarksData = {
      version: 1,
      bookmarks: Object.fromEntries(this.bookmarks),
    };
    await fs.mkdir(path.dirname(this.dataPath()), { recursive: true });
    await fs.writeFile(this.dataPath(), JSON.stringify(data, null, 2), 'utf-8');
  }
}

let instance: SecurityBookmarkService | null = null;

export function getSecurityBookmarkService(): SecurityBookmarkService {
  if (!instance) {
    instance = new SecurityBookmarkService();
  }
  return instance;
}

export function resetSecurityBookmarkService(): void {
  instance = null;
}
