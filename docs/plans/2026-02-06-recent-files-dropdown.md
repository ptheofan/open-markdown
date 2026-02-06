# Recent Files Split-Button Dropdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a split-button dropdown to the Open button that shows the last 10 recently opened files for quick re-opening.

**Architecture:** The Open button becomes a split-button — main area opens file dialog (unchanged), chevron arrow toggles a recent files dropdown. Recent files are stored in a separate `recent-files.json` in userData (not preferences). All file-open paths converge on `loadFile()`, which records to recent files after success. OS integration via `app.addRecentDocument()`.

**Tech Stack:** Electron IPC, Vitest, TypeScript strict mode, existing dropdown/service/handler patterns.

---

### Task 1: RecentFileEntry Type

**Files:**
- Create: `src/shared/types/recentFiles.ts`
- Modify: `src/shared/types/index.ts`

**Step 1: Create the type file**

Create `src/shared/types/recentFiles.ts`:

```typescript
export interface RecentFileEntry {
  filePath: string;
  fileName: string;
  openedAt: string; // ISO 8601
}
```

**Step 2: Add re-export to index**

In `src/shared/types/index.ts`, add after the file association types block (after line ~97):

```typescript
// Recent files types
export type { RecentFileEntry } from './recentFiles';
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

**Step 4: Commit**

```bash
git add src/shared/types/recentFiles.ts src/shared/types/index.ts
git commit -m "feat(recent-files): add RecentFileEntry type"
```

---

### Task 2: IPC Channels & API Interface

**Files:**
- Modify: `src/shared/types/api.ts`

**Step 1: Add IPC channels**

In `src/shared/types/api.ts`, add the `RECENT_FILES` block inside `IPC_CHANNELS` (after the `FILE_ASSOCIATION` block, before `} as const`):

```typescript
  RECENT_FILES: {
    GET: 'recent-files:get',
    ADD: 'recent-files:add',
    REMOVE: 'recent-files:remove',
    CLEAR: 'recent-files:clear',
    ON_CHANGE: 'recent-files:on-change',
  },
```

**Step 2: Add to IpcChannel union type**

Add this line to the `IpcChannel` union (after the `FILE_ASSOCIATION` line):

```typescript
  | (typeof IPC_CHANNELS.RECENT_FILES)[keyof typeof IPC_CHANNELS.RECENT_FILES]
```

**Step 3: Add RecentFilesAPI interface**

Add the import at the top of `api.ts`:

```typescript
import type { RecentFileEntry } from './recentFiles';
```

Add the interface (after `FileAssociationAPI`):

```typescript
/**
 * Recent files API exposed to renderer
 */
export interface RecentFilesAPI {
  get: () => Promise<RecentFileEntry[]>;
  add: (filePath: string) => Promise<void>;
  remove: (filePath: string) => Promise<void>;
  clear: () => Promise<void>;
  onChange: (callback: (files: RecentFileEntry[]) => void) => () => void;
}
```

**Step 4: Add to ElectronAPI interface**

Add `recentFiles: RecentFilesAPI;` to the `ElectronAPI` interface (after `fileAssociation`).

**Step 5: Add to type exports in `src/shared/types/index.ts`**

Add `RecentFilesAPI` to the API types export block:

```typescript
export type {
  // ... existing exports ...
  RecentFilesAPI,
} from './api';
```

**Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL — `ElectronAPI` now requires `recentFiles` but preload doesn't provide it yet. This is expected; we'll fix it in Task 6.

**Step 7: Commit**

```bash
git add src/shared/types/api.ts src/shared/types/index.ts
git commit -m "feat(recent-files): add IPC channels and RecentFilesAPI interface"
```

---

### Task 3: RecentFilesService — Tests First

**Files:**
- Create: `tests/unit/main/services/RecentFilesService.test.ts`

**Step 1: Write the test file**

Create `tests/unit/main/services/RecentFilesService.test.ts`. Follow the `ThemeService.test.ts` pattern exactly (temp dir, mock electron, beforeEach/afterEach):

```typescript
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

      // Create new service instance and verify persistence
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
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/main/services/RecentFilesService.test.ts`
Expected: FAIL — module `@main/services/RecentFilesService` does not exist yet.

**Step 3: Commit**

```bash
git add tests/unit/main/services/RecentFilesService.test.ts
git commit -m "test(recent-files): add RecentFilesService unit tests"
```

---

### Task 4: RecentFilesService — Implementation

**Files:**
- Create: `src/main/services/RecentFilesService.ts`

**Step 1: Implement the service**

Create `src/main/services/RecentFilesService.ts`. Follow `PreferencesService.ts` pattern exactly (singleton + getter, disk persistence, change listeners):

```typescript
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
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- tests/unit/main/services/RecentFilesService.test.ts`
Expected: ALL PASS

**Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/main/services/RecentFilesService.ts
git commit -m "feat(recent-files): implement RecentFilesService"
```

