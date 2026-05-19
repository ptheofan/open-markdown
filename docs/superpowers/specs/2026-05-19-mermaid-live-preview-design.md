# Live Mermaid Preview While Editing — Design

**Date:** 2026-05-19
**Status:** Approved

## Problem

Editing a mermaid diagram in edit mode currently means clicking the slice and
seeing the slim raw-markdown textarea — the rendered diagram disappears. The
user types blind, commits, and only then sees whether the change worked. For
visual diagrams this is the wrong feedback loop.

## Goal

While the user is editing a mermaid block, show the rendered diagram **above**
the source so changes are reflected in near-realtime as they type. Keep the
last successful render visible whenever the source is mid-edit and invalid; a
small inline error chip surfaces the syntax problem without removing the
diagram.

Design the feature so it generalises: any plugin that can render a fenced
code block to visual content can opt into the same live-preview surface.

## Approach

Introduce a generic plugin capability — `PreviewablePlugin` — and a single
new component, `PreviewableSourceEditor`, that drives editing sessions for
slices owned by such plugins. `EditModeController` gains one new branch in
`startEdit`: if any previewable plugin matches the slice, open
`PreviewableSourceEditor` instead of the existing WYSIWYG-or-raw routing.

The mermaid plugin is the first implementer. Future plugins (math, graphviz,
embedded HTML, etc.) get live-preview for free by implementing the same four
methods.

Rejected alternatives:

- **Special-case mermaid in `EditModeController` directly.** Cheaper to ship
  but no abstraction for future plugins. We have one such plugin today;
  rather than add the second one before the contract exists, we accept the
  modest extra design surface up front.
- **Dedicated mermaid editor modal / split view.** Too big a departure from
  the inline-edit flow; complicates focus, escape semantics, and slice-state
  bookkeeping.

## Components

### New

| Component | Responsibility | Location |
|---|---|---|
| `PreviewablePlugin` interface | Optional plugin capability. Declares `matchesSlice`, `extractSource`, `renderPreview`, `applySourceToRaw`. | `src/plugins/types/preview.ts` |
| `PreviewableSourceEditor` | One editing session. Owns the layout (preview top, error chip middle, textarea bottom), the debounced re-render, the error-chip toggling, the idempotent commit. | `src/renderer/components/` |

### Modified

- **`MermaidPlugin`** — implements `PreviewablePlugin`. Adds four methods.
  Existing `apply` (fence override) and `postRender` (async render) paths are
  unchanged; live preview is additive.
- **`EditModeController`** — adds `findPreviewablePluginFor(slice)` lookup
  and one new branch at the top of `startEdit`. Also factors the existing
  `commitRawEdit` logic into a shared `applyRawCommit` helper so both raw
  paths (slim textarea, previewable editor) share the same slice-update +
  re-render code.
- **`PluginManager`** — adds `getPreviewablePlugins()` returning the subset
  of plugins that implement the optional capability (type-narrowed).
- **`index.css`** — styles for the preview area, error chip, and the
  textarea-below-preview layout.

## The plugin contract

```ts
export interface PreviewablePlugin {
  /** Does this plugin own the given slice? Fast and side-effect-free. */
  matchesSlice(slice: MarkdownSlice): boolean;

  /** Extract the user-editable source from the slice's raw markdown
   *  (e.g. strip ```mermaid fences). */
  extractSource(slice: MarkdownSlice): string;

  /** Render `source` into `target`, replacing its contents on success.
   *  MUST NOT throw — errors are returned so the caller can keep the
   *  previous good preview visible. */
  renderPreview(
    source: string,
    target: HTMLElement
  ): Promise<{ ok: true } | { ok: false; error: string }>;

  /** Inverse of extractSource — wrap the edited source back into a full
   *  slice raw. Implementations may consult `slice.raw` to preserve
   *  details like a fence's info-string. */
  applySourceToRaw(slice: MarkdownSlice, source: string): string;
}
```

Key contract guarantees:

- `renderPreview` never throws. The `{ ok, error }` shape lets the editor
  keep the last good preview while showing an error chip.
- On `{ ok: true }`, `target`'s contents are replaced. On `{ ok: false }`,
  `target` is left alone. The caller can rely on "new content = render
  succeeded."
- The four methods are stateless on the plugin (matches/extract/apply are
  pure; renderPreview is async + mutates the target). All session state
  lives in `PreviewableSourceEditor`.

## `PreviewableSourceEditor`

### Public API

```ts
export interface PreviewableSourceEditorCallbacks {
  /** Called once when the session commits, with the new slice raw. */
  onCommit: (newRaw: string) => void;
}

