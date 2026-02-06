# Change Gutter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show colored gutter indicators (green/red) on rendered markdown when the file changes on disk, with a user-controlled baseline and Reset button.

**Architecture:** Three new components — SourceMapRule (markdown-it core rule propagating line info to HTML), DiffService (pure diff computation against a stored baseline), ChangeGutter (DOM component applying CSS classes and managing a Reset button). Wired together in the App class.

**Tech Stack:** TypeScript, markdown-it, `diff` (jsdiff) npm package, vitest

---

### Task 1: Install `diff` dependency

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

Run: `pnpm add diff && pnpm add -D @types/diff`

**Step 2: Verify installation**

Run: `node -e "require('diff')"`
Expected: No errors

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add diff dependency for change gutter feature"
```

---

### Task 2: Add diff types

**Files:**
- Create: `src/shared/types/diff.ts`
- Modify: `src/shared/types/index.ts:74-81`

**Step 1: Create the types file**

Create `src/shared/types/diff.ts`:

```ts
export type LineChangeType = 'added' | 'modified' | 'deleted';

export interface LineChange {
  type: LineChangeType;
  startLine: number;
  endLine: number;
}

export interface DiffResult {
  changes: LineChange[];
  hasChanges: boolean;
}
```

**Step 2: Export from index**

Add to end of `src/shared/types/index.ts`:

```ts
// Diff types
export type {
  LineChangeType,
  LineChange,
  DiffResult,
} from './diff';
```

**Step 3: Verify types compile**

Run: `pnpm typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/shared/types/diff.ts src/shared/types/index.ts
git commit -m "feat: add diff types for change gutter"
```

---

### Task 3: DiffService — failing tests

**Files:**
- Create: `tests/unit/renderer/services/DiffService.test.ts`

**Step 1: Write the test file**

Create `tests/unit/renderer/services/DiffService.test.ts`:

```ts
import { DiffService } from '@renderer/services/DiffService';
import { describe, it, expect, beforeEach } from 'vitest';

import type { DiffResult } from '@shared/types';

