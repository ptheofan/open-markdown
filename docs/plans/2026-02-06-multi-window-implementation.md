# Multi-Window Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-window singleton architecture with a WindowManager that supports multiple simultaneous windows, each displaying a different markdown file.

**Architecture:** WindowManager replaces MainWindow singleton, FileWatcherService gains multi-file reference-counted watching, IPC handlers remain global but use event.sender to route to correct window, renderer is unchanged (each window gets its own App instance).

**Tech Stack:** Electron BrowserWindow, chokidar, vitest, TypeScript strict mode.

---

## Task 1: Create WindowManager with Tests

**Files:**
- Create: `src/main/window/WindowManager.ts`
- Create: `tests/unit/main/window/WindowManager.test.ts`

### Step 1: Write the failing test

Create `tests/unit/main/window/WindowManager.test.ts`:

```typescript
/**
 * WindowManager unit tests
 */
import { BrowserWindow } from 'electron';
import { WindowManager } from '@main/window/WindowManager';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron
vi.mock('electron', () => {
  let nextId = 1;
  return {
    BrowserWindow: vi.fn().mockImplementation(() => {
      const id = nextId++;
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        id,
        webContents: {
          send: vi.fn(),
          once: vi.fn(),
        },
        loadURL: vi.fn().mockResolvedValue(undefined),
        loadFile: vi.fn().mockResolvedValue(undefined),
        once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(cb);
        }),
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(cb);
        }),
        show: vi.fn(),
        isDestroyed: vi.fn(() => false),
        isMinimized: vi.fn(() => false),
        isFullScreen: vi.fn(() => false),
        restore: vi.fn(),
        focus: vi.fn(),
        setTitle: vi.fn(),
        _handlers: handlers,
        _simulateEvent: (event: string, ...args: unknown[]) => {
          handlers[event]?.forEach(cb => cb(...args));
        },
      };
    }),
    app: {
      isPackaged: false,
    },
  };
});

describe('WindowManager', () => {
  let manager: WindowManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WindowManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('createWindow', () => {
    it('should create a new BrowserWindow', () => {
      const win = manager.createWindow();
      expect(win).toBeDefined();
      expect(BrowserWindow).toHaveBeenCalled();
    });

    it('should track created window by id', () => {
      const win = manager.createWindow();
      expect(manager.getWindow(win.id)).toBe(win);
    });

    it('should support multiple windows', () => {
      const win1 = manager.createWindow();
      const win2 = manager.createWindow();
      expect(win1.id).not.toBe(win2.id);
      expect(manager.getAllWindows()).toHaveLength(2);
    });

    it('should remove window from tracking on close', () => {
      const win = manager.createWindow();
      const id = win.id;

      // Simulate window close
      (win as unknown as { _simulateEvent: (event: string) => void })._simulateEvent('closed');

      expect(manager.getWindow(id)).toBeUndefined();
    });
  });

  describe('getWindow', () => {
    it('should return undefined for unknown id', () => {
      expect(manager.getWindow(999)).toBeUndefined();
    });
  });

  describe('getAllWindows', () => {
    it('should return empty array when no windows', () => {
      expect(manager.getAllWindows()).toEqual([]);
    });

    it('should return all tracked windows', () => {
      manager.createWindow();
      manager.createWindow();
      expect(manager.getAllWindows()).toHaveLength(2);
    });
  });

  describe('getWindowByFilePath', () => {
    it('should return undefined when no window has the file', () => {
      manager.createWindow();
      expect(manager.getWindowByFilePath('/some/file.md')).toBeUndefined();
    });

    it('should return window with matching file path', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/test/file.md');
      expect(manager.getWindowByFilePath('/test/file.md')).toBe(win);
    });
  });

  describe('setWindowFilePath', () => {
    it('should associate a file path with a window', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/test/file.md');
      expect(manager.getWindowFilePath(win.id)).toBe('/test/file.md');
    });

    it('should clear association when set to null', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/test/file.md');
      manager.setWindowFilePath(win.id, null);
      expect(manager.getWindowFilePath(win.id)).toBeNull();
    });
  });

  describe('getEmptyWindow', () => {
    it('should return a window with no file loaded', () => {
      const win = manager.createWindow();
      expect(manager.getEmptyWindow()).toBe(win);
    });

    it('should return undefined when all windows have files', () => {
      const win = manager.createWindow();
      manager.setWindowFilePath(win.id, '/test/file.md');
      expect(manager.getEmptyWindow()).toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('should clear all tracked windows', () => {
      manager.createWindow();
      manager.createWindow();
      manager.destroy();
      expect(manager.getAllWindows()).toEqual([]);
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm vitest run tests/unit/main/window/WindowManager.test.ts`
Expected: FAIL - cannot find module `@main/window/WindowManager`

