# Live Mermaid Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While editing a mermaid block, show the rendered diagram above the source and update it in near-realtime as the user types. Generalise the mechanism so any plugin that renders a fenced code block can opt in.

**Architecture:** A new optional plugin capability `PreviewablePlugin` (`matchesSlice`, `extractSource`, `renderPreview`, `applySourceToRaw`) and one new component `PreviewableSourceEditor` that owns the preview-above-textarea editing surface. `EditModeController.startEdit` gains a single new branch that opens the previewable editor for slices owned by a previewable plugin; mermaid is the first implementer.

**Tech Stack:** TypeScript, Vitest (`environment: 'node'`, opt into jsdom per-file via `// @vitest-environment jsdom`), the existing `mermaid` module (already module-mocked in `MermaidPlugin.test.ts`).

**Reference spec:** `docs/superpowers/specs/2026-05-19-mermaid-live-preview-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/plugins/types/preview.ts` (create) | Declares the `PreviewablePlugin` interface and a `isPreviewablePlugin` runtime type-guard. No runtime behaviour. |
| `src/plugins/core/PluginManager.ts` (modify) | Adds `getPreviewablePlugins()` returning the subset of enabled plugins that implement the optional capability. |
| `src/plugins/builtin/MermaidPlugin.ts` (modify) | Adds the four methods: `matchesSlice`, `extractSource`, `renderPreview`, `applySourceToRaw`. Existing `apply` and `postRender` paths unchanged. |
| `src/renderer/components/PreviewableSourceEditor.ts` (create) | One editing session. Builds preview/error-chip/textarea DOM, drives debounced re-render with race control, idempotent commit. |
| `src/renderer/components/EditModeController.ts` (modify) | `findPreviewablePluginFor(slice)` lookup, one new branch in `startEdit`, dispatch in `commitActiveEdit`. Factor `commitRawEdit`'s post-update + re-render path into a shared `applyRawCommit` helper. |
| `src/index.css` (modify) | Styles for `.preview-source-preview`, `.preview-source-error`. |
| `tests/unit/plugins/builtin/MermaidPlugin.test.ts` (modify) | Add suites for the four new methods. |
| `tests/unit/renderer/components/PreviewableSourceEditor.test.ts` (create) | DOM-lifecycle, debounced render, race control, error chip, commit. |
| `tests/unit/renderer/components/EditModeController.test.ts` (modify) | Mermaid slice → previewable editor; other code blocks → raw editor; paragraph → WYSIWYG; commit updates slice. |

**DOM-construction note:** test fixtures build DOM with `element.insertAdjacentHTML('afterbegin', html)` and production re-renders use `replaceChildren()` + `insertAdjacentHTML('afterbegin', html)`. Matches the existing slice-menu code in `EditModeController`.

---

## Task 1: `PreviewablePlugin` interface + type guard

**Files:**
- Create: `src/plugins/types/preview.ts`

This is a pure type declaration. No tests; subsequent tasks exercise it through their consumers.

- [ ] **Step 1: Create the file**

```ts
/**
 * PreviewablePlugin - Optional plugin capability for live-preview editing.
 *
 * A plugin that owns a particular kind of slice (e.g. MermaidPlugin owns
 * ```mermaid fences) implements this so the editor can give the user a
 * live-preview-above-source editing surface. The four methods are stateless
 * on the plugin: matchesSlice/extractSource/applySourceToRaw are pure;
 * renderPreview is async and mutates the target element.
 */
import type { MarkdownPlugin } from '@shared/types';
import type { MarkdownSlice } from '../../renderer/services/MarkdownSlicer';

export interface PreviewablePlugin {
  /** Does this plugin own the given slice? Fast and side-effect-free. */
  matchesSlice(slice: MarkdownSlice): boolean;

  /** Extract the user-editable source from the slice's raw markdown
   *  (e.g. strip ```mermaid fences). */
  extractSource(slice: MarkdownSlice): string;

  /** Render `source` into `target`, replacing its contents on success.
   *  MUST NOT throw — errors are returned so the caller can keep the
   *  previous good preview visible. On `{ ok: false }` `target` MUST
   *  be left unchanged. */
  renderPreview(
    source: string,
    target: HTMLElement,
  ): Promise<{ ok: true } | { ok: false; error: string }>;

  /** Inverse of extractSource — wrap the edited source back into a full
   *  slice raw. Implementations may consult `slice.raw` to preserve
   *  details like a fence's info-string. */
  applySourceToRaw(slice: MarkdownSlice, source: string): string;
}

/** Runtime duck-type check. Returns true when `plugin` implements all four
 *  PreviewablePlugin methods. */