describe('DiffService', () => {
  let service: DiffService;

  beforeEach(() => {
    service = new DiffService();
  });

  describe('baseline management', () => {
    it('should start with no baseline', () => {
      expect(service.hasBaseline()).toBe(false);
    });

    it('should store a baseline', () => {
      service.setBaseline('line1\nline2');
      expect(service.hasBaseline()).toBe(true);
    });

    it('should clear the baseline', () => {
      service.setBaseline('line1');
      service.clearBaseline();
      expect(service.hasBaseline()).toBe(false);
    });
  });

  describe('computeDiff', () => {
    it('should return no changes for identical content', () => {
      service.setBaseline('line1\nline2\nline3');
      const result = service.computeDiff('line1\nline2\nline3');
      expect(result.hasChanges).toBe(false);
      expect(result.changes).toEqual([]);
    });

    it('should return no changes when no baseline is set', () => {
      const result = service.computeDiff('line1\nline2');
      expect(result.hasChanges).toBe(false);
      expect(result.changes).toEqual([]);
    });

    it('should detect added lines at the end', () => {
      service.setBaseline('line1\nline2');
      const result = service.computeDiff('line1\nline2\nline3\nline4');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'added', startLine: 2, endLine: 4 },
      ]);
    });

    it('should detect added lines at the beginning', () => {
      service.setBaseline('line2\nline3');
      const result = service.computeDiff('line0\nline1\nline2\nline3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'added', startLine: 0, endLine: 2 },
      ]);
    });

    it('should detect added lines in the middle', () => {
      service.setBaseline('line1\nline3');
      const result = service.computeDiff('line1\nline2\nline3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'added', startLine: 1, endLine: 2 },
      ]);
    });

    it('should detect deleted lines at the end', () => {
      service.setBaseline('line1\nline2\nline3');
      const result = service.computeDiff('line1');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'deleted', startLine: 1, endLine: 1 },
      ]);
    });

    it('should detect deleted lines at the beginning', () => {
      service.setBaseline('line1\nline2\nline3');
      const result = service.computeDiff('line3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'deleted', startLine: 0, endLine: 0 },
      ]);
    });

    it('should detect deleted lines in the middle', () => {
      service.setBaseline('line1\nline2\nline3');
      const result = service.computeDiff('line1\nline3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'deleted', startLine: 1, endLine: 1 },
      ]);
    });

    it('should detect modified lines (removed + added at same position)', () => {
      service.setBaseline('line1\nold line\nline3');
      const result = service.computeDiff('line1\nnew line\nline3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'modified', startLine: 1, endLine: 2 },
      ]);
    });

    it('should detect multiple modified lines', () => {
      service.setBaseline('line1\nold A\nold B\nline4');
      const result = service.computeDiff('line1\nnew A\nnew B\nline4');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'modified', startLine: 1, endLine: 3 },
      ]);
    });

    it('should handle mixed changes', () => {
      service.setBaseline('keep1\ndelete_me\nkeep2\nold_line\nkeep3');
      const result = service.computeDiff('keep1\nkeep2\nnew_line\nkeep3\nadded');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toContainEqual(
        { type: 'deleted', startLine: 1, endLine: 1 }
      );
      expect(result.changes).toContainEqual(
        { type: 'modified', startLine: 2, endLine: 3 }
      );
      expect(result.changes).toContainEqual(
        { type: 'added', startLine: 4, endLine: 5 }
      );
    });

    it('should handle empty baseline', () => {
      service.setBaseline('');
      const result = service.computeDiff('line1\nline2');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'added', startLine: 0, endLine: 2 },
      ]);
    });

    it('should handle empty current content', () => {
      service.setBaseline('line1\nline2');
      const result = service.computeDiff('');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'deleted', startLine: 0, endLine: 0 },
      ]);
    });

    it('should handle single line content', () => {
      service.setBaseline('old');
      const result = service.computeDiff('new');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'modified', startLine: 0, endLine: 1 },
      ]);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/renderer/services/DiffService.test.ts`
Expected: FAIL — module `@renderer/services/DiffService` not found

**Step 3: Commit**

```bash
git add tests/unit/renderer/services/DiffService.test.ts
git commit -m "test: add DiffService failing tests"
```

---

### Task 4: DiffService — implementation

**Files:**
- Create: `src/renderer/services/DiffService.ts`
- Modify: `src/renderer/services/index.ts:1-12`

**Step 1: Implement DiffService**

Create `src/renderer/services/DiffService.ts`:

```ts
import { diffArrays } from 'diff';

import type { LineChange, DiffResult } from '@shared/types';

export class DiffService {
  private baseline: string[] | null = null;

  setBaseline(content: string): void {
    this.baseline = content.split('\n');
  }

  clearBaseline(): void {
    this.baseline = null;
  }

  hasBaseline(): boolean {
    return this.baseline !== null;
  }