### Step 3: Write minimal implementation

Create `src/main/window/WindowManager.ts`:

```typescript
/**
 * WindowManager - Manages multiple application windows
 */
import { BrowserWindow } from 'electron';
import path from 'node:path';

import { DEFAULT_WINDOW } from '@shared/constants';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export class WindowManager {
  private windows: Map<number, BrowserWindow> = new Map();
  private windowFilePaths: Map<number, string | null> = new Map();

  createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: DEFAULT_WINDOW.WIDTH,
      height: DEFAULT_WINDOW.HEIGHT,
      minWidth: DEFAULT_WINDOW.MIN_WIDTH,
      minHeight: DEFAULT_WINDOW.MIN_HEIGHT,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 15, y: 15 },
      vibrancy: 'sidebar',
      show: false,
    });

    this.windows.set(win.id, win);
    this.windowFilePaths.set(win.id, null);

    win.once('ready-to-show', () => {
      win.show();
    });

    this.loadContent(win);

    win.on('closed', () => {
      this.windows.delete(win.id);
      this.windowFilePaths.delete(win.id);
    });

    return win;
  }

  getWindow(id: number): BrowserWindow | undefined {
    return this.windows.get(id);
  }

  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values());
  }

  getWindowByFilePath(filePath: string): BrowserWindow | undefined {
    for (const [id, path] of this.windowFilePaths) {
      if (path === filePath) {
        return this.windows.get(id);
      }
    }
    return undefined;
  }

  setWindowFilePath(windowId: number, filePath: string | null): void {
    this.windowFilePaths.set(windowId, filePath);
  }

  getWindowFilePath(windowId: number): string | null {
    return this.windowFilePaths.get(windowId) ?? null;
  }

  getEmptyWindow(): BrowserWindow | undefined {
    for (const [id, filePath] of this.windowFilePaths) {
      if (filePath === null) {
        return this.windows.get(id);
      }
    }
    return undefined;
  }

  destroy(): void {
    this.windows.clear();
    this.windowFilePaths.clear();
  }

  private loadContent(win: BrowserWindow): void {
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      void win.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
      );
    }
  }
}

let windowManagerInstance: WindowManager | null = null;

export function getWindowManager(): WindowManager {
  if (!windowManagerInstance) {
    windowManagerInstance = new WindowManager();
  }
  return windowManagerInstance;
}
```

### Step 4: Run test to verify it passes

Run: `pnpm vitest run tests/unit/main/window/WindowManager.test.ts`
Expected: PASS (all tests)

### Step 5: Commit

```bash
git add src/main/window/WindowManager.ts tests/unit/main/window/WindowManager.test.ts
git commit -m "feat(multi-window): add WindowManager with tests"
```

---

## Task 2: Replace MainWindow Singleton with WindowManager

**Files:**
- Modify: `src/main/index.ts`
- Delete: `src/main/window/MainWindow.ts`

### Step 1: Update main/index.ts to use WindowManager

Replace all `getMainWindow()` usage with `getWindowManager()`. Key changes:

- Import `getWindowManager` instead of `getMainWindow`
- `createWindow()` calls `windowManager.createWindow()` and returns the `BrowserWindow`
- `app.on('open-file')` sends to the correct window or creates a new one
- `app.on('activate')` creates a window only when zero windows exist
- Move fullscreen event wiring into WindowManager or keep inline per window
- Remove the `pendingFilePath` / `rendererReady` pattern in favor of per-window tracking

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