---

### Task 5: RecentFilesHandler — Tests First

**Files:**
- Create: `tests/unit/main/ipc/handlers/RecentFilesHandler.test.ts`

**Step 1: Write the test file**

Follow `ThemeHandler.test.ts` pattern exactly:

```typescript
/**
 * RecentFilesHandler unit tests
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  registerRecentFilesHandlers,
  unregisterRecentFilesHandlers,
} from '@main/ipc/handlers/RecentFilesHandler';
import { IPC_CHANNELS } from '@shared/types/api';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { RecentFilesService } from '@main/services/RecentFilesService';
import type { RecentFileEntry } from '@shared/types';

interface MockRecentFilesService {
  getRecentFiles: ReturnType<typeof vi.fn>;
  addRecentFile: ReturnType<typeof vi.fn>;
  removeRecentFile: ReturnType<typeof vi.fn>;
  clearRecentFiles: ReturnType<typeof vi.fn>;
  onRecentFilesChange: ReturnType<typeof vi.fn>;
  _triggerChange: (files: RecentFileEntry[]) => void;
}

// Mock Electron modules
vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
      _getHandler: (channel: string) => handlers.get(channel),
      _clearHandlers: () => handlers.clear(),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    },
  };
});

function createMockService(): MockRecentFilesService {
  let changeCallback: ((files: RecentFileEntry[]) => void) | null = null;

  return {
    getRecentFiles: vi.fn(() => []),
    addRecentFile: vi.fn(() => Promise.resolve()),
    removeRecentFile: vi.fn(() => Promise.resolve()),
    clearRecentFiles: vi.fn(() => Promise.resolve()),
    onRecentFilesChange: vi.fn((callback: (files: RecentFileEntry[]) => void) => {
      changeCallback = callback;
      return () => { changeCallback = null; };
    }),
    _triggerChange: (files: RecentFileEntry[]) => {
      changeCallback?.(files);
    },
  };
}

type MockIpcMain = typeof ipcMain & {
  _getHandler: (channel: string) => ((...args: unknown[]) => unknown) | undefined;
  _clearHandlers: () => void;
};

const mockIpcMain = ipcMain as MockIpcMain;

describe('RecentFilesHandler', () => {
  let mockService: MockRecentFilesService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain._clearHandlers();
    mockService = createMockService();
  });

  describe('registerRecentFilesHandlers', () => {
    it('should register all IPC handlers', () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.GET,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.ADD,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.REMOVE,
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.CLEAR,
        expect.any(Function)
      );
    });

    it('should handle GET by returning recent files', () => {
      const mockFiles: RecentFileEntry[] = [
        { filePath: '/test/file.md', fileName: 'file.md', openedAt: '2026-01-01T00:00:00.000Z' },
      ];
      mockService.getRecentFiles.mockReturnValue(mockFiles);

      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.RECENT_FILES.GET);
      const result = handler?.();
      expect(result).toEqual(mockFiles);
    });

    it('should handle ADD by calling addRecentFile', async () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.RECENT_FILES.ADD);
      await handler?.({}, '/test/file.md');
      expect(mockService.addRecentFile).toHaveBeenCalledWith('/test/file.md');
    });

    it('should handle REMOVE by calling removeRecentFile', async () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.RECENT_FILES.REMOVE);
      await handler?.({}, '/test/file.md');
      expect(mockService.removeRecentFile).toHaveBeenCalledWith('/test/file.md');
    });

    it('should handle CLEAR by calling clearRecentFiles', async () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const handler = mockIpcMain._getHandler(IPC_CHANNELS.RECENT_FILES.CLEAR);
      await handler?.();
      expect(mockService.clearRecentFiles).toHaveBeenCalled();
    });

    it('should broadcast changes to all windows', () => {
      const mockWin = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
      };
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(
        [mockWin] as unknown as BrowserWindow[]
      );

      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);

      const mockFiles: RecentFileEntry[] = [
        { filePath: '/test/file.md', fileName: 'file.md', openedAt: '2026-01-01T00:00:00.000Z' },
      ];
      mockService._triggerChange(mockFiles);

      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.RECENT_FILES.ON_CHANGE,
        mockFiles
      );
    });

    it('should skip destroyed windows when broadcasting', () => {
      const destroyedWin = {
        isDestroyed: vi.fn(() => true),
        webContents: { send: vi.fn() },
      };
      const aliveWin = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() },
      };
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(
        [destroyedWin, aliveWin] as unknown as BrowserWindow[]
      );

      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);
      mockService._triggerChange([]);

      expect(destroyedWin.webContents.send).not.toHaveBeenCalled();
      expect(aliveWin.webContents.send).toHaveBeenCalled();
    });
  });

  describe('unregisterRecentFilesHandlers', () => {
    it('should remove all handlers', () => {
      registerRecentFilesHandlers(mockService as unknown as RecentFilesService);
      unregisterRecentFilesHandlers();

      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.RECENT_FILES.GET);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.RECENT_FILES.ADD);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.RECENT_FILES.REMOVE);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.RECENT_FILES.CLEAR);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/main/ipc/handlers/RecentFilesHandler.test.ts`
