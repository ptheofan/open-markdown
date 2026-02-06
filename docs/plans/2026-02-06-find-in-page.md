# Find in Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Cmd+F search to find and highlight text in the loaded markdown document, using Electron's built-in `findInPage` API with a floating search bar UI.

**Architecture:** FindBar component (floating search pill UI) communicates via IPC bridge to FindHandler (main process) which calls `webContents.findInPage()`. Results flow back via `found-in-page` event.

**Tech Stack:** TypeScript, Electron findInPage API, vitest

---

### Task 1: Add find types and IPC channels

**Files:**
- Create: `src/shared/types/find.ts`
- Modify: `src/shared/types/index.ts`
- Modify: `src/shared/types/api.ts`

**Step 1: Create the types file**

Create `src/shared/types/find.ts`:

```ts
export interface FindInPageOptions {
  matchCase?: boolean;
  forward?: boolean;
  findNext?: boolean;
}

export interface FindResult {
  activeMatchOrdinal: number;
  matches: number;
}
```

**Step 2: Export from index**

Add to end of `src/shared/types/index.ts`:

```ts
// Find types
export type {
  FindInPageOptions,
  FindResult,
} from './find';
```

**Step 3: Add IPC channels**

In `src/shared/types/api.ts`, add a `FIND` section to `IPC_CHANNELS` (after the `FILE_ASSOCIATION` block, before `} as const`):

```ts
  FIND: {
    FIND_IN_PAGE: 'find:find-in-page',
    STOP_FINDING: 'find:stop-finding',
    ON_RESULT: 'find:on-result',
  },
```

Add `FIND` to the `IpcChannel` union type:

```ts
  | (typeof IPC_CHANNELS.FIND)[keyof typeof IPC_CHANNELS.FIND]
```

Add the `FindAPI` interface (after `FileAssociationAPI`):

```ts
export interface FindAPI {
  findInPage: (text: string, options?: FindInPageOptions) => void;
  stopFinding: (action: 'clearSelection' | 'keepSelection') => void;
  onResult: (callback: (result: FindResult) => void) => () => void;
}
```

Import `FindInPageOptions` and `FindResult` at the top:

```ts
import type { FindInPageOptions, FindResult } from './find';
```

Add `find: FindAPI;` to the `ElectronAPI` interface (after `fileAssociation`).

**Step 4: Verify types compile**

Run: `pnpm typecheck`
Expected: FAIL — preload doesn't implement `find` yet, but types should be structurally correct. Verify the error is only about the missing implementation in preload.

**Step 5: Commit**

```bash
git add src/shared/types/find.ts src/shared/types/index.ts src/shared/types/api.ts
git commit -m "feat: add find-in-page types and IPC channels"
```

---

### Task 2: FindHandler — failing tests

**Files:**
- Create: `tests/unit/main/ipc/handlers/FindHandler.test.ts`

**Step 1: Write the test file**

Create `tests/unit/main/ipc/handlers/FindHandler.test.ts`:

```ts
import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '@main/ipc/channels';
import {
  registerFindHandlers,
  unregisterFindHandlers,
} from '@main/ipc/handlers/FindHandler';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  };
});

// Helper to get registered handler
function getHandler(channel: string) {
  return (ipcMain as unknown as { _getHandler: (c: string) => ((...args: unknown[]) => unknown) | undefined })._getHandler(channel);
}

describe('FindHandler', () => {
  beforeEach(() => {
    (ipcMain as unknown as { _clearHandlers: () => void })._clearHandlers();
    vi.clearAllMocks();
    registerFindHandlers();
  });

  afterEach(() => {
    unregisterFindHandlers();
  });

  it('should register find handlers', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.FIND.FIND_IN_PAGE,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.FIND.STOP_FINDING,
      expect.any(Function),
    );
  });

  it('should unregister find handlers', () => {
    unregisterFindHandlers();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.FIND.FIND_IN_PAGE,
    );
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.FIND.STOP_FINDING,
    );
  });

  describe('find-in-page', () => {
    it('should call webContents.findInPage with text and options', async () => {
      const mockFindInPage = vi.fn();
      const mockEvent = {
        sender: { findInPage: mockFindInPage },
      };

      const handler = getHandler(IPC_CHANNELS.FIND.FIND_IN_PAGE);
      await handler!(mockEvent, { text: 'hello', options: { matchCase: true } });

      expect(mockFindInPage).toHaveBeenCalledWith('hello', { matchCase: true });
    });

    it('should call webContents.findInPage with default options', async () => {
      const mockFindInPage = vi.fn();
      const mockEvent = {
        sender: { findInPage: mockFindInPage },
      };

      const handler = getHandler(IPC_CHANNELS.FIND.FIND_IN_PAGE);
      await handler!(mockEvent, { text: 'world', options: {} });

      expect(mockFindInPage).toHaveBeenCalledWith('world', {});
    });

    it('should not call findInPage with empty text', async () => {
      const mockFindInPage = vi.fn();
      const mockEvent = {
        sender: { findInPage: mockFindInPage },
      };

      const handler = getHandler(IPC_CHANNELS.FIND.FIND_IN_PAGE);
      await handler!(mockEvent, { text: '', options: {} });

      expect(mockFindInPage).not.toHaveBeenCalled();
    });
  });

  describe('stop-finding', () => {
    it('should call webContents.stopFindInPage with action', async () => {
      const mockStopFindInPage = vi.fn();
      const mockEvent = {
        sender: { stopFindInPage: mockStopFindInPage },
      };

      const handler = getHandler(IPC_CHANNELS.FIND.STOP_FINDING);
      await handler!(mockEvent, { action: 'clearSelection' });

      expect(mockStopFindInPage).toHaveBeenCalledWith('clearSelection');
    });

    it('should call stopFindInPage with keepSelection', async () => {
      const mockStopFindInPage = vi.fn();
      const mockEvent = {
        sender: { stopFindInPage: mockStopFindInPage },
      };

      const handler = getHandler(IPC_CHANNELS.FIND.STOP_FINDING);
      await handler!(mockEvent, { action: 'keepSelection' });

      expect(mockStopFindInPage).toHaveBeenCalledWith('keepSelection');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/main/ipc/handlers/FindHandler.test.ts`
Expected: FAIL — module `@main/ipc/handlers/FindHandler` not found

**Step 3: Commit**

```bash
git add tests/unit/main/ipc/handlers/FindHandler.test.ts
git commit -m "test: add FindHandler failing tests"
```

---

### Task 3: FindHandler — implementation

**Files:**
- Create: `src/main/ipc/handlers/FindHandler.ts`
- Modify: `src/main/ipc/handlers/index.ts`

**Step 1: Implement FindHandler**

Create `src/main/ipc/handlers/FindHandler.ts`:

```ts
/**
 * IPC handlers for find-in-page operations
 */
import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../channels';

import type { FindInPageOptions } from '@shared/types';

/**
 * Register find-related IPC handlers
 */
export function registerFindHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.FIND.FIND_IN_PAGE,
    (event, { text, options }: { text: string; options: FindInPageOptions }) => {
      if (!text) return;
      event.sender.findInPage(text, options);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FIND.STOP_FINDING,
    (event, { action }: { action: 'clearSelection' | 'keepSelection' | 'activateSelection' }) => {
      event.sender.stopFindInPage(action);
    }
  );
}

/**
 * Unregister find-related IPC handlers
 */
export function unregisterFindHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.FIND.FIND_IN_PAGE);
  ipcMain.removeHandler(IPC_CHANNELS.FIND.STOP_FINDING);
}
```

**Step 2: Register in handlers index**

In `src/main/ipc/handlers/index.ts`:

Add import:
```ts
import {
  registerFindHandlers,
  unregisterFindHandlers,
} from './FindHandler';
```

Add `registerFindHandlers();` in `registerAllHandlers()`.

Add `unregisterFindHandlers();` in `unregisterAllHandlers()`.

Add re-export:
```ts
export {
  registerFindHandlers,
  unregisterFindHandlers,
} from './FindHandler';
```

**Step 3: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/main/ipc/handlers/FindHandler.test.ts`
Expected: ALL PASS

**Step 4: Run ALL tests**

Run: `pnpm test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/main/ipc/handlers/FindHandler.ts src/main/ipc/handlers/index.ts
git commit -m "feat: implement FindHandler for find-in-page IPC"
```

---

### Task 4: Preload bridge — add find namespace

**Files:**
- Modify: `src/preload/preload.ts`

**Step 1: Add find import**

Add `FindInPageOptions` and `FindResult` to the type imports from `@shared/types`:

```ts
import type {
  // ...existing imports...
  FindInPageOptions,
  FindResult,
} from '@shared/types';
```

**Step 2: Add find namespace to electronAPI object**

Add after the `fileAssociation` block (before the closing `};` of `electronAPI`):

```ts
  find: {
    findInPage: (text: string, options?: FindInPageOptions): void => {
      ipcRenderer.invoke(IPC_CHANNELS.FIND.FIND_IN_PAGE, { text, options: options ?? {} });
    },

    stopFinding: (action: 'clearSelection' | 'keepSelection'): void => {
      ipcRenderer.invoke(IPC_CHANNELS.FIND.STOP_FINDING, { action });
    },

    onResult: (callback: (result: FindResult) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: FindResult,
      ): void => {
        callback(data);
      };

      ipcRenderer.on(IPC_CHANNELS.FIND.ON_RESULT, handler);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.FIND.ON_RESULT, handler);
      };
    },
  },
