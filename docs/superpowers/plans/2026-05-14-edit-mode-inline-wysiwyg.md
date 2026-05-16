# Edit Mode: Inline WYSIWYG Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace edit mode's chunky per-segment `<textarea>` with a slim, inline, Notion-style WYSIWYG editor whose formatting shortcuts and floating toolbar produce proper markdown.

**Architecture:** A clicked segment's `.slice-content` becomes `contenteditable`. Formatting operations toggle DOM marks; on commit a scoped serializer walks the inline DOM and emits markdown for five marks (bold, italic, strikethrough, inline code, link). The slice's raw markdown string stays the source of truth. A `canSerialize` guard routes any segment with unsupported inline content to a slim raw-markdown editor instead; a per-segment `Cmd+/` toggle does the same on demand. A floating toolbar (hidden by default) gives button access to the same marks.

**Tech Stack:** TypeScript, Vitest (`environment: 'node'`, opt into jsdom per-file via `// @vitest-environment jsdom`), no new runtime dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-14-edit-mode-inline-wysiwyg-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/renderer/services/inlineMarkdownSerializer.ts` (create) | Pure functions: `serializeInline(root)` DOM→markdown, `canSerialize(root)` guard. No DOM mutation, no state. |
| `src/renderer/components/InlineEditor.ts` (create) | One segment's WYSIWYG session: contenteditable lifecycle, caret, mark toggle via Range, keyboard shortcuts, link insertion. |
| `src/renderer/components/FloatingFormatToolbar.ts` (create) | Floating toolbar: renders buttons, positions above active segment, reflects active-mark state, calls into `InlineEditor`. |
| `src/renderer/components/EditModeController.ts` (modify) | Orchestration: opens `InlineEditor` (WYSIWYG default) or slim raw editor, per-segment raw state, global toolbar-visible state, handle-menu items, `Cmd+/` and `Cmd+Shift+F` shortcuts. |
| `src/index.css` (modify) | Styles for the inline editor caret/focus, the slimmed raw editor, and the floating toolbar. |
| `tests/unit/renderer/services/inlineMarkdownSerializer.test.ts` (create) | Serializer coverage incl. round-trip and `canSerialize`. |
| `tests/unit/renderer/components/InlineEditor.test.ts` (create) | Mark toggle, shortcuts, commit. |
| `tests/unit/renderer/components/FloatingFormatToolbar.test.ts` (create) | Button render, active state, callbacks. |
| `tests/unit/renderer/components/EditModeController.test.ts` (create) | Raw/WYSIWYG routing, toggles, commit flow. |

`tests/unit/renderer/components/` does not exist yet — the first test task that needs it creates it implicitly via the file path.

**DOM-construction note:** test fixtures build DOM with `element.insertAdjacentHTML('afterbegin', html)` and production re-renders use `replaceChildren()` + `insertAdjacentHTML('afterbegin', html)`. This matches the existing `EditModeController` slice-menu code and avoids a raw `innerHTML` assignment.

---

## Task 1: Serializer — text nodes and flat marks

**Files:**
- Create: `src/renderer/services/inlineMarkdownSerializer.ts`
- Test: `tests/unit/renderer/services/inlineMarkdownSerializer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { serializeInline } from '../../../../src/renderer/services/inlineMarkdownSerializer';

function div(html: string): HTMLElement {
  const el = document.createElement('div');
  el.insertAdjacentHTML('afterbegin', html);
  return el;
}