Expected: FAIL — module `@main/ipc/handlers/RecentFilesHandler` does not exist yet.

**Step 3: Commit**

```bash
git add tests/unit/main/ipc/handlers/RecentFilesHandler.test.ts
git commit -m "test(recent-files): add RecentFilesHandler unit tests"
```

---

### Task 6: RecentFilesHandler — Implementation

**Files:**
- Create: `src/main/ipc/handlers/RecentFilesHandler.ts`
- Modify: `src/main/ipc/handlers/index.ts`

**Step 1: Implement the handler**

Create `src/main/ipc/handlers/RecentFilesHandler.ts`. Follow `PreferencesHandler.ts` exactly:

```typescript
/**
 * RecentFilesHandler - IPC handlers for recent files operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import {
  getRecentFilesService,
  RecentFilesService,
} from '@main/services/RecentFilesService';
import { IPC_CHANNELS } from '@shared/types/api';

import type { RecentFileEntry } from '@shared/types';

let recentFilesChangeCleanup: (() => void) | null = null;

function sendRecentFilesChangeToAllWindows(files: RecentFileEntry[]): void {
  const windows = BrowserWindow.getAllWindows();

  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.RECENT_FILES.ON_CHANGE, files);
    }
  }
}

export function registerRecentFilesHandlers(
  recentFilesService?: RecentFilesService
): void {
  const service = recentFilesService ?? getRecentFilesService();

  ipcMain.handle(
    IPC_CHANNELS.RECENT_FILES.GET,
    (): RecentFileEntry[] => {
      return service.getRecentFiles();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RECENT_FILES.ADD,
    async (_event: Electron.IpcMainInvokeEvent, filePath: string): Promise<void> => {
      await service.addRecentFile(filePath);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RECENT_FILES.REMOVE,
    async (_event: Electron.IpcMainInvokeEvent, filePath: string): Promise<void> => {
      await service.removeRecentFile(filePath);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RECENT_FILES.CLEAR,
    async (): Promise<void> => {
      await service.clearRecentFiles();
    }
  );

  recentFilesChangeCleanup = service.onRecentFilesChange((files) => {
    sendRecentFilesChangeToAllWindows(files);
  });
}

export function unregisterRecentFilesHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.GET);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.ADD);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.REMOVE);
  ipcMain.removeHandler(IPC_CHANNELS.RECENT_FILES.CLEAR);

  if (recentFilesChangeCleanup) {
    recentFilesChangeCleanup();
    recentFilesChangeCleanup = null;
  }
}
```