```

**Step 3: Verify types compile**

Run: `pnpm typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/preload/preload.ts
git commit -m "feat: add find namespace to preload bridge"
```

---

### Task 5: Set up found-in-page event forwarding in main process

**Files:**
- Modify: `src/main/index.ts` (or wherever BrowserWindow is created)

First, find where the BrowserWindow is created and its `webContents` is accessible. Add a `found-in-page` event listener that forwards results to the renderer.

Look for the BrowserWindow creation code. After the window is created, add:

```ts
mainWindow.webContents.on('found-in-page', (_event, result) => {
  mainWindow.webContents.send(IPC_CHANNELS.FIND.ON_RESULT, {
    activeMatchOrdinal: result.activeMatchOrdinal,
    matches: result.matches,
  });
});
```

Import `IPC_CHANNELS` if not already imported.

**Step 1: Verify types compile**

Run: `pnpm typecheck`
Expected: No errors

**Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: forward found-in-page results to renderer"
```

---

### Task 6: FindBar component

**Files:**
- Create: `src/renderer/components/FindBar.ts`
- Modify: `src/renderer/components/index.ts`

**Step 1: Implement FindBar**

Create `src/renderer/components/FindBar.ts`:

```ts
/**
 * FindBar - Floating search bar for find-in-page functionality
 */
import type { FindResult } from '@shared/types';

export interface FindBarCallbacks {
  onFind: (text: string, options: { matchCase: boolean }) => void;
  onFindNext: (options: { forward: boolean }) => void;
  onStopFinding: () => void;
}

const FIND_BAR_CLASS = 'find-bar';
const FIND_BAR_VISIBLE_CLASS = 'find-bar-visible';
const DEBOUNCE_MS = 150;

export class FindBar {
  private readonly container: HTMLElement;
  private readonly element: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly countDisplay: HTMLSpanElement;
  private readonly caseToggle: HTMLButtonElement;
  private readonly callbacks: FindBarCallbacks;
  private readonly handleKeydown: (e: KeyboardEvent) => void;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private matchCase = false;
  private currentText = '';
  private isVisible = false;

  constructor(container: HTMLElement, callbacks: FindBarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.element = this.createElement();
    this.input = this.element.querySelector('.find-bar-input') as HTMLInputElement;
    this.countDisplay = this.element.querySelector('.find-bar-count') as HTMLSpanElement;
    this.caseToggle = this.element.querySelector('.find-bar-toggle-case') as HTMLButtonElement;

    this.handleKeydown = (e: KeyboardEvent) => this.onGlobalKeydown(e);

    this.setupEventListeners();
    this.container.appendChild(this.element);
  }

  show(): void {
    if (this.isVisible) {
      this.input.focus();
      this.input.select();
      return;
    }

    this.isVisible = true;
    this.element.classList.add(FIND_BAR_VISIBLE_CLASS);

    // Pre-fill with selection if available
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      this.input.value = selection.toString().trim();
      this.currentText = this.input.value;
    }

    this.input.focus();
    this.input.select();

    // Trigger initial search if there's text
    if (this.currentText) {
      this.callbacks.onFind(this.currentText, { matchCase: this.matchCase });
    }

    document.addEventListener('keydown', this.handleKeydown);
  }

  hide(): void {
    if (!this.isVisible) return;

    this.isVisible = false;
    this.element.classList.remove(FIND_BAR_VISIBLE_CLASS);
    this.callbacks.onStopFinding();
    this.countDisplay.textContent = '';
    document.removeEventListener('keydown', this.handleKeydown);
  }

  updateResult(result: FindResult): void {
    if (result.matches === 0) {
      this.countDisplay.textContent = 'No results';
      this.countDisplay.classList.add('find-bar-no-results');
    } else {
      this.countDisplay.textContent = `${result.activeMatchOrdinal} of ${result.matches}`;
      this.countDisplay.classList.remove('find-bar-no-results');
    }
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKeydown);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.element.remove();
  }

  private createElement(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = FIND_BAR_CLASS;
    el.innerHTML = `
      <input class="find-bar-input" type="text" placeholder="Find..." />
      <span class="find-bar-count"></span>
      <button class="find-bar-toggle-case" title="Match Case">Aa</button>
      <button class="find-bar-prev" title="Previous Match (Shift+Enter)">&#x2191;</button>
      <button class="find-bar-next" title="Next Match (Enter)">&#x2193;</button>
      <button class="find-bar-close" title="Close (Escape)">&#x2715;</button>
    `;
    return el;
  }

  private setupEventListeners(): void {
    // Input with debounce
    this.input.addEventListener('input', () => {
      this.currentText = this.input.value;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);

      if (!this.currentText) {
        this.callbacks.onStopFinding();
        this.countDisplay.textContent = '';
        return;
      }

      this.debounceTimer = setTimeout(() => {
        this.callbacks.onFind(this.currentText, { matchCase: this.matchCase });
      }, DEBOUNCE_MS);
    });

    // Enter / Shift+Enter in input
    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.currentText) {
          this.callbacks.onFindNext({ forward: !e.shiftKey });
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });

    // Case toggle
    this.caseToggle.addEventListener('click', () => {
      this.matchCase = !this.matchCase;
      this.caseToggle.classList.toggle('find-bar-toggle-active', this.matchCase);
      if (this.currentText) {
        this.callbacks.onFind(this.currentText, { matchCase: this.matchCase });
      }
    });

    // Prev / Next buttons
    this.element.querySelector('.find-bar-prev')!.addEventListener('click', () => {
      if (this.currentText) this.callbacks.onFindNext({ forward: false });
    });

    this.element.querySelector('.find-bar-next')!.addEventListener('click', () => {
      if (this.currentText) this.callbacks.onFindNext({ forward: true });
    });

    // Close button
    this.element.querySelector('.find-bar-close')!.addEventListener('click', () => {
      this.hide();
    });
  }

  private onGlobalKeydown(e: KeyboardEvent): void {
    // Escape anywhere closes the bar
    if (e.key === 'Escape' && this.isVisible) {
      e.preventDefault();
      this.hide();
    }
  }
}

export function createFindBar(container: HTMLElement, callbacks: FindBarCallbacks): FindBar {
  return new FindBar(container, callbacks);
}
```