describe('serializeInline — text and flat marks', () => {
  it('returns plain text unchanged', () => {
    expect(serializeInline(div('Scala 2.13 is supported.'))).toBe('Scala 2.13 is supported.');
  });

  it('serializes strong and b to **', () => {
    expect(serializeInline(div('a <strong>bold</strong> b'))).toBe('a **bold** b');
    expect(serializeInline(div('a <b>bold</b> b'))).toBe('a **bold** b');
  });

  it('serializes em and i to *', () => {
    expect(serializeInline(div('a <em>it</em> b'))).toBe('a *it* b');
    expect(serializeInline(div('a <i>it</i> b'))).toBe('a *it* b');
  });

  it('serializes del and s to ~~', () => {
    expect(serializeInline(div('a <del>x</del> b'))).toBe('a ~~x~~ b');
    expect(serializeInline(div('a <s>x</s> b'))).toBe('a ~~x~~ b');
  });

  it('serializes code to backticks using raw text content', () => {
    expect(serializeInline(div('use <code>npm i</code> now'))).toBe('use `npm i` now');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/services/inlineMarkdownSerializer.test.ts`
Expected: FAIL — cannot resolve `inlineMarkdownSerializer`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * inlineMarkdownSerializer - Converts a segment's inline DOM back into markdown.
 *
 * Edit mode's WYSIWYG surface lets the user toggle a fixed set of inline marks
 * (bold, italic, strikethrough, inline code, link). On commit, the inline DOM
 * of a slice's `.slice-content` is walked here and emitted as markdown. Only
 * the supported tag set is handled; `canSerialize` (added later) guards against
 * anything else so source is never silently mangled.
 */

/**
 * Serialize the inline children of `root` to a markdown string.
 */
export function serializeInline(root: HTMLElement): string {
  let out = '';
  root.childNodes.forEach((node) => {
    out += serializeNode(node);
  });
  return out;
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const el = node as HTMLElement;
  const inner = Array.from(el.childNodes).map(serializeNode).join('');
  switch (el.tagName) {
    case 'STRONG':
    case 'B':
      return `**${inner}**`;
    case 'EM':
    case 'I':
      return `*${inner}*`;
    case 'DEL':
    case 'S':
      return `~~${inner}~~`;
    case 'CODE':
      return `\`${el.textContent ?? ''}\``;
    default:
      return inner;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/services/inlineMarkdownSerializer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/services/inlineMarkdownSerializer.ts tests/unit/renderer/services/inlineMarkdownSerializer.test.ts
git commit -m "feat: serialize inline DOM text and flat marks to markdown"
```

---

## Task 2: Serializer — links, line breaks, nesting, escaping

**Files:**
- Modify: `src/renderer/services/inlineMarkdownSerializer.ts`
- Test: `tests/unit/renderer/services/inlineMarkdownSerializer.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing test file)**

```ts
describe('serializeInline — links, breaks, nesting, escaping', () => {
  it('serializes anchors to [text](href)', () => {
    expect(serializeInline(div('see <a href="https://x.com">the site</a>')))
      .toBe('see [the site](https://x.com)');
  });

  it('serializes br to a newline', () => {
    expect(serializeInline(div('line one<br>line two'))).toBe('line one\nline two');
  });

  it('serializes nested marks', () => {
    expect(serializeInline(div('<strong>bold <em>and italic</em></strong>')))
      .toBe('**bold *and italic***');
  });

  it('escapes literal markdown characters in text nodes', () => {
    expect(serializeInline(div('a literal * and _ and ` and ~ and [ and ]')))
      .toBe('a literal \\* and \\_ and \\` and \\~ and \\[ and \\]');
  });

  it('does not escape inside inline code', () => {
    expect(serializeInline(div('<code>a * b</code>'))).toBe('`a * b`');
  });

  it('round-trips: emphasis text survives markdown -> render -> serialize', () => {
    // markdown-it would render "**only**" as <strong>only</strong>; serializing
    // returns the original syntax.
    expect(serializeInline(div('the <strong>only</strong> version')))
      .toBe('the **only** version');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/services/inlineMarkdownSerializer.test.ts`
Expected: FAIL — anchors return inner text only, `<br>` returns `''`, escaping not applied.

- [ ] **Step 3: Update the implementation**

Replace the body of `serializeNode` and add `escapeText`:

```ts
/** Characters that, appearing literally in rendered text, would be re-parsed
 *  as markdown syntax. Block-level characters (#, -, etc.) are intentionally
 *  not escaped — they are inert inside inline content. */
const ESCAPE_RE = /([\\`*_~[\]])/g;

function escapeText(text: string): string {
  return text.replace(ESCAPE_RE, '\\$1');
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const el = node as HTMLElement;
  const inner = Array.from(el.childNodes).map(serializeNode).join('');
  switch (el.tagName) {
    case 'STRONG':
    case 'B':
      return `**${inner}**`;
    case 'EM':
    case 'I':
      return `*${inner}*`;
    case 'DEL':
    case 'S':
      return `~~${inner}~~`;
    case 'CODE':
      // Raw text content — markdown inside code spans is not interpreted.
      return `\`${el.textContent ?? ''}\``;
    case 'A': {
      const href = el.getAttribute('href') ?? '';
      return `[${inner}](${href})`;
    }
    case 'BR':
      return '\n';
    default:
      return inner;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/services/inlineMarkdownSerializer.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/services/inlineMarkdownSerializer.ts tests/unit/renderer/services/inlineMarkdownSerializer.test.ts
git commit -m "feat: serialize links, breaks, nested marks, escape literal markdown"
```

---

## Task 3: Serializer — `canSerialize` guard

**Files:**
- Modify: `src/renderer/services/inlineMarkdownSerializer.ts`
- Test: `tests/unit/renderer/services/inlineMarkdownSerializer.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { canSerialize } from '../../../../src/renderer/services/inlineMarkdownSerializer';

describe('canSerialize', () => {
  it('accepts content with only supported inline tags', () => {
    expect(canSerialize(div('a <strong>b <em>c</em></strong> <a href="x">d</a>'))).toBe(true);
    expect(canSerialize(div('plain text'))).toBe(true);
    expect(canSerialize(div('line<br>break'))).toBe(true);
  });

  it('rejects content with an inline image', () => {
    expect(canSerialize(div('text <img src="x.png"> more'))).toBe(false);
  });

  it('rejects content with unsupported elements', () => {
    expect(canSerialize(div('text <sup>2</sup>'))).toBe(false);
    expect(canSerialize(div('text <span style="color:red">x</span>'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/services/inlineMarkdownSerializer.test.ts`
Expected: FAIL — `canSerialize` is not exported.

- [ ] **Step 3: Add the implementation**

Append to `src/renderer/services/inlineMarkdownSerializer.ts`:

```ts
/** Element tags the serializer knows how to faithfully emit. */
const SUPPORTED_TAGS = new Set([
  'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'CODE', 'A', 'BR',
]);

/**
 * Returns true when every element inside `root` is one the serializer can
 * faithfully round-trip. When false, the caller must fall back to raw-markdown
 * editing rather than risk mangling the source.
 */
export function canSerialize(root: HTMLElement): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (!SUPPORTED_TAGS.has((node as Element).tagName)) {
      return false;
    }
    node = walker.nextNode();
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/services/inlineMarkdownSerializer.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/services/inlineMarkdownSerializer.ts tests/unit/renderer/services/inlineMarkdownSerializer.test.ts
git commit -m "feat: add canSerialize guard for unsupported inline content"
```

---

## Task 4: `InlineEditor` — contenteditable lifecycle and commit

**Files:**
- Create: `src/renderer/components/InlineEditor.ts`
- Test: `tests/unit/renderer/components/InlineEditor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { InlineEditor } from '../../../../src/renderer/components/InlineEditor';

function contentEl(html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'slice-content';
  el.insertAdjacentHTML('afterbegin', html);
  document.body.appendChild(el);
  return el;
}

describe('InlineEditor lifecycle', () => {
  it('makes the element editable on start and focuses it', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    expect(el.getAttribute('contenteditable')).toBe('true');
    expect(document.activeElement).toBe(el);
  });

  it('commit() passes serialized markdown to onCommit and clears editable', () => {
    const el = contentEl('a <strong>bold</strong> word');
    const onCommit = vi.fn();
    const editor = new InlineEditor(el, { onCommit });
    editor.start();
    editor.commit();
    expect(onCommit).toHaveBeenCalledWith('a **bold** word');
    expect(el.getAttribute('contenteditable')).toBe(null);
  });

  it('commit() is idempotent — a second call does not fire onCommit again', () => {
    const el = contentEl('text');
    const onCommit = vi.fn();
    const editor = new InlineEditor(el, { onCommit });
    editor.start();
    editor.commit();
    editor.commit();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/InlineEditor.test.ts`
Expected: FAIL — cannot resolve `InlineEditor`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * InlineEditor - Manages one segment's WYSIWYG editing session.
 *
 * Makes a slice's `.slice-content` element `contenteditable`, owns the caret
 * and keyboard shortcuts, toggles inline marks via DOM Range manipulation, and
 * on commit hands the serialized markdown back to the caller. It deliberately
 * knows nothing about slices or markdown blocks — `EditModeController` adapts
 * between this and the slice model.
 */
import { serializeInline } from '../services/inlineMarkdownSerializer';

export interface InlineEditorCallbacks {
  /** Called once when the session commits, with the segment's inline markdown. */
  onCommit: (markdown: string) => void;
}

export class InlineEditor {
  private el: HTMLElement;
  private callbacks: InlineEditorCallbacks;
  private committed = false;

  constructor(el: HTMLElement, callbacks: InlineEditorCallbacks) {
    this.el = el;
    this.callbacks = callbacks;
  }

  /** Begin the session: make the element editable and focus it. */
  start(): void {
    this.el.setAttribute('contenteditable', 'true');
    this.el.spellcheck = false;
    this.el.focus();
  }

  /** Serialize the current DOM, hand it to the caller, and end the session. */
  commit(): void {
    if (this.committed) return;
    this.committed = true;
    const markdown = serializeInline(this.el);
    this.el.removeAttribute('contenteditable');
    this.callbacks.onCommit(markdown);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/InlineEditor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/InlineEditor.ts tests/unit/renderer/components/InlineEditor.test.ts
git commit -m "feat: add InlineEditor contenteditable lifecycle and commit"
```

---

## Task 5: `InlineEditor` — mark toggle (wrap / unwrap selection)

**Files:**
- Modify: `src/renderer/components/InlineEditor.ts`
- Test: `tests/unit/renderer/components/InlineEditor.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import type { InlineMark } from '../../../../src/renderer/components/InlineEditor';

function selectAll(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('InlineEditor mark toggle', () => {
  it('wraps the selection in <strong> when bold is toggled on', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    editor.toggleMark('bold' as InlineMark);
    expect(el.querySelector('strong')?.textContent).toBe('hello');
  });

  it('unwraps when the same mark is toggled off over an identical selection', () => {
    const el = contentEl('<strong>hello</strong>');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    editor.toggleMark('bold' as InlineMark);
    expect(el.querySelector('strong')).toBe(null);
    expect(el.textContent).toBe('hello');
  });

  it('isMarkActive reflects whether the selection is fully inside a mark', () => {
    const el = contentEl('<em>x</em>');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    expect(editor.isMarkActive('italic' as InlineMark)).toBe(true);
    expect(editor.isMarkActive('bold' as InlineMark)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/InlineEditor.test.ts`
Expected: FAIL — `toggleMark` / `isMarkActive` / `InlineMark` not defined.

- [ ] **Step 3: Add the implementation**

Add the `InlineMark` type and tag maps at module scope in `InlineEditor.ts`:

```ts
/** The inline marks the editor can toggle. */
export type InlineMark = 'bold' | 'italic' | 'strikethrough' | 'code';

/** Maps a mark to the element tag it is represented by in the DOM. */
const MARK_TAG: Record<InlineMark, string> = {
  bold: 'STRONG',
  italic: 'EM',
  strikethrough: 'DEL',
  code: 'CODE',
};

/** Tags treated as equivalent to the canonical tag for a mark. */
const MARK_ALIASES: Record<InlineMark, string[]> = {
  bold: ['STRONG', 'B'],
  italic: ['EM', 'I'],
  strikethrough: ['DEL', 'S'],
  code: ['CODE'],
};
```

Add these methods to the `InlineEditor` class:

```ts
  /** Toggle an inline mark over the current selection. */
  toggleMark(mark: InlineMark): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.commonAncestorContainer)) return;

    if (this.isMarkActive(mark)) {
      this.unwrapMark(range, mark);
    } else {
      this.wrapMark(range, mark);
    }
    this.el.focus();
  }

  /** True when the whole selection sits inside an element for `mark`. */
  isMarkActive(mark: InlineMark): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const aliases = MARK_ALIASES[mark];
    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== this.el) {
      if (node.nodeType === Node.ELEMENT_NODE
          && aliases.includes((node as Element).tagName)) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  private wrapMark(range: Range, mark: InlineMark): void {
    const wrapper = document.createElement(MARK_TAG[mark]);
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    // Re-select the wrapped content so a follow-up toggle sees it.
    const sel = window.getSelection()!;
    const newRange = document.createRange();
    newRange.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  private unwrapMark(range: Range, mark: InlineMark): void {
    const aliases = MARK_ALIASES[mark];
    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== this.el) {
      if (node.nodeType === Node.ELEMENT_NODE
          && aliases.includes((node as Element).tagName)) {
        const markEl = node as HTMLElement;
        const parent = markEl.parentNode!;
        while (markEl.firstChild) {
          parent.insertBefore(markEl.firstChild, markEl);
        }
        parent.removeChild(markEl);
        return;
      }
      node = node.parentNode;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/InlineEditor.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/InlineEditor.ts tests/unit/renderer/components/InlineEditor.test.ts
git commit -m "feat: add inline mark wrap/unwrap toggle to InlineEditor"
```

---

## Task 6: `InlineEditor` — keyboard shortcuts

**Files:**
- Modify: `src/renderer/components/InlineEditor.ts`
- Test: `tests/unit/renderer/components/InlineEditor.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
function keydown(el: HTMLElement, key: string, mods: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true, ...mods,
  }));
}

describe('InlineEditor keyboard shortcuts', () => {
  it('Cmd+B toggles bold over the selection', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    keydown(el, 'b', { metaKey: true });
    expect(el.querySelector('strong')?.textContent).toBe('hello');
  });

  it('Cmd+I toggles italic, Cmd+E toggles code', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    keydown(el, 'i', { metaKey: true });
    expect(el.querySelector('em')?.textContent).toBe('hello');
    selectAll(el.querySelector('em')!);
    keydown(el, 'e', { metaKey: true });
    expect(el.querySelector('code')).not.toBe(null);
  });

  it('Cmd+Shift+X toggles strikethrough', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    keydown(el, 'x', { metaKey: true, shiftKey: true });
    expect(el.querySelector('del')?.textContent).toBe('hello');
  });

  it('Escape commits the session', () => {
    const el = contentEl('hello');
    const onCommit = vi.fn();
    const editor = new InlineEditor(el, { onCommit });
    editor.start();
    keydown(el, 'Escape');
    expect(onCommit).toHaveBeenCalledWith('hello');
  });

  it('stops listening for shortcuts after commit', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    editor.commit();
    selectAll(el);
    keydown(el, 'b', { metaKey: true });
    expect(el.querySelector('strong')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/InlineEditor.test.ts`
Expected: FAIL — no keydown handling; shortcuts do nothing.

- [ ] **Step 3: Add the implementation**

Extend the callbacks interface (the `onRequestLink` field is used in Task 7; declaring it now keeps the type stable):

```ts
export interface InlineEditorCallbacks {
  /** Called once when the session commits, with the segment's inline markdown. */
  onCommit: (markdown: string) => void;
  /** Called when the user requests link insertion (Cmd+K). Optional. */
  onRequestLink?: () => void;
}
```

Add a bound handler to the class:

```ts
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.commit();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    const key = e.key.toLowerCase();
    if (key === 'b') {
      e.preventDefault();
      this.toggleMark('bold');
    } else if (key === 'i') {
      e.preventDefault();
      this.toggleMark('italic');
    } else if (key === 'e') {
      e.preventDefault();
      this.toggleMark('code');
    } else if (key === 'x' && e.shiftKey) {
      e.preventDefault();
      this.toggleMark('strikethrough');
    } else if (key === 'k') {
      e.preventDefault();
      this.callbacks.onRequestLink?.();
    }
  };
```

Update `start()` and `commit()` to add/remove the listener:

```ts
  start(): void {
    this.el.setAttribute('contenteditable', 'true');
    this.el.spellcheck = false;
    this.el.addEventListener('keydown', this.onKeyDown);
    this.el.focus();
  }

  commit(): void {
    if (this.committed) return;
    this.committed = true;
    this.el.removeEventListener('keydown', this.onKeyDown);
    const markdown = serializeInline(this.el);
    this.el.removeAttribute('contenteditable');
    this.callbacks.onCommit(markdown);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/InlineEditor.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/InlineEditor.ts tests/unit/renderer/components/InlineEditor.test.ts
git commit -m "feat: add formatting keyboard shortcuts to InlineEditor"
```

---

## Task 7: `InlineEditor` — link insertion

**Files:**
- Modify: `src/renderer/components/InlineEditor.ts`
- Test: `tests/unit/renderer/components/InlineEditor.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('InlineEditor link insertion', () => {
  it('applyLink wraps the selection in an anchor with the given href', () => {
    const el = contentEl('click here');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    editor.applyLink('https://example.com');
    const a = el.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.textContent).toBe('click here');
  });

  it('applyLink with an empty href unwraps an existing anchor over the selection', () => {
    const el = contentEl('<a href="https://x.com">link</a>');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    editor.applyLink('');
    expect(el.querySelector('a')).toBe(null);
    expect(el.textContent).toBe('link');
  });

  it('Cmd+K invokes the onRequestLink callback', () => {
    const el = contentEl('hello');
    const onRequestLink = vi.fn();
    const editor = new InlineEditor(el, { onCommit: vi.fn(), onRequestLink });
    editor.start();
    keydown(el, 'k', { metaKey: true });
    expect(onRequestLink).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/InlineEditor.test.ts`
Expected: FAIL — `applyLink` not defined. (The Cmd+K test passes already from Task 6.)

- [ ] **Step 3: Add the implementation**

Add to the `InlineEditor` class:

```ts
  /**
   * Wrap the current selection in an anchor pointing at `href`. An empty
   * `href` unwraps an existing anchor over the selection instead.
   */
  applyLink(href: string): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.commonAncestorContainer)) return;

    const existing = this.findAncestorTag(range, 'A') as HTMLAnchorElement | null;
    if (existing) {
      const parent = existing.parentNode!;
      while (existing.firstChild) {
        parent.insertBefore(existing.firstChild, existing);
      }
      parent.removeChild(existing);
    }
    if (!href) return;

    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    anchor.appendChild(range.extractContents());
    range.insertNode(anchor);
    this.el.focus();
  }

  private findAncestorTag(range: Range, tag: string): Element | null {
    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== this.el) {
      if (node.nodeType === Node.ELEMENT_NODE
          && (node as Element).tagName === tag) {
        return node as Element;
      }
      node = node.parentNode;
    }
    return null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/InlineEditor.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/InlineEditor.ts tests/unit/renderer/components/InlineEditor.test.ts
git commit -m "feat: add link insertion to InlineEditor"
```

---

## Task 8: `FloatingFormatToolbar` — render, position, active state

**Files:**
- Create: `src/renderer/components/FloatingFormatToolbar.ts`
- Test: `tests/unit/renderer/components/FloatingFormatToolbar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { FloatingFormatToolbar } from '../../../../src/renderer/components/FloatingFormatToolbar';

describe('FloatingFormatToolbar', () => {
  it('renders a button for each formatting action', () => {
    const tb = new FloatingFormatToolbar({ onAction: vi.fn() });
    const root = tb.getElement();
    const actions = Array.from(root.querySelectorAll('button'))
      .map((b) => b.dataset.action);
    expect(actions).toEqual([
      'bold', 'italic', 'strikethrough', 'code', 'link', 'clear',
    ]);
  });

  it('is hidden until show() is called', () => {
    const tb = new FloatingFormatToolbar({ onAction: vi.fn() });
    expect(tb.getElement().hidden).toBe(true);
    tb.show(document.createElement('div'));
    expect(tb.getElement().hidden).toBe(false);
    tb.hide();
    expect(tb.getElement().hidden).toBe(true);
  });

  it('clicking a button fires onAction with that action name', () => {
    const onAction = vi.fn();
    const tb = new FloatingFormatToolbar({ onAction });
    tb.getElement().querySelector<HTMLButtonElement>('[data-action="italic"]')!.click();
    expect(onAction).toHaveBeenCalledWith('italic');
  });

  it('setActiveMarks toggles the is-active class on matching buttons', () => {
    const tb = new FloatingFormatToolbar({ onAction: vi.fn() });
    tb.setActiveMarks(['bold', 'code']);
    const root = tb.getElement();
    expect(root.querySelector('[data-action="bold"]')!.classList.contains('is-active')).toBe(true);
    expect(root.querySelector('[data-action="code"]')!.classList.contains('is-active')).toBe(true);
    expect(root.querySelector('[data-action="italic"]')!.classList.contains('is-active')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/FloatingFormatToolbar.test.ts`
Expected: FAIL — cannot resolve `FloatingFormatToolbar`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * FloatingFormatToolbar - A small toolbar that floats above the segment being
 * edited and exposes the inline formatting actions as buttons.
 *
 * It is purely presentational: it renders buttons, positions itself, and
 * reflects active-mark state. All behaviour is delegated through `onAction`.
 * Visibility (global, default hidden) is owned by `EditModeController`.
 */

/** Actions a toolbar button can request. */
export type ToolbarAction =
  | 'bold' | 'italic' | 'strikethrough' | 'code' | 'link' | 'clear';

export interface FloatingFormatToolbarCallbacks {
  onAction: (action: ToolbarAction) => void;
}

interface ButtonSpec {
  action: ToolbarAction;
  label: string;
  title: string;
}

const BUTTONS: ButtonSpec[] = [
  { action: 'bold', label: 'B', title: 'Bold (Cmd+B)' },
  { action: 'italic', label: 'I', title: 'Italic (Cmd+I)' },
  { action: 'strikethrough', label: 'S', title: 'Strikethrough (Cmd+Shift+X)' },
  { action: 'code', label: '<>', title: 'Inline code (Cmd+E)' },
  { action: 'link', label: 'Link', title: 'Link (Cmd+K)' },
  { action: 'clear', label: 'Tx', title: 'Clear formatting' },
];

export class FloatingFormatToolbar {
  private el: HTMLElement;
  private callbacks: FloatingFormatToolbarCallbacks;

  constructor(callbacks: FloatingFormatToolbarCallbacks) {
    this.callbacks = callbacks;
    this.el = document.createElement('div');
    this.el.className = 'inline-format-toolbar';
    this.el.hidden = true;
    for (const spec of BUTTONS) {
      const btn = document.createElement('button');
      btn.dataset.action = spec.action;
      btn.textContent = spec.label;
      btn.title = spec.title;
      btn.addEventListener('mousedown', (e) => {
        // Prevent the contenteditable from losing selection on button press.
        e.preventDefault();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.callbacks.onAction(spec.action);
      });
      this.el.appendChild(btn);
    }
  }

  /** The toolbar's root element — caller appends it to the DOM once. */
  getElement(): HTMLElement {
    return this.el;
  }

  /** Show the toolbar positioned just above `segment`. */
  show(segment: HTMLElement): void {
    this.el.hidden = false;
    const rect = segment.getBoundingClientRect();
    this.el.style.position = 'absolute';
    this.el.style.left = `${rect.left + window.scrollX}px`;
    this.el.style.top = `${rect.top + window.scrollY - this.el.offsetHeight - 6}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }

  /** Light up the buttons whose marks are active for the current selection. */
  setActiveMarks(active: ToolbarAction[]): void {
    for (const btn of Array.from(this.el.querySelectorAll<HTMLButtonElement>('button'))) {
      const action = btn.dataset.action as ToolbarAction;
      btn.classList.toggle('is-active', active.includes(action));
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/FloatingFormatToolbar.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/FloatingFormatToolbar.ts tests/unit/renderer/components/FloatingFormatToolbar.test.ts
git commit -m "feat: add FloatingFormatToolbar component"
```

---

## Task 9: `EditModeController` — open `InlineEditor` for WYSIWYG segments

**Files:**
- Modify: `src/renderer/components/EditModeController.ts`
- Test: `tests/unit/renderer/components/EditModeController.test.ts`

This task replaces the `<textarea>` path in `startEdit` / `commitActiveEdit` with `InlineEditor`. The slice's block type is stripped before editing and re-applied after, reusing the existing `detectBlockType` / `applyBlockPrefix` helpers already in the file.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { EditModeController } from '../../../../src/renderer/components/EditModeController';
import type { PluginManager } from '../../../../src/plugins/core/PluginManager';

/** Minimal PluginManager stub: render wraps content in <p>, bold/italic
 *  markdown becomes tags. Good enough for edit-mode orchestration tests. */
function makePluginManager(): PluginManager {
  return {
    render: (md: string): string => {
      const html = md
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '<em>$1</em>');
      return `<p>${html}</p>`;
    },
    postRender: vi.fn(() => Promise.resolve()),
  } as unknown as PluginManager;
}

function setup(): { container: HTMLElement; controller: EditModeController } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const controller = new EditModeController(container, makePluginManager());
  return { container, controller };
}

describe('EditModeController — WYSIWYG editing', () => {
  it('clicking a slice makes its content contenteditable, not a textarea', async () => {
    const { container, controller } = setup();
    await controller.enter('Hello **world**');
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    expect(content.getAttribute('contenteditable')).toBe('true');
    expect(container.querySelector('textarea')).toBe(null);
  });

  it('committing an edited slice re-applies the block prefix and updates markdown', async () => {
    const { container, controller } = setup();
    const onContentChange = vi.fn();
    controller.setCallbacks({ onContentChange });
    await controller.enter('# Title');
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    // Simulate the user editing the rendered heading text.
    content.textContent = 'New Title';
    controller.commitActiveEditForTest();
    expect(onContentChange).toHaveBeenCalledWith('# New Title');
    expect(controller.getMarkdown()).toBe('# New Title');
  });
});
```

> Note: `commitActiveEditForTest()` is a thin test-only accessor added in Step 3
> because `commitActiveEdit` is private. It keeps the test deterministic instead
> of relying on a simulated outside-click.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: FAIL — clicking still creates a `<textarea>`; `commitActiveEditForTest` undefined.

- [ ] **Step 3: Modify `EditModeController`**

At the top of the file, add imports:

```ts
import { InlineEditor } from './InlineEditor';
import { canSerialize } from '../services/inlineMarkdownSerializer';
```

Add a field next to `activeEditIndex`:

```ts
  private activeInlineEditor: InlineEditor | null = null;
```

Replace the entire existing `startEdit` method with the WYSIWYG version. The
slice's rendered HTML is already in `.slice-content`; attach an `InlineEditor`
to it unless `canSerialize` rejects it (`startRawEdit` is added in Task 10):

```ts
  /**
   * Start inline editing of a slice using the WYSIWYG InlineEditor.
   */
  private startEdit(sliceIndex: number): void {
    this.commitActiveEdit();

    const slice = this.slices.find((s) => s.index === sliceIndex);
    const el = this.sliceElements.get(sliceIndex);
    if (!slice || !el) return;

    const contentEl = el.querySelector<HTMLElement>('.slice-content');
    if (!contentEl) return;

    // Unsupported inline content is handled by the raw editor (Task 10).
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
    });
    this.activeInlineEditor.start();
  }

  /**
   * Apply the markdown produced by an InlineEditor commit: re-attach the
   * slice's block prefix, push it through the slicer, and re-render the slice.
   */
  private applyInlineCommit(sliceIndex: number, inlineMarkdown: string): void {
    const slice = this.slices.find((s) => s.index === sliceIndex);
    const el = this.sliceElements.get(sliceIndex);
    if (!slice || !el) return;

    const blockType = this.detectBlockType(slice.raw);
    const newRaw = this.applyBlockPrefix(inlineMarkdown, blockType);

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

Replace the body of `commitActiveEdit` so it drives the `InlineEditor`:

```ts
  /**
   * Commit the active edit. The InlineEditor's onCommit callback does the
   * markdown reconciliation; this just triggers it and clears local state.
   */
  private commitActiveEdit(): void {
    if (this.activeEditIndex === null) return;
    this.activeEditIndex = null;
    const editor = this.activeInlineEditor;
    this.activeInlineEditor = null;
    editor?.commit();
  }
```

Add the test-only accessor near the bottom of the class:

```ts
  /** Test-only: deterministically commit the active edit. */
  commitActiveEditForTest(): void {
    this.commitActiveEdit();
  }
```

`stripBlockPrefix` stays in the file — still used by `convertSlice`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite to catch regressions in existing slice tests**

Run: `pnpm test`
Expected: PASS — all suites green. If a pre-existing edit-mode test asserted on `<textarea>` / `.slice-editor`, update it to assert on `[contenteditable]` instead, then re-run.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/EditModeController.ts tests/unit/renderer/components/EditModeController.test.ts
git commit -m "feat: open segments in the WYSIWYG InlineEditor"
```

---

## Task 10: `EditModeController` — slim raw editor and `Cmd+/` toggle

**Files:**
- Modify: `src/renderer/components/EditModeController.ts`
- Test: `tests/unit/renderer/components/EditModeController.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('EditModeController — raw markdown editing', () => {
  it('startRawEdit puts a slim textarea in the slice with the raw markdown', async () => {
    const { container, controller } = setup();
    await controller.enter('# Title');
    container.querySelector<HTMLElement>('.slice-content')!.click(); // WYSIWYG
    controller.toggleRawForActiveSlice();
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.slice-raw-editor');
    expect(textarea).not.toBe(null);
    expect(textarea!.value).toBe('# Title');
  });

  it('committing a raw edit updates the markdown verbatim', async () => {
    const { container, controller } = setup();
    const onContentChange = vi.fn();
    controller.setCallbacks({ onContentChange });
    await controller.enter('# Title');
    container.querySelector<HTMLElement>('.slice-content')!.click();
    controller.toggleRawForActiveSlice();
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.slice-raw-editor')!;
    textarea.value = '## Changed';
    controller.commitActiveEditForTest();
    expect(onContentChange).toHaveBeenCalledWith('## Changed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: FAIL — `startRawEdit` / `toggleRawForActiveSlice` not defined.

- [ ] **Step 3: Add the implementation**

Add a field next to `activeInlineEditor`:

```ts
  private activeRawTextarea: HTMLTextAreaElement | null = null;
```

Add these methods to the class:

```ts
  /**
   * Open a slice in the slim raw-markdown textarea. Used as the fallback for
   * unsupported inline content and as the target of the Cmd+/ toggle.
   */
  private startRawEdit(sliceIndex: number): void {
    this.commitActiveEdit();

    const slice = this.slices.find((s) => s.index === sliceIndex);
    const el = this.sliceElements.get(sliceIndex);
    if (!slice || !el) return;

    const contentEl = el.querySelector<HTMLElement>('.slice-content');
    if (!contentEl) return;

    this.activeEditIndex = sliceIndex;
    el.classList.add('slice-editing');

    const textarea = document.createElement('textarea');
    textarea.className = 'slice-raw-editor';
    textarea.value = slice.raw;
    textarea.spellcheck = false;

    const resize = (): void => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    textarea.addEventListener('input', resize);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.commitActiveEdit();
      }
    });

    contentEl.replaceChildren(textarea);
    this.activeRawTextarea = textarea;
    textarea.focus();
    resize();
  }

  /**
   * Commit a raw-textarea edit: the textarea value is the slice's markdown
   * verbatim — no block-prefix reconciliation needed.
   */
  private commitRawEdit(sliceIndex: number): void {
    const textarea = this.activeRawTextarea;
    this.activeRawTextarea = null;
    if (!textarea) return;

    const slice = this.slices.find((s) => s.index === sliceIndex);
    const el = this.sliceElements.get(sliceIndex);
    if (!slice || !el) return;

    const newRaw = textarea.value;
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

  /**
   * Toggle the active slice between WYSIWYG and raw-markdown editing.
   * Bound to Cmd+/ and the "Edit as markdown" handle-menu item.
   */
  toggleRawForActiveSlice(): void {
    const sliceIndex = this.activeEditIndex;
    if (sliceIndex === null) return;
    const wasRaw = this.activeRawTextarea !== null;
    this.commitActiveEdit();
    if (wasRaw) {
      this.startEdit(sliceIndex);
    } else {
      this.startRawEdit(sliceIndex);
    }
  }
```

Update `commitActiveEdit` to route to the raw committer when a raw textarea is active:

```ts
  private commitActiveEdit(): void {
    if (this.activeEditIndex === null) return;
    const sliceIndex = this.activeEditIndex;
    this.activeEditIndex = null;

    if (this.activeRawTextarea) {
      this.commitRawEdit(sliceIndex);
      return;
    }
    const editor = this.activeInlineEditor;
    this.activeInlineEditor = null;
    editor?.commit();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/EditModeController.ts tests/unit/renderer/components/EditModeController.test.ts
git commit -m "feat: add slim raw-markdown editor and Cmd+/ toggle"
```

---

## Task 11: `EditModeController` — global shortcuts and handle-menu items

**Files:**
- Modify: `src/renderer/components/EditModeController.ts`
- Test: `tests/unit/renderer/components/EditModeController.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('EditModeController — global shortcuts and menu', () => {
  it('Cmd+/ toggles the active slice to raw editing', async () => {
    const { container, controller } = setup();
    await controller.enter('# Title');
    container.querySelector<HTMLElement>('.slice-content')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: '/', metaKey: true, bubbles: true, cancelable: true,
    }));
    expect(container.querySelector('textarea.slice-raw-editor')).not.toBe(null);
  });

  it('Cmd+Shift+F toggles the floating toolbar visibility flag', async () => {
    const { controller } = setup();
    await controller.enter('# Title');
    expect(controller.isToolbarVisible()).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f', metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    expect(controller.isToolbarVisible()).toBe(true);
  });

  it('exit() removes the global key listener', async () => {
    const { controller } = setup();
    await controller.enter('# Title');
    controller.exit();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f', metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    expect(controller.isToolbarVisible()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: FAIL — no global key listener; `isToolbarVisible` undefined.

- [ ] **Step 3: Add the implementation**

Add a field:

```ts
  private toolbarVisible = false;
```

Add the bound global key handler and the visibility accessors:

```ts
  private readonly onGlobalKeyDown = (e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === '/') {
      e.preventDefault();
      this.toggleRawForActiveSlice();
    } else if (e.key.toLowerCase() === 'f' && e.shiftKey) {
      e.preventDefault();
      this.setToolbarVisible(!this.toolbarVisible);
    }
  };

  /** Whether the floating toolbar is currently enabled (global state). */
  isToolbarVisible(): boolean {
    return this.toolbarVisible;
  }

  /** Enable/disable the floating toolbar. Toolbar UI wiring is Task 12. */
  setToolbarVisible(visible: boolean): void {
    this.toolbarVisible = visible;
  }
```

In `enter()`, register the listener next to the existing `document` click listener:

```ts
    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('keydown', this.onGlobalKeyDown);
```

In `exit()`, remove it and reset state:

```ts
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('keydown', this.onGlobalKeyDown);
    this.toolbarVisible = false;
```

Extend `SliceAction` to include the new actions:

```ts
export type SliceAction =
  | 'delete' | 'duplicate' | 'move-up' | 'move-down' | 'add-above' | 'add-below'
  | 'edit-as-markdown' | 'toggle-toolbar';
```

In `toggleMenu`, append two items to the existing `menu.insertAdjacentHTML('beforeend', ...)` template — insert this block immediately after the `add-below` button and before the `slice-menu-divider` that precedes Duplicate:

```html
      <div class="slice-menu-divider"></div>
      <button data-action="edit-as-markdown" class="slice-menu-item">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2z"/>
        </svg>
        Edit as markdown
      </button>
      <button data-action="toggle-toolbar" class="slice-menu-item">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 4h12v2H2V4zm0 4h8v2H2V8z"/>
        </svg>
        Show/hide formatting toolbar
      </button>
```

In `handleSliceAction`, handle the two new actions at the very top — place these
two `if` blocks immediately after the existing `this.commitActiveEdit();` call
and before the `const idx = ...` line, so the structural-action code below is
not reached for them:

```ts
    if (action === 'edit-as-markdown') {
      if (this.activeEditIndex === sliceIndex) {
        this.toggleRawForActiveSlice();
      } else {
        this.startRawEdit(sliceIndex);
      }
      return;
    }
    if (action === 'toggle-toolbar') {
      this.setToolbarVisible(!this.toolbarVisible);
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/EditModeController.ts tests/unit/renderer/components/EditModeController.test.ts
git commit -m "feat: add Cmd+/ , Cmd+Shift+F and handle-menu toggles to edit mode"
```

---

## Task 12: `EditModeController` — wire the `FloatingFormatToolbar`

**Files:**
- Modify: `src/renderer/components/EditModeController.ts`
- Test: `tests/unit/renderer/components/EditModeController.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('EditModeController — floating toolbar wiring', () => {
  it('shows the toolbar above a slice being edited when toolbar is enabled', async () => {
    const { container, controller } = setup();
    await controller.enter('Hello world');
    controller.setToolbarVisible(true);
    container.querySelector<HTMLElement>('.slice-content')!.click();
    const toolbar = container.querySelector('.inline-format-toolbar') as HTMLElement;
    expect(toolbar).not.toBe(null);
    expect(toolbar.hidden).toBe(false);
  });

  it('keeps the toolbar hidden when toolbar is disabled', async () => {
    const { container, controller } = setup();
    await controller.enter('Hello world');
    container.querySelector<HTMLElement>('.slice-content')!.click();
    const toolbar = container.querySelector('.inline-format-toolbar') as HTMLElement | null;
    expect(toolbar === null || toolbar.hidden).toBe(true);
  });

  it('a toolbar bold action wraps the selection in the active editor', async () => {
    const { container, controller } = setup();
    await controller.enter('Hello world');
    controller.setToolbarVisible(true);
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    const range = document.createRange();
    range.selectNodeContents(content);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    container
      .querySelector<HTMLButtonElement>('.inline-format-toolbar [data-action="bold"]')!
      .click();
    expect(content.querySelector('strong')).not.toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: FAIL — no toolbar element is ever created.

- [ ] **Step 3: Add the implementation**

Add imports:

```ts
import { FloatingFormatToolbar, type ToolbarAction } from './FloatingFormatToolbar';
import type { InlineMark } from './InlineEditor';
```

Add a field:

```ts
  private toolbar: FloatingFormatToolbar | null = null;
```

Add the lazy getter and toolbar-action handling:

```ts
  private getToolbar(): FloatingFormatToolbar {
    if (!this.toolbar) {
      this.toolbar = new FloatingFormatToolbar({
        onAction: (action) => this.handleToolbarAction(action),
      });
      this.container.appendChild(this.toolbar.getElement());
    }
    return this.toolbar;
  }

  private handleToolbarAction(action: ToolbarAction): void {
    const editor = this.activeInlineEditor;
    if (!editor) return;
    if (action === 'link') {
      this.promptAndApplyLink(editor);
      return;
    }
    if (action === 'clear') {
      (['bold', 'italic', 'strikethrough', 'code'] as InlineMark[]).forEach((m) => {
        if (editor.isMarkActive(m)) editor.toggleMark(m);
      });
      this.refreshToolbarState();
      return;
    }
    editor.toggleMark(action as InlineMark);
    this.refreshToolbarState();
  }

  /** Prompt for a URL and apply it as a link on the editor's selection. */
  private promptAndApplyLink(editor: InlineEditor): void {
    const href = window.prompt('Link URL') ?? '';
    editor.applyLink(href.trim());
  }

  private refreshToolbarState(): void {
    if (!this.toolbar || !this.activeInlineEditor) return;
    const editor = this.activeInlineEditor;
    const active: ToolbarAction[] = [];
    (['bold', 'italic', 'strikethrough', 'code'] as InlineMark[]).forEach((m) => {
      if (editor.isMarkActive(m)) active.push(m);
    });
    this.toolbar.setActiveMarks(active);
  }
```

> `window.prompt` keeps the link flow minimal and dependency-free. Replacing it
> with the anchored popover described in the spec is a follow-up — `InlineEditor.applyLink`
> is the stable seam, so the swap is contained and needs no other changes.

In `startEdit`, construct the `InlineEditor` with the `onRequestLink` callback,
and after `this.activeInlineEditor.start();` show the toolbar when enabled:

```ts
    this.activeInlineEditor = new InlineEditor(contentEl, {
      onCommit: (inlineMarkdown) => {
        this.applyInlineCommit(sliceIndex, inlineMarkdown);
      },
      onRequestLink: () => {
        if (this.activeInlineEditor) this.promptAndApplyLink(this.activeInlineEditor);
      },
    });
    this.activeInlineEditor.start();
    if (this.toolbarVisible) {
      this.getToolbar().show(contentEl);
      this.refreshToolbarState();
    }
```

In `commitActiveEdit`, hide the toolbar on the inline-editor path:

```ts
    const editor = this.activeInlineEditor;
    this.activeInlineEditor = null;
    this.toolbar?.hide();
    editor?.commit();
```

Replace `setToolbarVisible` so it reflects the change immediately for the active slice:

```ts
  setToolbarVisible(visible: boolean): void {
    this.toolbarVisible = visible;
    if (!visible) {
      this.toolbar?.hide();
      return;
    }
    if (this.activeEditIndex !== null && this.activeInlineEditor) {
      const el = this.sliceElements.get(this.activeEditIndex);
      const contentEl = el?.querySelector<HTMLElement>('.slice-content');
      if (contentEl) {
        this.getToolbar().show(contentEl);
        this.refreshToolbarState();
      }
    }
  }
```

In `exit()`, tear down the toolbar:

```ts
    this.toolbar?.getElement().remove();
    this.toolbar = null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/components/EditModeController.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/EditModeController.ts tests/unit/renderer/components/EditModeController.test.ts
git commit -m "feat: wire the floating format toolbar into edit mode"
```

---

## Task 13: Styling

**Files:**
- Modify: `src/index.css`

No automated test — visual styling, verified manually in Task 14.

- [ ] **Step 1: Replace the chunky `.slice-editor` rules with a slim raw editor rule**

Find the `.slice-editor` and `.slice-editor:focus` rules (around line 1788) and replace them with:

```css
/* Slim raw-markdown editor (used by the "Edit as markdown" toggle) */
.slice-raw-editor {
  width: 100%;
  min-height: 1.6em;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  outline: none;
  overflow: hidden;
}

.slice-raw-editor:focus {
  outline: none;
}
```

- [ ] **Step 2: Slim the WYSIWYG editing affordance**

Replace the `.slice.slice-editing .slice-content` rule (around line 1773) with a subtler treatment — a quiet left bar instead of a heavy ring:

```css
.slice.slice-editing .slice-content {
  background-color: var(--bg-color);
  box-shadow: inset 2px 0 0 var(--link-color);
}

.slice-content[contenteditable='true'] {
  outline: none;
  cursor: text;
}
```

- [ ] **Step 3: Add the floating toolbar styles**

Append after the `.slice-block-type-badge` rule:

```css
/* Floating inline-format toolbar */
.inline-format-toolbar {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 6px;
  background: var(--bg-color);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.12));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 200;
}

.inline-format-toolbar[hidden] {
  display: none;
}

.inline-format-toolbar button {
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-color);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.inline-format-toolbar button:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.06));
}

.inline-format-toolbar button.is-active {
  background: var(--link-color);
  color: #fff;
}
```

- [ ] **Step 4: Verify no `.ts` regressions snuck in**

Run: `pnpm typecheck`
Expected: PASS — no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "style: slim inline editor and add floating toolbar styles"
```

---

## Task 14: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full type check**

Run: `pnpm typecheck`
Expected: PASS — no errors.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS — all suites green, including the four new test files and the pre-existing `MarkdownSlicer` / edit-mode suites.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS. Fix any issues (e.g. an unused import left in `EditModeController.ts` after the textarea path was removed).

- [ ] **Step 4: Manual smoke check**

Run: `pnpm start`
In the app: open a markdown file, enter edit mode, then verify:
- Clicking a paragraph makes it a slim inline editable line — no chunky box.
- `Cmd+B` / `Cmd+I` / `Cmd+Shift+X` / `Cmd+E` toggle marks; `Esc` commits and the slice re-renders with correct markdown.
- `Cmd+Shift+F` reveals the floating toolbar above the active slice; its buttons format the selection; it starts hidden each session.
- `Cmd+/` and the handle-menu "Edit as markdown" item swap the slice to the slim raw textarea and back.
- A slice containing an inline image opens directly in the raw editor (the `canSerialize` fallback).

- [ ] **Step 5: Final commit (only if Step 3 required lint fixes)**

```bash
git add -A
git commit -m "chore: lint fixes for inline WYSIWYG edit mode"
```

---

## Self-Review Notes

- **Spec coverage:** contenteditable surface (Task 4); scoped serializer + escaping (Tasks 1–2); `canSerialize` guard + raw fallback routing (Tasks 3, 9, 10); five inline marks (Tasks 5, 7); shortcuts incl. `Cmd+Shift+X` (Task 6); `Cmd+/` raw toggle + `Cmd+Shift+F` toolbar toggle + handle-menu items (Tasks 10, 11); floating toolbar with clear-formatting + active state (Tasks 8, 12); block prefix re-application via existing helpers (Task 9); styling (Task 13); testing in every task; integration (Task 14).
- **Known spec deviation:** the link URL input is `window.prompt`, not the anchored popover the spec describes. Called out inline in Task 12 — `InlineEditor.applyLink` is the stable seam, so upgrading later is contained.
- **Type consistency:** `InlineMark` (`InlineEditor.ts`) = `'bold' | 'italic' | 'strikethrough' | 'code'`; `ToolbarAction` (`FloatingFormatToolbar.ts`) = that set plus `'link' | 'clear'`. `handleToolbarAction` narrows `ToolbarAction` to `InlineMark` only after handling `'link'` and `'clear'`. `serializeInline` / `canSerialize` signatures match their call sites. `commitActiveEdit`, `startEdit`, `startRawEdit`, `toggleRawForActiveSlice`, `setToolbarVisible` are referenced consistently across Tasks 9–12.
- **DOM construction:** no raw `innerHTML` assignment — fixtures and re-renders use `insertAdjacentHTML('afterbegin', …)` / `replaceChildren()`, matching the existing slice-menu code in `EditModeController`.