  computeDiff(currentContent: string): DiffResult {
    if (!this.baseline) {
      return { changes: [], hasChanges: false };
    }

    const currentLines = currentContent.split('\n');
    const diffs = diffArrays(this.baseline, currentLines);
    const changes: LineChange[] = [];
    let currentLineIndex = 0;

    for (let i = 0; i < diffs.length; i++) {
      const part = diffs[i]!;

      if (!part.added && !part.removed) {
        currentLineIndex += part.count ?? 0;
        continue;
      }

      if (part.removed) {
        const nextPart = diffs[i + 1];
        if (nextPart?.added) {
          // removed + added = modified
          changes.push({
            type: 'modified',
            startLine: currentLineIndex,
            endLine: currentLineIndex + (nextPart.count ?? 0),
          });
          currentLineIndex += nextPart.count ?? 0;
          i++; // skip the added part
        } else {
          // removed only = deleted
          changes.push({
            type: 'deleted',
            startLine: currentLineIndex,
            endLine: currentLineIndex,
          });
        }
        continue;
      }

      if (part.added) {
        changes.push({
          type: 'added',
          startLine: currentLineIndex,
          endLine: currentLineIndex + (part.count ?? 0),
        });
        currentLineIndex += part.count ?? 0;
      }
    }

    return { changes, hasChanges: changes.length > 0 };
  }
}
```

**Step 2: Export from services index**

Add to end of `src/renderer/services/index.ts`:

```ts
export { DiffService } from './DiffService';
```

**Step 3: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/renderer/services/DiffService.test.ts`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/renderer/services/DiffService.ts src/renderer/services/index.ts
git commit -m "feat: implement DiffService for change gutter"
```

---

### Task 5: SourceMapRule — failing tests

**Files:**
- Create: `tests/unit/plugins/core/SourceMapRule.test.ts`

**Step 1: Write the test file**

Create `tests/unit/plugins/core/SourceMapRule.test.ts`:

```ts
import MarkdownIt from 'markdown-it';
import { applySourceMapRule } from '@plugins/core/SourceMapRule';
import { describe, it, expect, beforeEach } from 'vitest';

describe('SourceMapRule', () => {
  let md: MarkdownIt;

  beforeEach(() => {
    md = new MarkdownIt({ html: true });
    applySourceMapRule(md);
  });

  it('should add data-source-lines to headings', () => {
    const result = md.render('# Hello');
    expect(result).toContain('data-source-lines="0-1"');
    expect(result).toContain('<h1');
  });

  it('should add data-source-lines to paragraphs', () => {
    const result = md.render('Hello world');
    expect(result).toContain('data-source-lines="0-1"');
    expect(result).toContain('<p');
  });

  it('should add data-source-lines to code blocks', () => {
    const result = md.render('```\ncode\n```');
    expect(result).toContain('data-source-lines=');
    expect(result).toContain('<pre');
  });

  it('should add data-source-lines to blockquotes', () => {
    const result = md.render('> quote');
    expect(result).toContain('data-source-lines="0-1"');
    expect(result).toContain('<blockquote');
  });

  it('should add data-source-lines to lists', () => {
    const result = md.render('- item 1\n- item 2');
    expect(result).toContain('data-source-lines=');
    expect(result).toContain('<ul');
  });

  it('should track correct line ranges for multi-line blocks', () => {
    const result = md.render('# Title\n\nParagraph text\n\n## Subtitle');
    expect(result).toContain('data-source-lines="0-1"');
    expect(result).toContain('data-source-lines="2-3"');
    expect(result).toContain('data-source-lines="4-5"');
  });

  it('should not add data-source-lines to inline elements', () => {
    const result = md.render('Hello **bold** world');
    // Only the <p> should have data-source-lines, not <strong>
    const strongMatch = result.match(/<strong[^>]*>/);
    expect(strongMatch?.[0]).not.toContain('data-source-lines');
  });

  it('should handle empty input', () => {
    const result = md.render('');
    expect(result).toBe('');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/plugins/core/SourceMapRule.test.ts`
Expected: FAIL — module `@plugins/core/SourceMapRule` not found

**Step 3: Commit**

```bash
git add tests/unit/plugins/core/SourceMapRule.test.ts
git commit -m "test: add SourceMapRule failing tests"
```

---

### Task 6: SourceMapRule — implementation

**Files:**
- Create: `src/plugins/core/SourceMapRule.ts`
- Modify: `src/plugins/core/MarkdownRenderer.ts:5,34`

**Step 1: Implement SourceMapRule**

Create `src/plugins/core/SourceMapRule.ts`:

```ts
import type MarkdownIt from 'markdown-it';

export function applySourceMapRule(md: MarkdownIt): void {
  md.core.ruler.push('source_map_attrs', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting === 1) {
        token.attrSet('data-source-lines', `${token.map[0]}-${token.map[1]}`);
      }
    }
  });
}
```

**Step 2: Integrate into MarkdownRenderer**

In `src/plugins/core/MarkdownRenderer.ts`, add import at line 2 (after the existing imports):

```ts
import { applySourceMapRule } from './SourceMapRule';
```

Then add this line inside the constructor, after line 34 (`});`):

```ts
    applySourceMapRule(this.md);