import { registerAllHandlers } from './ipc/handlers';
import { getThemeService } from './services/ThemeService';
import { getPreferencesService } from './services/PreferencesService';
import { getRecentFilesService } from './services/RecentFilesService';
import { getWindowManager } from './window/WindowManager';
import { getFileService } from './services/FileService';
import { IPC_CHANNELS } from '@shared/types';
import { MARKDOWN_EXTENSIONS } from '@shared/constants';

interface PendingWindow {
  filePath: string | null;
  ready: boolean;
}

const pendingWindows: Map<number, PendingWindow> = new Map();

function checkCommandLineArgs(): string | null {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const filePath = args.find((arg) => {
    if (arg.startsWith('-')) return false;
    const ext = path.extname(arg).toLowerCase();
    return (MARKDOWN_EXTENSIONS as readonly string[]).includes(ext);
  });

  if (filePath) {
    return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  }
  return null;
}

function sendPendingFile(windowId: number): void {
  const pending = pendingWindows.get(windowId);
  const windowManager = getWindowManager();
  const win = windowManager.getWindow(windowId);

  if (pending?.filePath && win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN, {
      filePath: pending.filePath,
    });
    pending.filePath = null;
  }
}

function createWindow(filePath?: string): BrowserWindow {
  const windowManager = getWindowManager();
  const win = windowManager.createWindow();

  pendingWindows.set(win.id, { filePath: filePath ?? null, ready: false });

  if (process.env['NODE_ENV'] !== 'production') {
    win.webContents.openDevTools();
  }

  win.webContents.once('did-finish-load', () => {
    const pending = pendingWindows.get(win.id);
    if (pending) {
      pending.ready = true;
      sendPendingFile(win.id);
    }
  });

  win.on('closed', () => {
    pendingWindows.delete(win.id);
  });

  return win;
}

async function initialize(): Promise<void> {
  const pendingFilePath = checkCommandLineArgs();

  await getThemeService().initialize();
  await getPreferencesService().initialize();
  await getRecentFilesService().initialize();

  registerAllHandlers();

  createWindow(pendingFilePath ?? undefined);
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();

  const ext = path.extname(filePath).toLowerCase();
  const fileService = getFileService();
  if (!fileService.isMarkdownFile(ext)) return;

  const windowManager = getWindowManager();

  // Check if already open
  const existingWindow = windowManager.getWindowByFilePath(filePath);
  if (existingWindow && !existingWindow.isDestroyed()) {
    if (existingWindow.isMinimized()) existingWindow.restore();
    existingWindow.focus();
    return;
  }

  // Check if there's an empty window
  const emptyWindow = windowManager.getEmptyWindow();
  if (emptyWindow && !emptyWindow.isDestroyed()) {
    const pending = pendingWindows.get(emptyWindow.id);
    if (pending?.ready) {
      emptyWindow.webContents.send(IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN, { filePath });
    } else if (pending) {
      pending.filePath = filePath;
    }
    if (emptyWindow.isMinimized()) emptyWindow.restore();
    emptyWindow.focus();
    return;
  }

  // Create new window
  if (app.isReady()) {
    createWindow(filePath);
  } else {
    // App not ready yet -- the initial window will pick this up
    // Store for later (handled by initialize)
  }
});