**Step 2: Export from components index**

Add to end of `src/renderer/components/index.ts`:

```ts
// FindBar
export {
  FindBar,
  createFindBar,
  type FindBarCallbacks,
} from './FindBar';
```

**Step 3: Verify types compile**

Run: `pnpm typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/renderer/components/FindBar.ts src/renderer/components/index.ts
git commit -m "feat: implement FindBar component"
```

---

### Task 7: CSS styles for find bar

**Files:**
- Modify: `src/index.css`

**Step 1: Append find bar styles**

Append to end of `src/index.css`:

```css
/* ===========================================
   Find Bar
   =========================================== */

.find-bar {
  position: fixed;
  top: 52px;
  right: 20px;
  z-index: 2000;
  display: none;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background-color: var(--toolbar-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  font-size: 13px;
}

.find-bar-visible {
  display: flex;
}

.find-bar-input {
  width: 200px;
  padding: 4px 8px;
  background-color: var(--input-bg);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 13px;
  outline: none;
}

.find-bar-input:focus {
  border-color: var(--link-color);
}

.find-bar-count {
  min-width: 60px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.find-bar-no-results {
  color: var(--gutter-deleted-color);
}

.find-bar button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: none;
  color: var(--text-color);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.find-bar button:hover {
  background-color: var(--hover-bg);
  border-color: var(--border-color);
}

.find-bar-toggle-case {
  font-size: 12px !important;
  font-weight: 600;
}

.find-bar-toggle-active {
  background-color: var(--link-color) !important;
  color: white !important;
  border-color: var(--link-color) !important;
  border-radius: 4px;
}

.find-bar-close {
  font-size: 16px !important;
}
```

**Step 2: Commit**

```bash
git add src/index.css
git commit -m "feat: add CSS styles for find bar"
```

---

### Task 8: Wire into App class

**Files:**
- Modify: `src/renderer.ts`

**Step 1: Add imports**

Add `createFindBar` and `type FindBar` to the components import block:

```ts
  createFindBar,
  // ...existing...
  type FindBar,
```

Add `FindResult` to the shared types import:

```ts
import type {
  // ...existing...
  FindResult,
} from '@shared/types';
```

**Step 2: Add class member**

After the `changeGutter` member, add:

```ts
  private findBar: FindBar | null = null;
```

**Step 3: Initialize in initializeComponents**

After the changeGutter creation block, add:

```ts
    this.findBar = createFindBar(viewerElement, {
      onFind: (text, options) => {
        window.electronAPI.find.findInPage(text, options);
      },
      onFindNext: (options) => {
        window.electronAPI.find.findInPage(this.findBar ? '' : '', {
          ...options,
          findNext: true,
        });
      },
      onStopFinding: () => {
        window.electronAPI.find.stopFinding('clearSelection');
      },
    });
```

Wait — `onFindNext` needs the current search text. The FindBar doesn't expose it. Let me fix: the `onFindNext` callback should re-send the current text. Actually, looking at Electron's findInPage API, calling it again with `findNext: true` advances to the next match. The FindBar manages `currentText` internally but doesn't expose it. Instead, let the FindBar's `onFindNext` include the text:

Actually, looking at my FindBar implementation above, `onFindNext` only passes `{ forward: boolean }`. But Electron's `findInPage` needs the text again with `findNext: true`. Let me fix the FindBar callbacks:

Change `FindBarCallbacks` to:
```ts
export interface FindBarCallbacks {
  onFind: (text: string, options: { matchCase: boolean }) => void;
  onFindNext: (text: string, options: { matchCase: boolean; forward: boolean }) => void;
  onStopFinding: () => void;
}
```

And in the FindBar, update the Enter/Shift+Enter and button handlers to pass `this.currentText` and `this.matchCase`.

With that fix, the App wiring becomes:

```ts
    this.findBar = createFindBar(viewerElement, {
      onFind: (text, { matchCase }) => {
        window.electronAPI.find.findInPage(text, { matchCase });
      },
      onFindNext: (text, { matchCase, forward }) => {
        window.electronAPI.find.findInPage(text, { matchCase, forward, findNext: true });
      },
      onStopFinding: () => {
        window.electronAPI.find.stopFinding('clearSelection');
      },
    });
```

**Step 4: Register Cmd+F shortcut in setupEventListeners**

Add at the end of `setupEventListeners()`:

```ts
    // Find shortcut (Cmd+F / Ctrl+F)
    const handleFindShortcut = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        this.findBar?.show();
      }
    };
    document.addEventListener('keydown', handleFindShortcut);
    this.cleanupFunctions.push(() => document.removeEventListener('keydown', handleFindShortcut));
```

**Step 5: Register find result listener**

Add after the find shortcut registration:

```ts
    // Find result listener
    const cleanupFindResult = window.electronAPI.find.onResult((result: FindResult) => {
      this.findBar?.updateResult(result);
    });
    this.cleanupFunctions.push(cleanupFindResult);
```

**Step 6: Cleanup in destroy**

After `this.changeGutter?.destroy();`, add:

```ts
    this.findBar?.destroy();
```

**Step 7: Verify types compile**

Run: `pnpm typecheck`
Expected: No errors

**Step 8: Run all tests**

Run: `pnpm test`
Expected: ALL PASS

**Step 9: Commit**

```bash
git add src/renderer.ts src/renderer/components/FindBar.ts
git commit -m "feat: wire find bar into App lifecycle"
```

---

### Task 9: Final verification

**Step 1: Full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 2: Type check**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Lint**

Run: `pnpm lint`
Expected: No errors

**Step 4: Build**

Run: `pnpm make`
Expected: Build succeeds

**Step 5: Manual test**

Run `pnpm start`, open a markdown file, press Cmd+F:
- Search bar should appear top-right
- Type text → matches highlighted, count shown
- Enter → next match, Shift+Enter → previous
- Toggle "Aa" → case-sensitive search
- Escape → bar hides, highlights cleared

**Step 6: Commit any fixups if needed, otherwise done**

## Files Summary

| File | Action |
|------|--------|
| `src/shared/types/find.ts` | NEW — find types |
| `src/shared/types/index.ts` | MODIFY — export find types |
| `src/shared/types/api.ts` | MODIFY — add FIND channels, FindAPI, ElectronAPI update |
| `src/main/ipc/handlers/FindHandler.ts` | NEW — IPC handler |
| `src/main/ipc/handlers/index.ts` | MODIFY — register FindHandler |
| `src/preload/preload.ts` | MODIFY — add find namespace |
| `src/main/index.ts` | MODIFY — found-in-page event forwarding |
| `src/renderer/components/FindBar.ts` | NEW — search bar component |
| `src/renderer/components/index.ts` | MODIFY — export FindBar |
| `src/index.css` | MODIFY — find bar styles |
| `src/renderer.ts` | MODIFY — App class integration |
| `tests/unit/main/ipc/handlers/FindHandler.test.ts` | NEW — handler tests |