```

So the constructor becomes:

```ts
  constructor(options: MarkdownRendererOptions = {}) {
    this.md = new MarkdownIt({
      html: options.html ?? true,
      linkify: options.linkify ?? true,
      typographer: options.typographer ?? true,
      breaks: options.breaks ?? false,
    });
    applySourceMapRule(this.md);
  }
```

**Step 3: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/plugins/core/SourceMapRule.test.ts`
Expected: ALL PASS

**Step 4: Run ALL tests to make sure nothing broke**

Run: `pnpm test`
Expected: ALL PASS (existing MarkdownRenderer tests should still pass since data-source-lines is additive)

**Step 5: Commit**

```bash
git add src/plugins/core/SourceMapRule.ts src/plugins/core/MarkdownRenderer.ts
git commit -m "feat: implement SourceMapRule for change gutter"
```

---

### Task 7: ChangeGutter component

**Files:**
- Create: `src/renderer/components/ChangeGutter.ts`
- Modify: `src/renderer/components/index.ts:93-94`

**Step 1: Implement ChangeGutter**

Create `src/renderer/components/ChangeGutter.ts`:

```ts
import type { DiffResult, LineChange } from '@shared/types';

export interface ChangeGutterOptions {
  scrollContainer: HTMLElement;
  contentContainer: HTMLElement;
  onReset: () => void;
}

const ADDED_CLASS = 'change-gutter-added';
const MODIFIED_CLASS = 'change-gutter-modified';
const DELETED_CLASS = 'change-gutter-deleted';
const RESET_BTN_CLASS = 'change-gutter-reset-btn';
const DELETED_MARKER_ATTR = 'data-change-gutter-deleted';

export class ChangeGutter {
  private scrollContainer: HTMLElement;
  private contentContainer: HTMLElement;
  private onReset: () => void;
  private resetButton: HTMLButtonElement;

  constructor(options: ChangeGutterOptions) {
    this.scrollContainer = options.scrollContainer;
    this.contentContainer = options.contentContainer;
    this.onReset = options.onReset;
    this.resetButton = this.createResetButton();
  }

  applyChanges(diffResult: DiffResult): void {
    this.clearIndicators();

    if (!diffResult.hasChanges) {
      return;
    }

    const elements = this.contentContainer.querySelectorAll('[data-source-lines]');

    for (const el of elements) {
      const attr = el.getAttribute('data-source-lines');
      if (!attr) continue;

      const [startStr, endStr] = attr.split('-');
      const elStart = Number(startStr);
      const elEnd = Number(endStr);

      if (isNaN(elStart) || isNaN(elEnd)) continue;

      for (const change of diffResult.changes) {
        if (change.type === 'deleted') continue;

        if (this.rangesOverlap(elStart, elEnd, change.startLine, change.endLine)) {
          const cssClass = change.type === 'added' ? ADDED_CLASS : MODIFIED_CLASS;
          el.classList.add(cssClass);
          break;
        }
      }
    }

    // Insert deletion markers
    for (const change of diffResult.changes) {
      if (change.type !== 'deleted') continue;
      this.insertDeletionMarker(change, elements);
    }

    this.showResetButton();
  }

  clearIndicators(): void {
    // Remove gutter classes
    const added = this.contentContainer.querySelectorAll(`.${ADDED_CLASS}`);
    const modified = this.contentContainer.querySelectorAll(`.${MODIFIED_CLASS}`);
    for (const el of added) el.classList.remove(ADDED_CLASS);
    for (const el of modified) el.classList.remove(MODIFIED_CLASS);

    // Remove deletion markers
    const markers = this.contentContainer.querySelectorAll(`[${DELETED_MARKER_ATTR}]`);
    for (const marker of markers) marker.remove();

    this.hideResetButton();
  }

  destroy(): void {
    this.clearIndicators();
    this.resetButton.remove();
  }

  private rangesOverlap(
    aStart: number, aEnd: number,
    bStart: number, bEnd: number
  ): boolean {
    return aStart < bEnd && bStart < aEnd;
  }

  private insertDeletionMarker(
    change: LineChange,
    elements: NodeListOf<Element>
  ): void {
    // Find the element right after the deletion point
    let targetElement: Element | null = null;

    for (const el of elements) {
      const attr = el.getAttribute('data-source-lines');
      if (!attr) continue;

      const [startStr] = attr.split('-');
      const elStart = Number(startStr);

      if (elStart >= change.startLine) {
        targetElement = el;
        break;
      }
    }

    const marker = document.createElement('div');
    marker.className = DELETED_CLASS;
    marker.setAttribute(DELETED_MARKER_ATTR, '');

    if (targetElement) {
      targetElement.parentElement?.insertBefore(marker, targetElement);
    } else {
      this.contentContainer.appendChild(marker);
    }
  }

  private createResetButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = RESET_BTN_CLASS;
    btn.textContent = 'Reset';
    btn.title = 'Accept current content as new baseline';
    btn.style.display = 'none';
    btn.addEventListener('click', () => this.onReset());
    this.scrollContainer.appendChild(btn);
    return btn;
  }

  private showResetButton(): void {
    this.resetButton.style.display = '';
  }

  private hideResetButton(): void {
    this.resetButton.style.display = 'none';
  }
}

export function createChangeGutter(options: ChangeGutterOptions): ChangeGutter {
  return new ChangeGutter(options);
}
```