export class PreviewableSourceEditor {
  constructor(
    contentEl: HTMLElement,
    slice: MarkdownSlice,
    plugin: PreviewablePlugin,
    callbacks: PreviewableSourceEditorCallbacks
  );
  start(): void;
  commit(): void; // idempotent
}
```

### DOM it builds inside `contentEl`

```
<div class="slice-content">                  ← passed-in contentEl
  <div class="preview-source-preview">       ← preview area (top)
    <!-- existing rendered SVG stays here -->
  </div>
  <div class="preview-source-error" hidden>  ← error chip (between)
    <span class="preview-source-error-text"></span>
  </div>
  <textarea class="slice-raw-editor">        ← editor (bottom)
    initial value = plugin.extractSource(slice)
  </textarea>
</div>
```

The preview area uses the **existing rendered SVG** as its starting state —
when `start()` runs, the slice-content already contains the
`<div.mermaid-container>` placeholder filled with SVG. The editor wraps it in
the new structure rather than re-rendering.

### Behavior

- **Initial:** existing preview visible, textarea focused, error chip hidden.
- **Typing:** debounce 250ms after the last keystroke → call
  `plugin.renderPreview(textarea.value, previewArea)`.
- **On success:** preview area's contents are replaced. Error chip stays
  hidden.
- **On error:** preview area is unchanged. Error chip becomes visible with
  the error text.
- **Race control:** each `renderPreview` call carries a monotonic
  `requestId`. When the promise resolves, the result is dropped if a newer
  call has been issued in between. Last keystroke wins.
- **`Esc`, blur, click-away:** committed via `commit()`.
- **`commit()`** runs `plugin.applySourceToRaw(slice, textarea.value)` →
  `callbacks.onCommit(newRaw)`. Cancels any pending debounced render before
  committing. Idempotent (boolean flag).

## MermaidPlugin implementation

```ts
matchesSlice(slice: MarkdownSlice): boolean {
  if (slice.type !== 'code') return false;
  const firstLine = slice.raw.trimStart().split('\n', 1)[0] ?? '';
  return /^```mermaid\b/.test(firstLine);
}

extractSource(slice: MarkdownSlice): string {
  const lines = slice.raw.split('\n');
  let start = 0;
  let end = lines.length;
  if (lines[0]?.trimStart().startsWith('```mermaid')) start = 1;
  if (lines[lines.length - 1]?.trim() === '```') end = lines.length - 1;
  return lines.slice(start, end).join('\n');
}