**Step 2: Register in handlers index**

In `src/main/ipc/handlers/index.ts`:

Add import (after the `FileAssociationHandler` import):

```typescript
import {
  registerRecentFilesHandlers,
  unregisterRecentFilesHandlers,
} from './RecentFilesHandler';
```

Add to `registerAllHandlers()` (after `registerFileAssociationHandlers()`):

```typescript
  registerRecentFilesHandlers();
```

Add to `unregisterAllHandlers()` (after `unregisterFileAssociationHandlers()`):

```typescript
  unregisterRecentFilesHandlers();
```

Add re-export at the bottom:

```typescript
export {
  registerRecentFilesHandlers,
  unregisterRecentFilesHandlers,
} from './RecentFilesHandler';
```

**Step 3: Run handler tests**

Run: `npm test -- tests/unit/main/ipc/handlers/RecentFilesHandler.test.ts`
Expected: ALL PASS

**Step 4: Run all tests**

Run: `npm test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/main/ipc/handlers/RecentFilesHandler.ts src/main/ipc/handlers/index.ts
git commit -m "feat(recent-files): implement RecentFilesHandler and register"
```

---

### Task 7: Service Initialization + Preload Bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/preload.ts`

**Step 1: Initialize service in main process**

In `src/main/index.ts`, add import at the top (after `getPreferencesService` import):

```typescript
import { getRecentFilesService } from './services/RecentFilesService';
```

In the `initialize()` function, after `await getPreferencesService().initialize();` add:

```typescript
  await getRecentFilesService().initialize();
```

**Step 2: Add preload bridge**

In `src/preload/preload.ts`:

Add `RecentFileEntry` to the import from `@shared/types`:

```typescript
import type {
  // ... existing imports ...
  RecentFileEntry,
} from '@shared/types';
```

Add the `recentFiles` property to the `electronAPI` object (after `fileAssociation`, before the closing `};`):

```typescript
  recentFiles: {
    get: (): Promise<RecentFileEntry[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.RECENT_FILES.GET);
    },

    add: (filePath: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.RECENT_FILES.ADD, filePath);
    },

    remove: (filePath: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.RECENT_FILES.REMOVE, filePath);
    },

    clear: (): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.RECENT_FILES.CLEAR);
    },

    onChange: (callback: (files: RecentFileEntry[]) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: RecentFileEntry[]
      ): void => {
        callback(data);
      };

      ipcRenderer.on(IPC_CHANNELS.RECENT_FILES.ON_CHANGE, handler);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.RECENT_FILES.ON_CHANGE, handler);
      };
    },
  },
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — `ElectronAPI` now satisfied.

**Step 4: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/main/index.ts src/preload/preload.ts
git commit -m "feat(recent-files): initialize service and add preload bridge"
```

---

### Task 8: HTML Split-Button Markup

**Files:**
- Modify: `index.html`

**Step 1: Replace the Open button with split-button markup**

In `index.html`, replace lines 13-20 (the `<div class="toolbar-left">` block) with:

```html
        <div class="toolbar-left">
          <div id="open-file-dropdown" class="toolbar-dropdown open-split-btn">
            <button id="open-file-btn" class="toolbar-btn open-split-btn-main" title="Open File (Cmd+O)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z"/>
              </svg>
              <span>Open</span>
            </button>
            <button id="open-recent-btn" class="toolbar-btn open-split-btn-arrow" title="Recent files">
              <svg class="dropdown-chevron" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
              </svg>
            </button>
            <div class="dropdown-menu hidden">
              <div class="dropdown-empty hidden">No recent files</div>
            </div>
          </div>
        </div>
```

Note: `#open-file-btn` keeps its ID so Toolbar.ts binds it unchanged — zero changes to Toolbar.ts.

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat(recent-files): add split-button HTML markup"
```

---

### Task 9: CSS Styles

**Files:**
- Modify: `src/index.css`

**Step 1: Add split-button and recent files styles**

In `src/index.css`, add the following after the existing `.dropdown-item + .dropdown-item` rule (after line ~1156, before the `/* Spinner */` comment):

```css
/* ===========================================
   Open Split Button
   =========================================== */

.open-split-btn {
  display: inline-flex;
}

.open-split-btn-main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}

.open-split-btn-arrow {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding: 6px 6px;
}

.open-split-btn-arrow .dropdown-chevron {
  opacity: 0.6;
  transition: transform 0.15s ease;
}

.open-split-btn.is-open .open-split-btn-arrow .dropdown-chevron {
  transform: rotate(180deg);
}

.open-split-btn .dropdown-menu {
  left: 0;
  right: auto;
  min-width: 280px;
}

/* Recent file item - two-line layout */
.dropdown-item-recent {
  display: block;
  width: 100%;
  padding: 8px 14px;
  background: transparent;
  border: none;
  border-top: 1px solid var(--border-color);
  color: var(--text-color);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s;
}

.dropdown-item-recent:first-child {
  border-top: none;
}

.dropdown-item-recent:hover {
  background-color: var(--hover-bg);
}

.dropdown-item-recent:active {
  background-color: var(--active-bg);
}