export function isPreviewablePlugin(
  plugin: MarkdownPlugin,
): plugin is MarkdownPlugin & PreviewablePlugin {
  const p = plugin as Partial<PreviewablePlugin>;
  return typeof p.matchesSlice === 'function'
      && typeof p.extractSource === 'function'
      && typeof p.renderPreview === 'function'
      && typeof p.applySourceToRaw === 'function';
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/types/preview.ts
git commit -m "feat: declare PreviewablePlugin capability interface"
```

---

## Task 2: `PluginManager.getPreviewablePlugins()`

**Files:**
- Modify: `src/plugins/core/PluginManager.ts`
- Test: `tests/unit/plugins/core/PluginManager.test.ts`

- [ ] **Step 1: Write the failing test (append a new describe block)**

```ts
import {
  isPreviewablePlugin,
  type PreviewablePlugin,
} from '@plugins/types/preview';
import type { MarkdownPlugin } from '@shared/types';

function fakePreviewablePlugin(id: string): MarkdownPlugin & PreviewablePlugin {
  return {
    metadata: { id, name: id, version: '1.0.0', description: '' },
    matchesSlice: () => false,
    extractSource: () => '',
    renderPreview: async () => ({ ok: true }),
    applySourceToRaw: (_s, source) => source,
  };
}

describe('getPreviewablePlugins', () => {
  it('returns only enabled plugins that implement the previewable capability', async () => {
    const pm = new PluginManager();
    pm.registerPluginFactory('mermaid-like', () => fakePreviewablePlugin('mermaid-like'));
    pm.registerPluginFactory('plain', () => ({
      metadata: { id: 'plain', name: 'plain', version: '1.0.0', description: '' },
    }));
    await pm.enablePlugin('mermaid-like');
    await pm.enablePlugin('plain');

    const previewable = pm.getPreviewablePlugins();
    expect(previewable).toHaveLength(1);
    expect(isPreviewablePlugin(previewable[0]!)).toBe(true);
    expect(previewable[0]!.metadata.id).toBe('mermaid-like');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/plugins/core/PluginManager.test.ts`
Expected: FAIL — `pm.getPreviewablePlugins is not a function`.

- [ ] **Step 3: Add the implementation**

Add an import at the top of `src/plugins/core/PluginManager.ts`:

```ts
import { isPreviewablePlugin, type PreviewablePlugin } from '../types/preview';
import type { MarkdownPlugin } from '@shared/types';
```

Add this method to the `PluginManager` class near `getPlugin`:

```ts
  /**
   * Return all enabled plugins that implement the PreviewablePlugin
   * capability. Order matches the order plugins were enabled.
   */
  getPreviewablePlugins(): (MarkdownPlugin & PreviewablePlugin)[] {
    const result: (MarkdownPlugin & PreviewablePlugin)[] = [];
    for (const id of this.renderer.getEnabledPlugins()) {
      const plugin = this.renderer.getPlugin(id);
      if (plugin && isPreviewablePlugin(plugin)) {
        result.push(plugin);
      }
    }
    return result;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/plugins/core/PluginManager.test.ts`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/core/PluginManager.ts tests/unit/plugins/core/PluginManager.test.ts
git commit -m "feat: PluginManager.getPreviewablePlugins"
```

---

## Task 3: `MermaidPlugin.matchesSlice`

**Files:**
- Modify: `src/plugins/builtin/MermaidPlugin.ts`
- Test: `tests/unit/plugins/builtin/MermaidPlugin.test.ts`

- [ ] **Step 1: Write the failing test (append a new describe block)**

```ts
import type { MarkdownSlice } from '@renderer/services/MarkdownSlicer';

function slice(partial: Partial<MarkdownSlice>): MarkdownSlice {
  return {
    index: 0,
    type: 'code',
    raw: '',
    startLine: 0,
    endLine: 0,
    ...partial,
  };
}

describe('matchesSlice', () => {
  it('returns true for a code slice with a ```mermaid opening fence', () => {
    expect(plugin.matchesSlice(slice({ raw: '```mermaid\nA --> B\n```' }))).toBe(true);
  });

  it('returns true when the mermaid fence has an info-string suffix', () => {
    expect(plugin.matchesSlice(slice({ raw: '```mermaid theme=dark\nA --> B\n```' }))).toBe(true);
  });

  it('returns false for a code slice in another language', () => {
    expect(plugin.matchesSlice(slice({ raw: '```js\nconsole.log(1);\n```' }))).toBe(false);
  });

  it('returns false for non-code slice types', () => {
    expect(plugin.matchesSlice(slice({ type: 'paragraph', raw: 'mermaid' }))).toBe(false);
  });

  it('returns false when the slice has no opening fence', () => {
    expect(plugin.matchesSlice(slice({ raw: 'graph TD\nA --> B' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/plugins/builtin/MermaidPlugin.test.ts`
Expected: FAIL — `plugin.matchesSlice is not a function`.

- [ ] **Step 3: Add the implementation**

Add an import at the top of `src/plugins/builtin/MermaidPlugin.ts`:

```ts
import type { PreviewablePlugin } from '../types/preview';
import type { MarkdownSlice } from '../../renderer/services/MarkdownSlicer';
```

Change the class signature:

```ts
export class MermaidPlugin implements MarkdownPlugin, PreviewablePlugin {
```

Add the method to the class:

```ts
  matchesSlice(slice: MarkdownSlice): boolean {
    if (slice.type !== 'code') return false;
    const firstLine = slice.raw.trimStart().split('\n', 1)[0] ?? '';
    return /^```mermaid\b/.test(firstLine);
  }
```

The class will fail to compile (PreviewablePlugin is missing three more methods). To keep typecheck green until the next tasks land, add stubs that throw:

```ts
  extractSource(_slice: MarkdownSlice): string {
    throw new Error('not implemented');
  }
  async renderPreview(
    _source: string,
    _target: HTMLElement,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    throw new Error('not implemented');
  }
  applySourceToRaw(_slice: MarkdownSlice, _source: string): string {
    throw new Error('not implemented');
  }
```

Tasks 4-6 replace each stub with a real implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/plugins/builtin/MermaidPlugin.test.ts`
Expected: PASS — matchesSlice tests pass; the stubbed methods aren't exercised yet.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/builtin/MermaidPlugin.ts tests/unit/plugins/builtin/MermaidPlugin.test.ts
git commit -m "feat: MermaidPlugin.matchesSlice"
```

---

## Task 4: `MermaidPlugin.extractSource`

**Files:**
- Modify: `src/plugins/builtin/MermaidPlugin.ts`
- Test: `tests/unit/plugins/builtin/MermaidPlugin.test.ts`

- [ ] **Step 1: Write the failing test (append a new describe block)**

```ts
describe('extractSource', () => {
  it('strips opening ```mermaid fence and closing ``` fence', () => {
    const s = slice({ raw: '```mermaid\ngraph TD\nA --> B\n```' });
    expect(plugin.extractSource(s)).toBe('graph TD\nA --> B');
  });

  it('strips opening fence with info-string suffix', () => {
    const s = slice({ raw: '```mermaid theme=dark\ngraph TD\nA --> B\n```' });
    expect(plugin.extractSource(s)).toBe('graph TD\nA --> B');
  });

  it('preserves blank lines and trailing whitespace inside the content', () => {
    const s = slice({ raw: '```mermaid\ngraph TD\n\n  A --> B\n```' });
    expect(plugin.extractSource(s)).toBe('graph TD\n\n  A --> B');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/plugins/builtin/MermaidPlugin.test.ts`
Expected: FAIL — `extractSource` throws `not implemented`.

- [ ] **Step 3: Replace the stub**

In `src/plugins/builtin/MermaidPlugin.ts`, replace the `extractSource` stub with:

```ts
  extractSource(slice: MarkdownSlice): string {
    const lines = slice.raw.split('\n');
    let start = 0;
    let end = lines.length;
    if (lines[0]?.trimStart().startsWith('```mermaid')) start = 1;
    if (lines[lines.length - 1]?.trim() === '```') end = lines.length - 1;
    return lines.slice(start, end).join('\n');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/plugins/builtin/MermaidPlugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/builtin/MermaidPlugin.ts tests/unit/plugins/builtin/MermaidPlugin.test.ts
git commit -m "feat: MermaidPlugin.extractSource"
```

---

## Task 5: `MermaidPlugin.applySourceToRaw`

**Files:**
- Modify: `src/plugins/builtin/MermaidPlugin.ts`
- Test: `tests/unit/plugins/builtin/MermaidPlugin.test.ts`

- [ ] **Step 1: Write the failing test (append a new describe block)**

```ts
describe('applySourceToRaw', () => {
  it("re-wraps source with the slice's original opening info-string", () => {
    const s = slice({ raw: '```mermaid\nold\n```' });
    expect(plugin.applySourceToRaw(s, 'graph TD\nA --> B')).toBe(
      '```mermaid\ngraph TD\nA --> B\n```',
    );
  });

  it('preserves an info-string suffix on the opening fence', () => {
    const s = slice({ raw: '```mermaid theme=dark\nold\n```' });
    expect(plugin.applySourceToRaw(s, 'graph TD\nA --> B')).toBe(
      '```mermaid theme=dark\ngraph TD\nA --> B\n```',
    );
  });

  it('falls back to "mermaid" when slice.raw has no recognisable opening fence', () => {
    const s = slice({ raw: 'no fence' });
    expect(plugin.applySourceToRaw(s, 'graph TD')).toBe('```mermaid\ngraph TD\n```');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/plugins/builtin/MermaidPlugin.test.ts`
Expected: FAIL — `applySourceToRaw` throws `not implemented`.

- [ ] **Step 3: Replace the stub**

```ts
  applySourceToRaw(slice: MarkdownSlice, source: string): string {
    const firstLine = slice.raw.trimStart().split('\n', 1)[0] ?? '';
    const match = firstLine.match(/^```(.*)$/);
    const info = match?.[1] ?? 'mermaid';
    return '```' + info + '\n' + source + '\n```';
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/plugins/builtin/MermaidPlugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/builtin/MermaidPlugin.ts tests/unit/plugins/builtin/MermaidPlugin.test.ts
git commit -m "feat: MermaidPlugin.applySourceToRaw preserves info-string"
```

---

## Task 6: `MermaidPlugin.renderPreview`

**Files:**
- Modify: `src/plugins/builtin/MermaidPlugin.ts`
- Test: `tests/unit/plugins/builtin/MermaidPlugin.test.ts`

- [ ] **Step 1: Write the failing test (append a new describe block)**

```ts
/**
 * @vitest-environment jsdom
 */
// NOTE: This describe needs the DOM; ensure the file's first-line annotation
// is `@vitest-environment jsdom`. The existing MermaidPlugin.test.ts already
// uses jsdom — if not, add the annotation to the top of the file.

describe('renderPreview', () => {
  it('replaces target contents with rendered SVG on success', async () => {
    const target = document.createElement('div');
    target.textContent = 'placeholder';
    const result = await plugin.renderPreview('graph TD\nA --> B', target);
    expect(result).toEqual({ ok: true });
    expect(target.children.length).toBe(1);
    expect(target.children[0]!.tagName.toLowerCase()).toBe('svg');
    expect(target.textContent).toBe('Mock SVG');
  });

  it('leaves target untouched and returns the error on failure', async () => {
    const mermaid = (await import('mermaid')).default;
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('Parse error'));
    const target = document.createElement('div');
    target.textContent = 'previous good preview';
    const result = await plugin.renderPreview('bogus', target);
    expect(result).toEqual({ ok: false, error: 'Parse error' });
    expect(target.textContent).toBe('previous good preview');
  });

  it('returns an error when the mermaid library is not initialised', async () => {
    const uninit = new MermaidPlugin();
    const target = document.createElement('div');
    const result = await uninit.renderPreview('graph TD', target);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not initialised/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/plugins/builtin/MermaidPlugin.test.ts`
Expected: FAIL — `renderPreview` throws `not implemented`.

- [ ] **Step 3: Replace the stub**

```ts
  async renderPreview(
    source: string,
    target: HTMLElement,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.mermaid) return { ok: false, error: 'Mermaid not initialised' };
    try {
      const id = `mermaid-preview-${this.diagramCounter++}`;
      const { svg } = await this.mermaid.render(id, source);
      target.replaceChildren();
      target.insertAdjacentHTML('afterbegin', svg);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/plugins/builtin/MermaidPlugin.test.ts`
Expected: PASS — all MermaidPlugin tests green.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/builtin/MermaidPlugin.ts tests/unit/plugins/builtin/MermaidPlugin.test.ts
git commit -m "feat: MermaidPlugin.renderPreview with contract-conforming error handling"
```

---

## Task 7: `PreviewableSourceEditor` lifecycle (start + idempotent commit)

**Files:**
- Create: `src/renderer/components/PreviewableSourceEditor.ts`
- Test: `tests/unit/renderer/components/PreviewableSourceEditor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { PreviewableSourceEditor } from '../../../../src/renderer/components/PreviewableSourceEditor';
import type { PreviewablePlugin } from '../../../../src/plugins/types/preview';
import type { MarkdownSlice } from '../../../../src/renderer/services/MarkdownSlicer';
import type { MarkdownPlugin } from '../../../../src/shared/types';

function contentEl(html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'slice-content';
  el.insertAdjacentHTML('afterbegin', html);
  document.body.appendChild(el);
  return el;
}

function slice(partial: Partial<MarkdownSlice> = {}): MarkdownSlice {
  return { index: 0, type: 'code', raw: '```mermaid\nA --> B\n```', startLine: 0, endLine: 2, ...partial };
}

function fakePlugin(overrides: Partial<PreviewablePlugin> = {}): MarkdownPlugin & PreviewablePlugin {
  return {
    metadata: { id: 'fake', name: 'fake', version: '1.0.0', description: '' },
    matchesSlice: () => true,
    extractSource: () => 'A --> B',
    renderPreview: vi.fn(async () => ({ ok: true })),
    applySourceToRaw: (_s, source) => '```mermaid\n' + source + '\n```',
    ...overrides,
  };
}

describe('PreviewableSourceEditor lifecycle', () => {
  it('start() builds preview/error-chip/textarea structure inside contentEl', () => {
    const el = contentEl('<div class="mermaid-container"><svg>old</svg></div>');
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit: vi.fn() });
    editor.start();
    expect(el.querySelector('.preview-source-preview')).not.toBe(null);
    expect(el.querySelector('.preview-source-error')).not.toBe(null);
    expect(el.querySelector('textarea.slice-raw-editor')).not.toBe(null);
    // existing rendered SVG was moved into the preview area
    const movedSvg = el.querySelector('.preview-source-preview .mermaid-container svg');
    expect(movedSvg).not.toBe(null);
    expect(movedSvg!.textContent).toBe('old');
  });

  it('start() seeds textarea with plugin.extractSource and focuses it', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit: vi.fn() });
    editor.start();
    const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(ta.value).toBe('A --> B');
    expect(document.activeElement).toBe(ta);
  });

  it('start() hides the error chip initially', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit: vi.fn() });
    editor.start();
    expect(el.querySelector<HTMLElement>('.preview-source-error')!.hidden).toBe(true);
  });

  it('commit() calls plugin.applySourceToRaw with the textarea value and forwards to onCommit', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const onCommit = vi.fn();
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit });
    editor.start();
    el.querySelector<HTMLTextAreaElement>('textarea')!.value = 'C --> D';
    editor.commit();
    expect(onCommit).toHaveBeenCalledWith('```mermaid\nC --> D\n```');
  });

  it('commit() is idempotent — a second call is a no-op', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const onCommit = vi.fn();
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit });
    editor.start();
    editor.commit();
    editor.commit();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: FAIL — cannot resolve `PreviewableSourceEditor`.

- [ ] **Step 3: Write the minimal implementation**

```ts
/**
 * PreviewableSourceEditor - Drives a "preview above source" editing session
 * for a slice owned by a PreviewablePlugin.
 *
 * Layout it builds inside the passed-in `.slice-content`:
 *
 *   <div class="slice-content">
 *     <div class="preview-source-preview">   ← preview (top, populated initially
 *                                              with the existing rendered content
 *                                              moved from the slice-content)
 *     <div class="preview-source-error" hidden>
 *       <span class="preview-source-error-text"></span>
 *     <textarea class="slice-raw-editor">    ← editor (bottom)
 *
 * Subsequent tasks add: debounced re-render on input (Task 8), race control
 * (Task 9), error chip toggling (Task 10), Esc-commits (Task 11).
 */
import type { MarkdownSlice } from '../services/MarkdownSlicer';
import type { PreviewablePlugin } from '../../plugins/types/preview';

export interface PreviewableSourceEditorCallbacks {
  /** Called once when the session commits, with the slice's new raw markdown. */
  onCommit: (newRaw: string) => void;
}

export class PreviewableSourceEditor {
  private el: HTMLElement;
  private slice: MarkdownSlice;
  private plugin: PreviewablePlugin;
  private callbacks: PreviewableSourceEditorCallbacks;
  private committed = false;
  private previewEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private errorTextEl!: HTMLElement;
  private textarea!: HTMLTextAreaElement;

  constructor(
    el: HTMLElement,
    slice: MarkdownSlice,
    plugin: PreviewablePlugin,
    callbacks: PreviewableSourceEditorCallbacks,
  ) {
    this.el = el;
    this.slice = slice;
    this.plugin = plugin;
    this.callbacks = callbacks;
  }

  start(): void {
    // Capture the slice-content's current children (the existing rendered
    // preview, e.g. a <div.mermaid-container> with SVG) — we'll move them
    // into the new preview area below.
    const existingChildren = Array.from(this.el.childNodes);

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'preview-source-preview';
    for (const child of existingChildren) this.previewEl.appendChild(child);

    this.errorEl = document.createElement('div');
    this.errorEl.className = 'preview-source-error';
    this.errorEl.hidden = true;
    this.errorTextEl = document.createElement('span');
    this.errorTextEl.className = 'preview-source-error-text';
    this.errorEl.appendChild(this.errorTextEl);

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'slice-raw-editor';
    this.textarea.spellcheck = false;
    this.textarea.value = this.plugin.extractSource(this.slice);

    this.el.replaceChildren(this.previewEl, this.errorEl, this.textarea);
    this.textarea.focus();
  }

  commit(): void {
    if (this.committed) return;
    this.committed = true;
    const newRaw = this.plugin.applySourceToRaw(this.slice, this.textarea.value);
    this.callbacks.onCommit(newRaw);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/PreviewableSourceEditor.ts tests/unit/renderer/components/PreviewableSourceEditor.test.ts
git commit -m "feat: add PreviewableSourceEditor lifecycle and commit"
```

---

## Task 8: `PreviewableSourceEditor` — debounced renderPreview on input

**Files:**
- Modify: `src/renderer/components/PreviewableSourceEditor.ts`
- Test: `tests/unit/renderer/components/PreviewableSourceEditor.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('PreviewableSourceEditor debounced render', () => {
  it('calls plugin.renderPreview after a 250ms pause in typing', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"></div>');
      const plugin = fakePlugin();
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = 'X --> Y';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      expect(plugin.renderPreview).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(plugin.renderPreview).toHaveBeenCalledTimes(1);
      expect(plugin.renderPreview).toHaveBeenCalledWith('X --> Y', expect.any(HTMLElement));
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces rapid keystrokes into one render after the pause', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"></div>');
      const plugin = fakePlugin();
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      for (const v of ['a', 'ab', 'abc', 'abcd']) {
        ta.value = v;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(100); // less than 250ms
      }
      expect(plugin.renderPreview).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(plugin.renderPreview).toHaveBeenCalledTimes(1);
      expect(plugin.renderPreview).toHaveBeenCalledWith('abcd', expect.any(HTMLElement));
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces preview contents on { ok: true }', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"><svg>old</svg></div>');
      const plugin = fakePlugin({
        renderPreview: vi.fn(async (_src, target) => {
          target.replaceChildren();
          target.insertAdjacentHTML('afterbegin', '<svg>new</svg>');
          return { ok: true };
        }),
      });
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = 'X --> Y';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTimersAsync();
      const previewSvg = el.querySelector('.preview-source-preview > svg');
      expect(previewSvg).not.toBe(null);
      expect(previewSvg!.textContent).toBe('new');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending debounced render when commit is called', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"></div>');
      const plugin = fakePlugin();
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = 'X --> Y';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      editor.commit();
      await vi.advanceTimersByTimeAsync(500);
      expect(plugin.renderPreview).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: FAIL — no debounced render wired.

- [ ] **Step 3: Add the implementation**

Add a constant near the top of `src/renderer/components/PreviewableSourceEditor.ts`:

```ts
const DEBOUNCE_MS = 250;
```

Add a field on the class:

```ts
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
```

Extend `start()` to wire the input listener (add after `this.textarea.focus();`):

```ts
    this.textarea.addEventListener('input', this.onInput);
```

Extend `commit()` to clear the pending timer FIRST (before the idempotence guard's return is hit on later calls):

```ts
  commit(): void {
    if (this.committed) return;
    this.committed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.textarea.removeEventListener('input', this.onInput);
    const newRaw = this.plugin.applySourceToRaw(this.slice, this.textarea.value);
    this.callbacks.onCommit(newRaw);
  }
```

Add the handler as a bound class field (so add/removeEventListener share the reference):

```ts
  private readonly onInput = (): void => {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runRender();
    }, DEBOUNCE_MS);
  };

  private async runRender(): Promise<void> {
    const source = this.textarea.value;
    await this.plugin.renderPreview(source, this.previewEl);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/PreviewableSourceEditor.ts tests/unit/renderer/components/PreviewableSourceEditor.test.ts
git commit -m "feat: PreviewableSourceEditor debounced re-render on input"
```

---

## Task 9: `PreviewableSourceEditor` — race control (monotonic requestId)

**Files:**
- Modify: `src/renderer/components/PreviewableSourceEditor.ts`
- Test: `tests/unit/renderer/components/PreviewableSourceEditor.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('PreviewableSourceEditor race control', () => {
  it('drops a slow earlier render result when a newer render has fired', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container">initial</div>');
      let resolveFirst!: () => void;
      const firstPromise = new Promise<void>((r) => { resolveFirst = r; });
      const renderPreview = vi.fn(async (source: string, target: HTMLElement) => {
        if (source === 'slow') {
          await firstPromise;
          target.replaceChildren();
          target.insertAdjacentHTML('afterbegin', '<svg>slow</svg>');
          return { ok: true as const };
        }
        target.replaceChildren();
        target.insertAdjacentHTML('afterbegin', '<svg>fast</svg>');
        return { ok: true as const };
      });
      const plugin = fakePlugin({ renderPreview });
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;

      ta.value = 'slow';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250); // first render starts but is awaiting

      ta.value = 'fast';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250); // second render starts and completes
      await vi.runAllTimersAsync();

      // Now release the slow first render — it should NOT overwrite "fast".
      resolveFirst();
      await vi.runAllTimersAsync();

      const previewSvg = el.querySelector('.preview-source-preview > svg');
      expect(previewSvg).not.toBe(null);
      expect(previewSvg!.textContent).toBe('fast');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: FAIL — slow render's `target.replaceChildren()` clobbers the fast result.

- [ ] **Step 3: Add the implementation**

Race control needs the plugin's `renderPreview` to be allowed to mutate `target`, but only the LATEST render result should be visible. We achieve this by giving each render its own scratch container and only swapping the scratch into the live preview if it's still the latest.

Add a field:

```ts
  private latestRenderId = 0;
```

Replace `runRender` with:

```ts
  private async runRender(): Promise<void> {
    const myId = ++this.latestRenderId;
    const source = this.textarea.value;
    const scratch = document.createElement('div');
    const result = await this.plugin.renderPreview(source, scratch);
    if (this.committed || myId !== this.latestRenderId) return;
    if (result.ok) {
      this.previewEl.replaceChildren(...Array.from(scratch.childNodes));
    }
    // {ok: false} handling is added in Task 10.
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: PASS (10 tests). The earlier "replaces preview contents on { ok: true }" test still passes because the scratch's SVG node is moved (not cloned) into the preview area.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/PreviewableSourceEditor.ts tests/unit/renderer/components/PreviewableSourceEditor.test.ts
git commit -m "feat: PreviewableSourceEditor — last keystroke wins via monotonic id"
```

---

## Task 10: `PreviewableSourceEditor` — error chip on `{ ok: false }`

**Files:**
- Modify: `src/renderer/components/PreviewableSourceEditor.ts`
- Test: `tests/unit/renderer/components/PreviewableSourceEditor.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('PreviewableSourceEditor error handling', () => {
  it('keeps the previous preview and shows the error chip on { ok: false }', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"><svg>good</svg></div>');
      const plugin = fakePlugin({
        renderPreview: vi.fn(async () => ({ ok: false as const, error: 'Syntax error: foo' })),
      });
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = 'bad';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTimersAsync();

      // Previous preview untouched
      const previewSvg = el.querySelector('.preview-source-preview .mermaid-container svg');
      expect(previewSvg!.textContent).toBe('good');
      // Error chip visible with the message
      const errorChip = el.querySelector<HTMLElement>('.preview-source-error')!;
      expect(errorChip.hidden).toBe(false);
      expect(errorChip.querySelector('.preview-source-error-text')!.textContent).toBe('Syntax error: foo');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the error chip again on the next successful render', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"><svg>good</svg></div>');
      let next: { ok: true } | { ok: false; error: string } = { ok: false, error: 'oops' };
      const plugin = fakePlugin({
        renderPreview: vi.fn(async (_src, target) => {
          if (next.ok) {
            target.replaceChildren();
            target.insertAdjacentHTML('afterbegin', '<svg>new</svg>');
          }
          return next;
        }),
      });
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;

      ta.value = 'bad';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTimersAsync();
      expect(el.querySelector<HTMLElement>('.preview-source-error')!.hidden).toBe(false);

      next = { ok: true };
      ta.value = 'good';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTimersAsync();
      expect(el.querySelector<HTMLElement>('.preview-source-error')!.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: FAIL — error chip never becomes visible.

- [ ] **Step 3: Add the implementation**

Extend `runRender` to surface errors:

```ts
  private async runRender(): Promise<void> {
    const myId = ++this.latestRenderId;
    const source = this.textarea.value;
    const scratch = document.createElement('div');
    const result = await this.plugin.renderPreview(source, scratch);
    if (this.committed || myId !== this.latestRenderId) return;
    if (result.ok) {
      this.previewEl.replaceChildren(...Array.from(scratch.childNodes));
      this.errorEl.hidden = true;
    } else {
      this.errorTextEl.textContent = result.error;
      this.errorEl.hidden = false;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/PreviewableSourceEditor.ts tests/unit/renderer/components/PreviewableSourceEditor.test.ts
git commit -m "feat: PreviewableSourceEditor surfaces render errors via inline chip"
```

---

## Task 11: `PreviewableSourceEditor` — Esc commits

**Files:**
- Modify: `src/renderer/components/PreviewableSourceEditor.ts`
- Test: `tests/unit/renderer/components/PreviewableSourceEditor.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('PreviewableSourceEditor Esc', () => {
  it('Escape on the textarea commits the session', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const onCommit = vi.fn();
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit });
    editor.start();
    const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'C --> D';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onCommit).toHaveBeenCalledWith('```mermaid\nC --> D\n```');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: FAIL — no keydown listener wired.

- [ ] **Step 3: Add the implementation**

Extend `start()` to add the keydown listener (after the input listener):

```ts
    this.textarea.addEventListener('keydown', this.onKeyDown);
```

Extend `commit()` to remove the listener (where the input listener is removed):

```ts
    this.textarea.removeEventListener('input', this.onInput);
    this.textarea.removeEventListener('keydown', this.onKeyDown);
```

Add the handler:

```ts
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.commit();
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/PreviewableSourceEditor.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/PreviewableSourceEditor.ts tests/unit/renderer/components/PreviewableSourceEditor.test.ts
git commit -m "feat: PreviewableSourceEditor commits on Esc"
```

---

## Task 12: `EditModeController` — route mermaid slices to the previewable editor

**Files:**
- Modify: `src/renderer/components/EditModeController.ts`
- Test: `tests/unit/renderer/components/EditModeController.test.ts`

This task adds the routing and the controller-side commit dispatch. It also factors the existing `commitRawEdit`'s re-render path into a shared helper so the previewable commit can reuse it.

- [ ] **Step 1: Write the failing test (append a new describe block)**

```ts
// Place near the other describes in EditModeController.test.ts. Reuse the
// existing setup() and makePluginManager() helpers; extend the stub plugin
// manager with previewable support.

import type { PreviewablePlugin } from '../../../../src/plugins/types/preview';

function makePreviewableManager(): PluginManager {
  const pm = makePluginManager() as unknown as PluginManager & {
    getPreviewablePlugins: () => (PreviewablePlugin & { metadata: unknown })[];
  };
  pm.getPreviewablePlugins = () => [{
    metadata: { id: 'mermaid', name: 'mermaid', version: '1.0.0', description: '' },
    matchesSlice: (s) => s.type === 'code' && /^```mermaid\b/.test(s.raw.trimStart()),
    extractSource: (s) => {
      const lines = s.raw.split('\n');
      return lines.slice(1, -1).join('\n');
    },
    renderPreview: async () => ({ ok: true }),
    applySourceToRaw: (_s, source) => '```mermaid\n' + source + '\n```',
  } as unknown as PreviewablePlugin & { metadata: unknown }];
  return pm;
}

function setupPreviewable(): { container: HTMLElement; controller: EditModeController } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const controller = new EditModeController(container, makePreviewableManager());
  return { container, controller };
}

describe('EditModeController — previewable mermaid editing', () => {
  it('clicking a ```mermaid slice opens the PreviewableSourceEditor (preview + textarea coexist)', async () => {
    const { container, controller } = setupPreviewable();
    await controller.enter('```mermaid\nA --> B\n```');
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    expect(content.querySelector('.preview-source-preview')).not.toBe(null);
    expect(content.querySelector('textarea.slice-raw-editor')).not.toBe(null);
    expect(content.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('A --> B');
  });

  it('clicking a non-mermaid code slice still opens the regular raw editor (no preview area)', async () => {
    const { container, controller } = setupPreviewable();
    await controller.enter('```js\nconsole.log(1);\n```');
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    expect(content.querySelector('.preview-source-preview')).toBe(null);
    expect(content.querySelector('textarea.slice-raw-editor')).not.toBe(null);
  });

  it('clicking a paragraph still opens the WYSIWYG inline editor', async () => {
    const { container, controller } = setupPreviewable();
    await controller.enter('Hello world');
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    expect(content.getAttribute('contenteditable')).toBe('true');
    expect(content.querySelector('.preview-source-preview')).toBe(null);
  });

  it('committing a previewable edit updates the slice raw with the new fenced content', async () => {
    const { container, controller } = setupPreviewable();
    const onContentChange = vi.fn();
    controller.setCallbacks({ onContentChange });
    await controller.enter('```mermaid\nA --> B\n```');
    container.querySelector<HTMLElement>('.slice-content')!.click();
    const ta = container.querySelector<HTMLTextAreaElement>('textarea.slice-raw-editor')!;
    ta.value = 'C --> D';
    controller.commitActiveEditForTest();
    expect(controller.getMarkdown()).toBe('```mermaid\nC --> D\n```');
    expect(onContentChange).toHaveBeenCalledWith('```mermaid\nC --> D\n```');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: FAIL — mermaid slice currently routes to canSerialize fallback (raw editor without preview area).

- [ ] **Step 3: Modify the controller — add imports, fields, route, commit dispatch, shared helper**

Add imports at the top of `src/renderer/components/EditModeController.ts`:

```ts
import { PreviewableSourceEditor } from './PreviewableSourceEditor';
import type { PreviewablePlugin } from '../../plugins/types/preview';
```

Add a field next to `activeInlineEditor` and `activeRawTextarea`:

```ts
  private activePreviewableEditor: PreviewableSourceEditor | null = null;
```

Replace the body of `startEdit` so the previewable branch runs BEFORE the existing canSerialize / WYSIWYG routing:

```ts
  private startEdit(sliceIndex: number): void {
    this.commitActiveEdit();

    const slice = this.slices.find((s) => s.index === sliceIndex);
    const el = this.sliceElements.get(sliceIndex);
    if (!slice || !el) return;

    const contentEl = el.querySelector<HTMLElement>('.slice-content');
    if (!contentEl) return;

    // Previewable plugin opt-in (e.g. mermaid live preview).
    const previewable = this.findPreviewablePluginFor(slice);
    if (previewable) {
      this.activeEditIndex = sliceIndex;
      el.classList.add('slice-editing');
      this.activePreviewableEditor = new PreviewableSourceEditor(
        contentEl, slice, previewable,
        { onCommit: (newRaw) => this.applyRawCommit(sliceIndex, newRaw) },
      );
      this.activePreviewableEditor.start();
      return;
    }

    // Unsupported inline content (or block types canSerialize rejects) → raw editor.
    if (!canSerialize(contentEl)) {
      this.startRawEdit(sliceIndex);
      return;
    }

    this.activeEditIndex = sliceIndex;
    el.classList.add('slice-editing');

    this.activeInlineEditor = new InlineEditor(contentEl, {
      onCommit: (inlineMarkdown) => {
        this.applyInlineCommit(sliceIndex, inlineMarkdown);
      },
      onRequestLink: () => {
        if (this.activeInlineEditor) this.promptAndApplyLink(this.activeInlineEditor);
      },
      onSplit: (beforeMd, afterMd) => {
        this.splitActiveSlice(sliceIndex, beforeMd, afterMd);
      },
      onNavigate: (direction) => {
        this.navigateFromSlice(sliceIndex, direction);
      },
    });
    this.activeInlineEditor.start();
    if (this.toolbarVisible) {
      this.getToolbar().show(contentEl);
      this.refreshToolbarState();
    }
  }
```

Add the lookup helper:

```ts
  private findPreviewablePluginFor(slice: MarkdownSlice): PreviewablePlugin | null {
    const pm = this.pluginManager as PluginManager & {
      getPreviewablePlugins?: () => (PreviewablePlugin & { metadata: unknown })[];
    };
    if (typeof pm.getPreviewablePlugins !== 'function') return null;
    for (const plugin of pm.getPreviewablePlugins()) {
      if (plugin.matchesSlice(slice)) return plugin;
    }
    return null;
  }
```

Update `commitActiveEdit` to dispatch to the previewable editor first:

```ts
  private commitActiveEdit(): void {
    if (this.activeEditIndex === null) return;
    const sliceIndex = this.activeEditIndex;
    this.activeEditIndex = null;

    if (this.activePreviewableEditor) {
      const editor = this.activePreviewableEditor;
      this.activePreviewableEditor = null;
      editor.commit();
      return;
    }
    if (this.activeRawTextarea) {
      this.commitRawEdit(sliceIndex);
      return;
    }
    const editor = this.activeInlineEditor;
    this.activeInlineEditor = null;
    this.toolbar?.hide();
    editor?.commit();
  }
```

Factor the existing post-update re-render logic out of `commitRawEdit` into a shared helper. Locate the existing `commitRawEdit` method; replace its body with a call to the new helper:

```ts
  private commitRawEdit(sliceIndex: number): void {
    const textarea = this.activeRawTextarea;
    this.activeRawTextarea = null;
    if (!textarea) return;
    this.applyRawCommit(sliceIndex, textarea.value);
  }

  /**
   * Shared "raw commit" path used by both the slim raw textarea and the
   * PreviewableSourceEditor. Updates the slice via the slicer, fires
   * onContentChange, and re-renders the slice.
   */
  private applyRawCommit(sliceIndex: number, newRaw: string): void {
    const slice = this.slices.find((s) => s.index === sliceIndex);
    const el = this.sliceElements.get(sliceIndex);
    if (!slice || !el) return;

    if (newRaw !== slice.raw) {
      const result = this.slicer.updateSlice(this.slices, sliceIndex, newRaw);
      this.rawMarkdown = result.markdown;
      this.slices = result.slices;
      this.callbacks.onContentChange?.(this.rawMarkdown);
    }

    el.classList.remove('slice-editing');
    const contentEl = el.querySelector('.slice-content');
    const updatedSlice = this.slices.find((s) => s.index === sliceIndex);
    if (contentEl) {
      const html = this.pluginManager.render(updatedSlice?.raw ?? slice.raw);
      contentEl.replaceChildren();
      contentEl.insertAdjacentHTML('afterbegin', html);
      contentEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        e.stopPropagation();
        this.startEdit(sliceIndex);
      });
      void this.pluginManager.postRender(contentEl as HTMLElement);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: PASS — all suites green, including the four new previewable tests.

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `pnpm test`
Expected: PASS — all suites green.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/EditModeController.ts tests/unit/renderer/components/EditModeController.test.ts
git commit -m "feat: route mermaid slices to PreviewableSourceEditor"
```

---

## Task 13: Styling for preview area + error chip

**Files:**
- Modify: `src/index.css`

No automated test — visual styling, verified manually in Task 14.

- [ ] **Step 1: Append the new rules**

Locate the existing `.slice-content[contenteditable='true']` rule (it sits below `.slice.slice-editing .slice-content::before`). Append the following block after the existing slice-content rules and before the next section comment:

```css
/* Live-preview editor: preview area + error chip + textarea. */
.preview-source-preview {
  /* The preview's natural sizing is whatever the plugin renders (mermaid SVG
   * is `max-width: 100%; height: auto;`). No extra constraints. */
}

.preview-source-error {
  margin: 4px 0 0;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--error-bg, rgba(220, 38, 38, 0.12));
  color: var(--error-text, #b91c1c);
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.preview-source-error[hidden] {
  display: none;
}

.preview-source-preview + .preview-source-error + .slice-raw-editor,
.preview-source-preview + .slice-raw-editor {
  /* Small gap between preview/error and the editor textarea. */
  margin-top: 6px;
}
```

- [ ] **Step 2: Verify no `.ts` regressions**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "style: live-preview editor area and error chip"
```

---

## Task 14: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full type check**

Run: `pnpm typecheck`
Expected: PASS — no errors.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS — all suites green, including the new MermaidPlugin / PreviewableSourceEditor / EditModeController suites.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS. Fix any issues (typical culprits: unused imports, missing types on closures).

- [ ] **Step 4: Manual smoke check**

Run: `pnpm start`

Open a markdown file containing a mermaid diagram (e.g. `site/examples/water-cycle-and-chemistry.md`). Then:

- Enter edit mode (`Cmd+E`). Confirm the mermaid diagram renders.
- Click the mermaid block. Confirm:
  - The diagram stays visible above
  - A textarea appears below with the diagram source (no opening/closing fences)
- Type into the textarea. Confirm:
  - The diagram refreshes ~250ms after you stop typing
  - The previous good diagram stays during invalid intermediate states
- Type something that's clearly invalid (e.g. `graph TX`). Confirm:
  - The last good diagram remains visible
  - A red error chip appears between the diagram and the textarea with the mermaid error message
- Correct the source. Confirm the error chip disappears and the diagram updates.
- Press `Esc`. Confirm:
  - The diagram re-renders with the new source
  - The textarea is gone
- Click a non-mermaid code block (`` ```js ``). Confirm it opens the regular slim raw textarea (no preview area).
- Click a paragraph. Confirm it still opens the WYSIWYG inline editor.

- [ ] **Step 5: Final commit (only if Step 3 required lint fixes)**

```bash
git add -A
git commit -m "chore: lint fixes for live mermaid preview"
```

---

## Self-Review Notes

- **Spec coverage:** plugin contract (Task 1) — declared in dedicated types file; PluginManager surface (Task 2); mermaid implementation (Tasks 3-6); editor component (Tasks 7-11) covering lifecycle, debounced render, race control, error chip, Esc-commit; controller integration (Task 12) including factored `applyRawCommit` so both raw paths share the same re-render code; styling (Task 13); manual smoke for the cases in the spec's data-flow + error matrix (Task 14).
- **Known design follow-up:** the spec calls out that the live render's output may not preserve the `.mermaid-container` wrapper styles. The implementation uses a scratch container (Task 9) so the live render's output is whatever the plugin emits. If mermaid emits raw `<svg>` without the wrapper, mermaid-container-specific CSS (centring, overflow-x) won't apply during the edit session. This is acceptable: the live diagram is bounded by the slice width via SVG `max-width: 100%`. If it looks off in manual smoke, fix as a follow-up by wrapping the scratch contents in `<div class="mermaid-container">` inside `MermaidPlugin.renderPreview`.
- **Type consistency:** `PreviewablePlugin` (`src/plugins/types/preview.ts`) is the single source of truth; both `PluginManager.getPreviewablePlugins` and `EditModeController.findPreviewablePluginFor` use the same type. `PreviewableSourceEditor` callbacks (`onCommit: (newRaw: string) => void`) match how `applyRawCommit` is invoked from the controller. `MermaidPlugin` declares `implements MarkdownPlugin, PreviewablePlugin`, and Task 3 introduces stub throws so the type-check remains green between subtasks.
- **DOM construction:** no raw HTML-string assignment in any new code — `replaceChildren()` + `insertAdjacentHTML('afterbegin', …)` everywhere, matching the existing slice-menu and slice-content commit code in `EditModeController`.