**Step 2: Export from components index**

Add to end of `src/renderer/components/index.ts`:

```ts
// ChangeGutter
export {
  ChangeGutter,
  createChangeGutter,
  type ChangeGutterOptions,
} from './ChangeGutter';
```

**Step 3: Verify types compile**

Run: `pnpm typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/renderer/components/ChangeGutter.ts src/renderer/components/index.ts
git commit -m "feat: implement ChangeGutter component"
```

---

### Task 8: CSS styles for gutter

**Files:**
- Modify: `src/index.css:31-32` (light theme vars) and `src/index.css:59-60` (dark theme vars) and append gutter styles

**Step 1: Add light theme variables**

In `src/index.css`, add these lines before the closing `}` of `:root` (before line 32):

```css
  --gutter-added-color: #2da44e;
  --gutter-modified-color: #2da44e;
  --gutter-deleted-color: #cf222e;
```

**Step 2: Add dark theme variables**

In `src/index.css`, add these lines before the closing `}` of `[data-theme="dark"]` (before line 60):

```css
  --gutter-added-color: #3fb950;
  --gutter-modified-color: #3fb950;
  --gutter-deleted-color: #f85149;
```

**Step 3: Add gutter CSS rules**

Append to end of `src/index.css`:

```css
/* ===========================================
   Change Gutter
   =========================================== */

/* Ensure markdown-body has relative positioning for gutter bars */
.markdown-body > * {
  position: relative;
}

.change-gutter-added::before,
.change-gutter-modified::before {
  content: '';
  position: absolute;
  top: 0;
  left: -16px;
  width: 3px;
  height: 100%;
  border-radius: 1.5px;
}

.change-gutter-added::before {
  background-color: var(--gutter-added-color);
}

.change-gutter-modified::before {
  background-color: var(--gutter-modified-color);
}

.change-gutter-deleted {
  position: relative;
  height: 0;
  overflow: visible;
}

.change-gutter-deleted::before {
  content: '';
  position: absolute;
  top: -1px;
  left: -16px;
  width: 12px;
  height: 2px;
  border-radius: 1px;
  background-color: var(--gutter-deleted-color);
}

.change-gutter-reset-btn {
  position: sticky;
  bottom: 20px;
  float: right;
  margin-right: 8px;
  padding: 6px 14px;
  background-color: var(--toolbar-bg);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  z-index: 100;
  transition: background-color 0.15s, border-color 0.15s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.change-gutter-reset-btn:hover {
  background-color: var(--hover-bg);
  border-color: var(--text-muted);
}
```