.recent-file-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-file-path {
  display: block;
  font-size: 11px;
  line-height: 1.3;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

/* Empty state */
.dropdown-empty {
  padding: 16px 14px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* Footer with clear action */
.dropdown-footer {
  border-top: 1px solid var(--border-color);
}

.dropdown-footer-btn {
  display: block;
  width: 100%;
  padding: 8px 14px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.dropdown-footer-btn:hover {
  background-color: var(--hover-bg);
  color: var(--text-color);
}
```

**Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(recent-files): add split-button and dropdown styles"
```

---

### Task 10: RecentFilesDropdown Component

**Files:**
- Create: `src/renderer/components/RecentFilesDropdown.ts`
- Modify: `src/renderer/components/index.ts`

**Step 1: Implement the component**

Create `src/renderer/components/RecentFilesDropdown.ts`. Follow `CopyDropdown.ts` pattern exactly:

```typescript
/**
 * RecentFilesDropdown - Dropdown for recently opened files
 *
 * Manages the chevron arrow button and dropdown menu within
 * the open-file split-button container.
 */
import type { RecentFileEntry } from '@shared/types';

export interface RecentFilesDropdownCallbacks {
  onSelectRecentFile: (filePath: string) => void;
  onClearRecentFiles: () => void;
}

export class RecentFilesDropdown {
  private container: HTMLElement;
  private arrowButton: HTMLButtonElement | null = null;
  private menu: HTMLElement | null = null;
  private emptyState: HTMLElement | null = null;
  private callbacks: RecentFilesDropdownCallbacks | null = null;
  private isOpen = false;

  private boundHandleOutsideClick: (e: MouseEvent) => void;
  private boundHandleKeydown: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
    this.boundHandleKeydown = this.handleKeydown.bind(this);
    this.cacheElements();
    this.setupEventListeners();
  }

  private cacheElements(): void {
    this.arrowButton = this.container.querySelector('#open-recent-btn');
    this.menu = this.container.querySelector('.dropdown-menu');
    this.emptyState = this.container.querySelector('.dropdown-empty');
  }

  private setupEventListeners(): void {
    this.arrowButton?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    this.menu?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const recentItem = target.closest('[data-recent-path]');
      if (recentItem instanceof HTMLElement) {
        const filePath = recentItem.getAttribute('data-recent-path');
        if (filePath) {
          this.closeMenu();
          this.callbacks?.onSelectRecentFile(filePath);
        }
        return;
      }

      const clearBtn = target.closest('.dropdown-footer-btn');
      if (clearBtn) {
        this.closeMenu();
        this.callbacks?.onClearRecentFiles();
      }
    });
  }

  setCallbacks(callbacks: RecentFilesDropdownCallbacks): void {
    this.callbacks = callbacks;
  }

  updateRecentFiles(files: RecentFileEntry[]): void {
    if (!this.menu || !this.emptyState) return;

    // Remove existing items and footer
    const existingItems = this.menu.querySelectorAll('.dropdown-item-recent, .dropdown-footer');
    existingItems.forEach((el) => el.remove());

    if (files.length === 0) {
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');

    // Add file items
    for (const file of files) {
      const button = document.createElement('button');
      button.className = 'dropdown-item-recent';
      button.setAttribute('data-recent-path', file.filePath);
      button.title = file.filePath;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'recent-file-name';
      nameSpan.textContent = file.fileName;

      const dirPath = file.filePath.substring(0, file.filePath.length - file.fileName.length - 1);
      const pathSpan = document.createElement('span');
      pathSpan.className = 'recent-file-path';
      pathSpan.textContent = dirPath;

      button.appendChild(nameSpan);
      button.appendChild(pathSpan);
      this.menu.appendChild(button);
    }

    // Add clear footer
    const footer = document.createElement('div');
    footer.className = 'dropdown-footer';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'dropdown-footer-btn';
    clearBtn.textContent = 'Clear Recent Files';

    footer.appendChild(clearBtn);
    this.menu.appendChild(footer);
  }

  private toggleMenu(): void {
    if (this.isOpen) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  }

  private openMenu(): void {
    this.isOpen = true;
    this.menu?.classList.remove('hidden');
    this.container.classList.add('is-open');

    document.addEventListener('click', this.boundHandleOutsideClick);
    document.addEventListener('keydown', this.boundHandleKeydown);
  }

  private closeMenu(): void {
    this.isOpen = false;
    this.menu?.classList.add('hidden');
    this.container.classList.remove('is-open');

    document.removeEventListener('click', this.boundHandleOutsideClick);
    document.removeEventListener('keydown', this.boundHandleKeydown);
  }

  private handleOutsideClick(e: MouseEvent): void {
    if (!this.container.contains(e.target as Node)) {
      this.closeMenu();
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.closeMenu();
      this.arrowButton?.focus();
    }
  }

  destroy(): void {
    document.removeEventListener('click', this.boundHandleOutsideClick);
    document.removeEventListener('keydown', this.boundHandleKeydown);
  }
}

export function createRecentFilesDropdown(container: HTMLElement): RecentFilesDropdown {
  return new RecentFilesDropdown(container);
}
```

**Step 2: Add exports to component index**

In `src/renderer/components/index.ts`, add at the end (after the FindBar export block):

```typescript
// RecentFilesDropdown
export {
  RecentFilesDropdown,
  createRecentFilesDropdown,
  type RecentFilesDropdownCallbacks,
} from './RecentFilesDropdown';
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/components/RecentFilesDropdown.ts src/renderer/components/index.ts
git commit -m "feat(recent-files): implement RecentFilesDropdown component"
```

---

### Task 11: Renderer Wiring

**Files:**
- Modify: `src/renderer.ts`

**Step 1: Add imports**

At the top of `src/renderer.ts`, add `createRecentFilesDropdown` and `RecentFilesDropdown` to the component imports (line 7-27):

```typescript
  createRecentFilesDropdown,
  type RecentFilesDropdown,
```

Add `RecentFileEntry` to the `@shared/types` import (line 38-47):

```typescript
  type RecentFileEntry,
```

**Step 2: Add field to App class**

After `private findService: FindService | null = null;` (line 77), add:

```typescript
  private recentFilesDropdown: RecentFilesDropdown | null = null;
```

**Step 3: Wire up in initializeComponents**

After the copy dropdown block (after line ~174, after the `if (copyDropdownElement)` block's closing `}`), add:

```typescript
    // Create recent files dropdown
    const recentFilesElement = document.getElementById('open-file-dropdown');
    if (recentFilesElement) {
      this.recentFilesDropdown = createRecentFilesDropdown(recentFilesElement);
      this.recentFilesDropdown.setCallbacks({
        onSelectRecentFile: (filePath: string) => {
          void this.loadFile(filePath);
        },
        onClearRecentFiles: () => {
          void window.electronAPI.recentFiles.clear();
        },
      });
    }
```

**Step 4: Fetch initial recent files**

In the `initialize()` method (line 92-104), after `this.setupEventListeners();` (line 98) and before `this.showWelcomeScreen();` (line 99), add:

```typescript
      await this.initializeRecentFiles();
```

Add the new method (after `initializeFullscreenState`, around line 117):

```typescript
  /**
   * Initialize recent files dropdown with stored data
   */
  private async initializeRecentFiles(): Promise<void> {
    try {
      const files = await window.electronAPI.recentFiles.get();
      this.recentFilesDropdown?.updateRecentFiles(files);
    } catch (error) {
      console.error('Failed to load recent files:', error);
    }
  }
```

**Step 5: Subscribe to changes in setupEventListeners**

In `setupEventListeners()` (around line 315-373), add before the closing `}` of the method (before the Find shortcut block):

```typescript
    // Recent files change listener (cross-window sync)
    const cleanupRecentFiles = window.electronAPI.recentFiles.onChange(
      (files: RecentFileEntry[]) => {
        this.recentFilesDropdown?.updateRecentFiles(files);
      }
    );
    this.cleanupFunctions.push(cleanupRecentFiles);
```

**Step 6: Track recent file in loadFile**

In the `loadFile()` method (line 445-484), after `await this.startWatching(filePath);` (line 479) and before the `} catch` (line 480), add:

```typescript
      // Track in recent files (non-fatal)
      try {
        await window.electronAPI.recentFiles.add(filePath);
      } catch {
        // Non-fatal: don't break file loading if recent files tracking fails
      }
```

In the same `loadFile()` method's catch block (line 480-483), after the `this.showError(...)` line, add:

```typescript
      // Remove stale entry if file can't be read
      try {
        await window.electronAPI.recentFiles.remove(filePath);
      } catch {
        // Non-fatal
      }
```

**Step 7: Add to destroy()**

In `destroy()` (line 749-760), add after `this.findBar?.destroy();`:

```typescript
    this.recentFilesDropdown?.destroy();
```

**Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 9: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 10: Run all tests**

Run: `npm test`
Expected: ALL PASS

**Step 11: Commit**

```bash
git add src/renderer.ts
git commit -m "feat(recent-files): wire up dropdown in renderer"
```

---

### Task 12: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

**Step 3: Run lint**

Run: `npm run lint`
Expected: PASS (no errors)

**Step 4: Manual testing checklist**

Run the app: `npm start`

- [ ] Open a file via dialog -> appears in recent files dropdown
- [ ] Open a file via drag-and-drop -> appears in recent files dropdown
- [ ] Click chevron arrow -> dropdown shows recent files with filename + path
- [ ] Click a recent file -> opens it, moves to top of list
- [ ] Open 11+ files -> only last 10 shown
- [ ] Click "Clear Recent Files" -> list empties, shows "No recent files"
- [ ] Cmd+O still works (keyboard shortcut unchanged)
- [ ] Clicking main "Open" button area still opens dialog
- [ ] Restart app -> recent files persist
- [ ] Escape key closes dropdown
- [ ] Click outside closes dropdown