async renderPreview(
  source: string,
  target: HTMLElement
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

applySourceToRaw(slice: MarkdownSlice, source: string): string {
  const firstLine = slice.raw.trimStart().split('\n', 1)[0] ?? '';
  const match = firstLine.match(/^```(.*)$/);
  const info = match?.[1] ?? 'mermaid';
  return '```' + info + '\n' + source + '\n```';
}
```

Notes:

- `matchesSlice` is conservative: only fenced code blocks whose info-string
  starts with `mermaid`. `` ```js ``, `` ```python `` etc. fall through to
  the existing raw editor.
- `applySourceToRaw` recovers the original info-string from `slice.raw`'s
  opening fence. This preserves details like `` ```mermaid theme=dark ``.
  Falls back to `mermaid` if the original fence doesn't parse.
- `renderPreview` reuses the plugin's `diagramCounter` so live and
  post-render ids never collide.
- The existing `postRender` path is unchanged. Live preview is purely
  additive.

## Controller wiring

```ts
// In EditModeController.startEdit, BEFORE the canSerialize check:
const previewable = this.findPreviewablePluginFor(slice);
if (previewable) {
  this.activeEditIndex = sliceIndex;
  el.classList.add('slice-editing');
  this.activePreviewableEditor = new PreviewableSourceEditor(
    contentEl, slice, previewable,
    { onCommit: (newRaw) => this.applyRawCommit(sliceIndex, newRaw) }
  );
  this.activePreviewableEditor.start();
  return;
}
// existing canSerialize / WYSIWYG / raw routing follows
```

`commitActiveEdit` learns one more branch: route to
`this.activePreviewableEditor.commit()` if it's set.

`applyRawCommit(sliceIndex, newRaw)` is the existing `commitRawEdit` body
factored out so both the slim raw editor and the previewable editor share
the same slice-update + re-render path.

## Data flow

```
Open
  click mermaid slice
    → startEdit
      → findPreviewablePluginFor → MermaidPlugin
      → new PreviewableSourceEditor(contentEl, slice, plugin, callbacks)
      → editor.start()
        → wrap contentEl: [preview][error hidden][textarea]
        → textarea.value = plugin.extractSource(slice)
        → textarea.focus()

Type
  textarea input → debounce 250ms
    → requestId = ++renderCounter
    → plugin.renderPreview(source, previewArea)
      → { ok: true } & latest: preview replaced, error chip hidden
      → { ok: false } & latest: preview untouched, error chip shown
      → stale: result discarded

Commit (Esc / blur / segment switch)
  editor.commit()
    → cancel pending debounce
    → newRaw = plugin.applySourceToRaw(slice, textarea.value)
    → callbacks.onCommit(newRaw)
      → controller.applyRawCommit(sliceIndex, newRaw)
        → slicer.updateSlice → rawMarkdown, slices updated
        → callbacks.onContentChange(rawMarkdown)
        → re-render slice via standard path (postRender re-renders mermaid)
```

## Error handling

| Situation | Behavior |
|---|---|
| Mermaid library not initialised | `{ ok: false, error: 'Mermaid not initialised' }`. Error chip; preview unchanged (likely empty on first render). Practically unreachable. |
| Mermaid syntax error | `{ ok: false, error: <mermaid's message> }`. Error chip shows the message; last good preview stays. |
| `renderPreview` throws unexpectedly | Caught and converted to `{ ok: false }`. Contract: never throws. |
| Concurrent renders | Monotonic `requestId` discards stale results. Last keystroke wins. |
| Commit before debounce fires | Pending render is cancelled. Commit uses the textarea's current value. |
| User presses `Esc` over an invalid source | Slice is committed with whatever's in the textarea — invalid mermaid round-trips back as a slice that the post-render path will mark as a `<div.mermaid-error>`. Matches existing behavior for raw commits. |

The last good preview is sticky for the entire edit session. The error chip
makes invalid state visible without losing context.

## Testing

- **`MermaidPlugin.test.ts`** — extend with:
  - `matchesSlice` truth table (mermaid, mermaid-with-info-string, other
    languages, non-code slices, missing fence).
  - `extractSource` strips fences and preserves inner content verbatim incl.
    blank lines.
  - `applySourceToRaw` round-trips `` ```mermaid `` and `` ```mermaid info ``;
    falls back to `mermaid` when slice.raw has no recognisable fence.
  - `renderPreview` success path (target replaced; `{ ok: true }`), failure
    path (target untouched; `{ ok: false, error }`), and uninitialised path.
    Mocks the mermaid library.

- **`PreviewableSourceEditor.test.ts`** (new) — jsdom:
  - `start()` builds the expected DOM and focuses the textarea.
  - Initial textarea value equals `plugin.extractSource(slice)`.
  - Typing triggers a debounced `renderPreview` call (`vi.useFakeTimers`).
  - `{ ok: true }` replaces preview; error chip stays hidden.
  - `{ ok: false }` leaves preview alone; error chip becomes visible.
  - Concurrent renders: a slow first call followed by a fast second call —
    only the second result is applied.
  - `commit()` calls `applySourceToRaw` and forwards to `onCommit`.
  - `commit()` is idempotent.
  - `Esc` on the textarea commits.

- **`EditModeController.test.ts`** — extend with:
  - Clicking a `` ```mermaid `` slice opens the previewable editor (assert
    via DOM: preview + textarea coexist).
  - Clicking a `` ```js `` slice opens the regular raw textarea (no preview
    area).
  - Clicking a paragraph still opens the WYSIWYG inline editor.
  - Committing a previewable edit updates the slice raw with the new fenced
    content; `onContentChange` fires.

Tests use a `FakePreviewablePlugin` stub so the controller test doesn't
depend on the real mermaid library.

## Out of scope

- Editing other code-block languages with live preview (e.g. live HTML
  rendering, math). The contract supports it; implementation is per-plugin
  and lands separately when a second consumer exists.
- Syntax highlighting inside the textarea (CodeMirror or similar). The
  existing `.slice-raw-editor` plain textarea is reused.
- A `Cmd+/` toggle to expand/collapse the preview area. Defer until users
  ask.
- Slice handle alignment for mermaid blocks (the separate reported issue).
  Handled as a small follow-up CSS tweak independent of this design.