**Step 4: Verify build**

Run: `pnpm typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat: add CSS styles for change gutter"
```

---

### Task 9: Wire into App class

**Files:**
- Modify: `src/renderer.ts:7-28` (imports), `src/renderer.ts:58-67` (members), `src/renderer.ts:126-131` (init), `src/renderer.ts:428-434` (loadFile), `src/renderer.ts:474-486` (handleFileChange), `src/renderer.ts:491-508` (handleFileDelete), `src/renderer.ts:683-692` (destroy)

**Step 1: Add imports**

In `src/renderer.ts`, add `createChangeGutter` and `ChangeGutter` to the components import (line 7-23):

```ts
import {
  createMarkdownViewer,
  createDropZone,
  createToolbar,
  createStatusBar,
  createZoomController,
  createPreferencesPanel,
  createCopyDropdown,
  createChangeGutter,
  Toast,
  type MarkdownViewer,
  type DropZone,
  type Toolbar,
  type StatusBar,
  type ZoomController,
  type PreferencesPanel,
  type CopyDropdown,
  type ChangeGutter,
} from './renderer/components';
```

Add `DiffService` to the services import (line 24-28):

```ts
import {
  createDocumentCopyService,
  DiffService,
  type DocumentCopyService,
  type CopyDocumentType,
} from './renderer/services';
```

**Step 2: Add class members**

In the `App` class, after the `toast` member (line 67), add:

```ts
  private diffService: DiffService | null = null;
  private changeGutter: ChangeGutter | null = null;
```

**Step 3: Initialize in initializeComponents**

In `initializeComponents()`, after `this.toast = new Toast();` (line 130), add:

```ts
    // Create diff service and change gutter
    this.diffService = new DiffService();
    this.changeGutter = createChangeGutter({
      scrollContainer: viewerElement,
      contentContainer: viewerContainer,
      onReset: () => this.handleResetBaseline(),
    });
```

**Step 4: Set baseline in loadFile**

In `loadFile()`, after `await this.markdownViewer?.render(result.content ?? '', filePath);` (line 428), add:

```ts
      // Set baseline for change tracking
      this.diffService?.setBaseline(result.content ?? '');
      this.changeGutter?.clearIndicators();
```

**Step 5: Compute diff in handleFileChange**

In `handleFileChange()`, after `await this.markdownViewer?.render(event.content, event.filePath);` (line 482), add:

```ts
      // Update change gutter
      if (this.diffService && this.changeGutter) {
        const diff = this.diffService.computeDiff(event.content);
        this.changeGutter.applyChanges(diff);
      }
```

**Step 6: Clear on file delete**

In `handleFileDelete()`, after `this.markdownViewer?.clear();` (line 501), add:

```ts
    this.diffService?.clearBaseline();
    this.changeGutter?.clearIndicators();
```

**Step 7: Add handleResetBaseline method**

Add a new method in the App class (after `handleFileDelete`):

```ts
  private handleResetBaseline(): void {
    const content = this.markdownViewer?.getState().content;
    if (content !== undefined && this.diffService) {
      this.diffService.setBaseline(content);
    }
    this.changeGutter?.clearIndicators();
  }
```

**Step 8: Cleanup in destroy**

In `destroy()`, after `this.copyDropdown?.destroy();` (line 691), add:

```ts
    this.changeGutter?.destroy();
```

**Step 9: Verify types compile**

Run: `pnpm typecheck`
Expected: No errors

**Step 10: Run all tests**

Run: `pnpm test`
Expected: ALL PASS

**Step 11: Commit**

```bash
git add src/renderer.ts
git commit -m "feat: wire change gutter into App lifecycle"
```

---

### Task 10: Final verification

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

Run: `pnpm build`
Expected: Build succeeds

**Step 5: Commit any fixups if needed, otherwise done**