app.whenReady()
  .then(() => {
    void initialize();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize app:', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
```

### Step 2: Move fullscreen IPC handler to global registration

The `GET_FULLSCREEN` handler is currently registered inside `MainWindow.create()`. It needs to move to a new `WindowHandler.ts` or into the existing handler registration. Create `src/main/ipc/handlers/WindowHandler.ts`:

```typescript
/**
 * IPC handlers for window operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../channels';
import { getWindowManager } from '../../window/WindowManager';

export function registerWindowHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WINDOW.GET_FULLSCREEN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isFullScreen() ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW.OPEN_NEW, (_event, filePath?: string) => {
    const windowManager = getWindowManager();
    windowManager.createWindow();
    // File loading is handled by the renderer once it initializes
    // For now, return the window ID for potential future use
  });
}

export function unregisterWindowHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.WINDOW.GET_FULLSCREEN);
  ipcMain.removeHandler(IPC_CHANNELS.WINDOW.OPEN_NEW);
}
```

Add `OPEN_NEW` to IPC channels in `src/shared/types/api.ts`:

```typescript
WINDOW: {
  ON_FULLSCREEN_CHANGE: 'window:on-fullscreen-change',
  GET_FULLSCREEN: 'window:get-fullscreen',
  OPEN_NEW: 'window:open-new',
},
```

Add `openNew` to `WindowAPI` interface:

```typescript
export interface WindowAPI {
  getFullscreen: () => Promise<boolean>;
  openNew: (filePath?: string) => Promise<void>;
  onFullscreenChange: (
    callback: (event: FullscreenChangeEvent) => void
  ) => () => void;
}
```

Register the window handlers in `src/main/ipc/handlers/index.ts` and wire into `registerAllHandlers`.

### Step 3: Delete MainWindow.ts

Remove `src/main/window/MainWindow.ts`.

### Step 4: Run all tests

Run: `pnpm vitest run`
Expected: All existing tests pass. Some tests that mock `getMainWindow` may need updating.

### Step 5: Commit

```bash
git add -A
git commit -m "refactor(multi-window): replace MainWindow singleton with WindowManager"
```

---

## Task 3: Refactor FileWatcherService for Multi-File Watching

**Files:**
- Modify: `src/main/services/FileWatcherService.ts`
- Modify: `tests/unit/main/services/FileWatcherService.test.ts`

### Step 1: Write new tests for multi-file behavior

Add these tests to the existing test file:

```typescript
describe('multi-file watching', () => {
  it('should watch multiple files simultaneously', async () => {
    const file1 = path.join(tempDir, 'file1.md');
    const file2 = path.join(tempDir, 'file2.md');
    await fs.writeFile(file1, '# File 1');
    await fs.writeFile(file2, '# File 2');

    await service.watch(file1, 1);
    await service.watch(file2, 2);

    expect(service.isWatchingFile(file1)).toBe(true);
    expect(service.isWatchingFile(file2)).toBe(true);
  });

  it('should reference-count when same file watched by multiple windows', async () => {
    await service.watch(testFile, 1);
    await service.watch(testFile, 2);

    await service.unwatch(testFile, 1);
    expect(service.isWatchingFile(testFile)).toBe(true);

    await service.unwatch(testFile, 2);
    expect(service.isWatchingFile(testFile)).toBe(false);
  });

  it('should only notify the window watching a specific file', async () => {
    const file1 = path.join(tempDir, 'file1.md');
    const file2 = path.join(tempDir, 'file2.md');
    await fs.writeFile(file1, '# File 1');
    await fs.writeFile(file2, '# File 2');

    const callback1 = vi.fn();
    const callback2 = vi.fn();
    service.onFileChange(1, callback1);
    service.onFileChange(2, callback2);

    await service.watch(file1, 1);
    await service.watch(file2, 2);

    // Simulate change on file1 - only callback1 should fire
    // (tested via mock watcher trigger)
  });

  it('should clean up all subscriptions for a window via unwatchAll', async () => {
    const file1 = path.join(tempDir, 'file1.md');
    await fs.writeFile(file1, '# File 1');

    await service.watch(testFile, 1);
    await service.watch(file1, 1);

    await service.unwatchAll(1);

    expect(service.isWatchingFile(testFile)).toBe(false);
    expect(service.isWatchingFile(file1)).toBe(false);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `pnpm vitest run tests/unit/main/services/FileWatcherService.test.ts`
Expected: FAIL - methods like `isWatchingFile`, `unwatchAll` don't exist, `watch` doesn't accept windowId

### Step 3: Refactor FileWatcherService implementation

Key changes to `src/main/services/FileWatcherService.ts`:

- Change `watch(filePath)` to `watch(filePath, windowId)`
- Change `unwatch()` to `unwatch(filePath, windowId)`
- Add `unwatchAll(windowId)` for window close cleanup
- Change internal storage from single watcher to `Map<string, { watcher: FSWatcher, windowIds: Set<number> }>`
- Change callbacks from `Set<callback>` to `Map<number, Set<callback>>` (per-window)
- Add `isWatchingFile(filePath)` query method
- When notifying, only call callbacks for windows watching that file

### Step 4: Update existing tests

Existing tests that call `watch(filePath)` need updating to `watch(filePath, windowId)`. The `onFileChange(callback)` signature changes to `onFileChange(windowId, callback)`. Update all call sites.

### Step 5: Run all tests

Run: `pnpm vitest run`
Expected: All tests pass

### Step 6: Commit

```bash
git add src/main/services/FileWatcherService.ts tests/unit/main/services/FileWatcherService.test.ts
git commit -m "feat(multi-window): refactor FileWatcherService for multi-file watching"
```

---

## Task 4: Update FileHandler IPC for Multi-Window

**Files:**
- Modify: `src/main/ipc/handlers/FileHandler.ts`
- Modify: `tests/unit/main/ipc/handlers/FileHandler.test.ts`

### Step 1: Write failing test for window-scoped watching

Add to `FileHandler.test.ts`:

```typescript
it('should pass window id to FileWatcherService.watch', async () => {
  const mockWindow = {
    id: 42,
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
    once: vi.fn(),
  };
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as unknown as BrowserWindow);
  mockFileWatcherService.watch.mockResolvedValue(undefined);

  registerFileHandlers();

  const handler = mockIpcMain._getHandler(IPC_CHANNELS.FILE.WATCH);
  await handler?.({ sender: {} }, '/path/to/file.md');

  expect(mockFileWatcherService.watch).toHaveBeenCalledWith('/path/to/file.md', 42);
});
```

### Step 2: Run test to verify it fails

Run: `pnpm vitest run tests/unit/main/ipc/handlers/FileHandler.test.ts`
Expected: FAIL - watch called with wrong arguments

### Step 3: Update FileHandler implementation

In `src/main/ipc/handlers/FileHandler.ts`:

- WATCH handler: pass `window.id` to `fileWatcherService.watch(filePath, window.id)`
- UNWATCH handler: pass `window.id` to `fileWatcherService.unwatch(filePath, window.id)`
- Change `onFileChange` / `onFileDelete` to use per-window registration: `fileWatcherService.onFileChange(window.id, callback)`
- On window close: call `fileWatcherService.unwatchAll(window.id)` instead of individual unsubscribes

### Step 4: Update existing FileHandler tests

Update mock signatures and assertions to match new API.

### Step 5: Run all tests

Run: `pnpm vitest run`
Expected: All tests pass

### Step 6: Commit

```bash
git add src/main/ipc/handlers/FileHandler.ts tests/unit/main/ipc/handlers/FileHandler.test.ts
git commit -m "feat(multi-window): update FileHandler for window-scoped watching"
```

---

## Task 5: Wire Up Window Title

**Files:**
- Modify: `src/main/window/WindowManager.ts`
- Modify: `tests/unit/main/window/WindowManager.test.ts`

### Step 1: Write failing test

```typescript
it('should set window title when file path is set', () => {
  const win = manager.createWindow();
  manager.setWindowFilePath(win.id, '/path/to/README.md');
  expect(win.setTitle).toHaveBeenCalledWith('README.md');
});

it('should set default title when file path is cleared', () => {
  const win = manager.createWindow();
  manager.setWindowFilePath(win.id, '/path/to/README.md');
  manager.setWindowFilePath(win.id, null);
  expect(win.setTitle).toHaveBeenCalledWith('Markdown Viewer');
});
```

### Step 2: Run test to verify it fails

Run: `pnpm vitest run tests/unit/main/window/WindowManager.test.ts`
Expected: FAIL - `setTitle` not called

### Step 3: Update setWindowFilePath in WindowManager

```typescript
setWindowFilePath(windowId: number, filePath: string | null): void {
  this.windowFilePaths.set(windowId, filePath);
  const win = this.windows.get(windowId);
  if (win && !win.isDestroyed()) {
    if (filePath) {
      const fileName = path.basename(filePath);
      win.setTitle(fileName);
    } else {
      win.setTitle(APP_CONFIG.NAME);
    }
  }
}
```

### Step 4: Run tests

Run: `pnpm vitest run tests/unit/main/window/WindowManager.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/main/window/WindowManager.ts tests/unit/main/window/WindowManager.test.ts
git commit -m "feat(multi-window): set window title from file name"
```

---

## Task 6: Add Window IPC Channel, Preload Bridge, and Handler

**Files:**
- Modify: `src/shared/types/api.ts` (add OPEN_NEW channel + WindowAPI.openNew)
- Create: `src/main/ipc/handlers/WindowHandler.ts`
- Create: `tests/unit/main/ipc/handlers/WindowHandler.test.ts`
- Modify: `src/main/ipc/handlers/index.ts` (register WindowHandler)
- Modify: `src/preload/preload.ts` (add window.openNew bridge)

### Step 1: Add the IPC channel constant and API type

In `src/shared/types/api.ts`, add `OPEN_NEW: 'window:open-new'` to `IPC_CHANNELS.WINDOW` and `openNew: (filePath?: string) => Promise<void>` to `WindowAPI`.

### Step 2: Write failing test for WindowHandler

Create `tests/unit/main/ipc/handlers/WindowHandler.test.ts`:

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@main/ipc/channels';
import { registerWindowHandlers, unregisterWindowHandlers } from '@main/ipc/handlers/WindowHandler';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron (same pattern as FileHandler.test.ts)
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
      fromWebContents: vi.fn(),
    },
  };
});

const mockWindowManager = {
  createWindow: vi.fn(),
};

vi.mock('@main/window/WindowManager', () => ({
  getWindowManager: () => mockWindowManager,
}));

type MockIpcMain = typeof ipcMain & {
  _getHandler: (channel: string) => ((...args: unknown[]) => unknown) | undefined;
  _clearHandlers: () => void;
};

describe('WindowHandler', () => {
  const mockIpcMain = ipcMain as MockIpcMain;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain._clearHandlers();
  });

  afterEach(() => {
    unregisterWindowHandlers();
  });

  it('should register GET_FULLSCREEN and OPEN_NEW handlers', () => {
    registerWindowHandlers();
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW.GET_FULLSCREEN, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW.OPEN_NEW, expect.any(Function));
  });

  it('GET_FULLSCREEN should return fullscreen state for sender window', async () => {
    const mockWindow = { isFullScreen: vi.fn(() => true) };
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as unknown as BrowserWindow);

    registerWindowHandlers();
    const handler = mockIpcMain._getHandler(IPC_CHANNELS.WINDOW.GET_FULLSCREEN);
    const result = await handler?.({ sender: {} });

    expect(result).toBe(true);
  });

  it('OPEN_NEW should call windowManager.createWindow', async () => {
    const mockWin = { id: 1, webContents: { once: vi.fn() } };
    mockWindowManager.createWindow.mockReturnValue(mockWin);

    registerWindowHandlers();
    const handler = mockIpcMain._getHandler(IPC_CHANNELS.WINDOW.OPEN_NEW);
    await handler?.({});

    expect(mockWindowManager.createWindow).toHaveBeenCalled();
  });
});
```

### Step 3: Run test to verify it fails

Run: `pnpm vitest run tests/unit/main/ipc/handlers/WindowHandler.test.ts`
Expected: FAIL - module not found

### Step 4: Implement WindowHandler

Create `src/main/ipc/handlers/WindowHandler.ts` with `registerWindowHandlers()` and `unregisterWindowHandlers()`.

### Step 5: Wire into handler index

Add import/export and registration calls in `src/main/ipc/handlers/index.ts`.

### Step 6: Add preload bridge

In `src/preload/preload.ts`, add to the `window` section:

```typescript
openNew: (filePath?: string): Promise<void> => {
  return ipcRenderer.invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, filePath);
},
```

### Step 7: Run all tests

Run: `pnpm vitest run`
Expected: All tests pass

### Step 8: Commit

```bash
git add -A
git commit -m "feat(multi-window): add WINDOW.OPEN_NEW IPC channel and handler"
```

---

## Task 7: Add Renderer Keyboard Shortcut and Recent Files Modifier-Click

**Files:**
- Modify: `src/renderer.ts` (add Cmd+Shift+N shortcut)
- Modify: `src/renderer/components/RecentFilesDropdown.ts` (add modifier-click)

### Step 1: Add keyboard shortcut to renderer

In `src/renderer.ts`, inside `setupEventListeners()`, after the find shortcut:

```typescript
// New window shortcut (Cmd+Shift+N / Ctrl+Shift+N)
const handleNewWindowShortcut = (e: KeyboardEvent): void => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'N') {
    e.preventDefault();
    void window.electronAPI.window.openNew();
  }
};
document.addEventListener('keydown', handleNewWindowShortcut);
this.cleanupFunctions.push(() => document.removeEventListener('keydown', handleNewWindowShortcut));
```

### Step 2: Add modifier-click to RecentFilesDropdown

Read `src/renderer/components/RecentFilesDropdown.ts` to understand the click handler, then add logic:

- If Cmd/Ctrl is held during click on a recent file entry, call `window.electronAPI.window.openNew(filePath)` instead of the normal `onSelectRecentFile` callback.

### Step 3: Run typecheck

Run: `pnpm run typecheck`
Expected: No type errors

### Step 4: Commit

```bash
git add src/renderer.ts src/renderer/components/RecentFilesDropdown.ts
git commit -m "feat(multi-window): add Cmd+Shift+N shortcut and modifier-click for new window"
```

---

## Task 8: Wire WindowManager into Renderer for File Path Tracking

**Files:**
- Modify: `src/main/ipc/handlers/FileHandler.ts`

### Step 1: Update FILE.WATCH handler to track file path

When the renderer calls `watch(filePath)`, the handler should also call `windowManager.setWindowFilePath(window.id, filePath)`. When `unwatch` is called, set it to `null`.

This lets the `open-file` event in `main/index.ts` correctly find windows by file path and find empty windows.

### Step 2: Update FILE.WATCH handler's window-close cleanup

On window close, also call `windowManager.setWindowFilePath(window.id, null)` (though the window is being removed anyway, this keeps state consistent).

### Step 3: Run all tests

Run: `pnpm vitest run`
Expected: All tests pass

### Step 4: Commit

```bash
git add src/main/ipc/handlers/FileHandler.ts
git commit -m "feat(multi-window): track file paths in WindowManager from FileHandler"
```

---

## Task 9: Add Fullscreen Events to WindowManager

**Files:**
- Modify: `src/main/window/WindowManager.ts`

### Step 1: Add fullscreen event forwarding to createWindow

In `WindowManager.createWindow()`, add the fullscreen event handlers that were previously in `MainWindow.create()`:

```typescript
win.on('enter-full-screen', () => {
  win.webContents.send(IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE, { isFullscreen: true });
});

win.on('leave-full-screen', () => {
  win.webContents.send(IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE, { isFullscreen: false });
});
```

### Step 2: Run all tests and typecheck

Run: `pnpm vitest run && pnpm run typecheck`
Expected: All pass

### Step 3: Commit

```bash
git add src/main/window/WindowManager.ts
git commit -m "feat(multi-window): add fullscreen event forwarding in WindowManager"
```

---

## Task 10: Final Integration Test

**Files:**
- No new files -- manual verification

### Step 1: Run all unit tests

Run: `pnpm vitest run`
Expected: All tests pass, no regressions

### Step 2: Run typecheck

Run: `pnpm run typecheck`
Expected: No errors

### Step 3: Run lint

Run: `pnpm run lint`
Expected: No errors

### Step 4: Manual smoke test

Run: `pnpm start`

Test these scenarios:
1. App launches with single empty window
2. Open a file via Open dialog -- renders correctly
3. Press Cmd+Shift+N -- new empty window opens
4. Open a different file in the second window
5. Both windows show their respective files independently
6. Edit one file externally -- only that window updates
7. Double-click a .md file in Finder while app is running -- correct routing behavior
8. Close one window -- other remains unaffected
9. Close all windows, click dock icon -- new empty window opens

### Step 5: Commit any fixes from smoke testing

```bash
git add -A
git commit -m "fix(multi-window): address smoke test issues"
```

### Step 6: Final commit summarizing the feature

```bash
git add -A
git commit -m "feat(multi-window): complete multi-window support"
```
