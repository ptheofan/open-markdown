# Edit Mode: Inline WYSIWYG Editor — Design

**Date:** 2026-05-14
**Status:** Approved

## Problem

In edit mode, clicking a segment swaps its rendered HTML for a monospace
`<textarea>` (`EditModeController.startEdit`). The textarea's `min-height: 40px`,
padding, and focus ring make it a chunky box that breaks the flow of the
Notion-style "islands" layout. The editing surface also shows raw markdown
syntax rather than the rendered content the rest of edit mode presents.

## Goal

Replace the per-segment textarea with a **slim, inline, Notion-style WYSIWYG
editor**: the user edits the rendered content directly, formatting shortcuts
toggle real visual marks, and the segment never turns into a bordered box.
The constraint is "only do what markdown can express." A per-segment toggle
drops into raw-markdown editing as an optional escape hatch.

This feature is **inline-only**. Block-level structure (headings, lists,
quotes, code blocks) is untouched and stays in the existing "Turn into"
handle menu.

## Approach

contenteditable + a scoped inline serializer. The `.slice-content` element
becomes `contenteditable`; formatting operations toggle marks via direct DOM
Range manipulation; on commit a small purpose-built serializer walks the
inline DOM and emits markdown for a fixed set of marks. The slice's raw
markdown string remains the single source of truth — WYSIWYG is a different
editing surface over it.

Rejected alternatives:

- **Turndown (HTML→MD library):** a general-purpose sledgehammer for ~5
  inline marks; new dependency; output won't match the app's markdown style
  without configuration.
- **ProseMirror / TipTap / Milkdown:** a large dependency and a major
  architectural rewrite; overkill for a per-segment slim inline editor; fights
  the existing slice model.

Approach 1 is the only contained change. The scoped serializer is tractable
because edit mode already knows each slice's block type and only five inline
marks are supported; the raw-markdown toggle covers everything else.

## Components

### New

| Component | Responsibility | Location |
|---|---|---|
| `InlineEditor` | Manages one segment's WYSIWYG session: makes `.slice-content` `contenteditable`, places the caret, handles formatting shortcuts, toggles marks via DOM Range manipulation, owns the link popover. | `src/renderer/components/` |
| `inlineMarkdownSerializer` | Pure module. `serializeInline(root)` walks the inline DOM → markdown. `canSerialize(root)` guards against unsupported content. No DOM mutation, no state. | `src/renderer/services/` |
| `FloatingFormatToolbar` | The mini toolbar: renders buttons, positions itself above the active segment, reflects active-mark state for the current selection, calls into `InlineEditor`. | `src/renderer/components/` |

### Modified

- **`EditModeController`** — orchestrates. `startEdit()` stops creating a
  `<textarea>`; it opens an `InlineEditor` (WYSIWYG, the default) or the raw
  editor. Tracks per-segment raw/WYSIWYG state and global toolbar-visible
  state. Adds two handle-menu items ("Edit as markdown", "Show/hide formatting
  toolbar") and wires the `Cmd+/` and `Cmd+Shift+F` shortcuts.
- **Raw editor** — today's `<textarea>` path is kept but slimmed (loses the
  `min-height: 40px` + padding box). It is what the "Edit as markdown" toggle
  drops into.

## Data flow

Entering edit mode renders slices as today (rendered HTML in `.slice-content`).

Clicking a segment (default WYSIWYG):

1. `EditModeController.startEdit(index)` runs `canSerialize` on the segment's
   inline DOM. If it fails, the segment opens in raw mode instead (see Safety).
2. Otherwise an `InlineEditor` is bound to that slice's `.slice-content`.
3. `.slice-content` gets `contenteditable=true`, focus, caret placed.
4. If the global toolbar-visible state is on, `FloatingFormatToolbar`
   positions above the segment.

Formatting (shortcut or toolbar button): `InlineEditor` toggles the mark in
the DOM via Range manipulation (selection-based wrap/unwrap); the toolbar
updates active state from the current selection.

Commit (blur / `Esc` / click-away / switch segment):

```
serializeInline(.slice-content)        →  inline markdown string
re-apply block prefix                  →  uses the slice's known block type
                                          (existing strip/applyBlockPrefix logic)
slicer.updateSlice(...)                →  rawMarkdown updated, onContentChange fired
.slice-content re-rendered to HTML     (exactly as today)
```

## Serializer scope and safety

`serializeInline` handles exactly:

- text nodes (literal markdown characters backslash-escaped so plain text
  does not become syntax on re-render)
- `<strong>` / `<b>` → `**`
- `<em>` / `<i>` → `*`
- `<del>` / `<s>` → `~~`
- `<code>` → `` ` ``
- `<a href>` → `[text](url)`
- `<br>` → newline

Nested marks produce nested syntax.

**Safety guard:** `canSerialize(root)` runs before a segment opens in WYSIWYG.
If the rendered inline DOM contains anything outside the supported set — an
inline `<img>`, `<sup>`, a styled `<span>`, raw HTML — the segment opens in
raw mode instead. Source that cannot be faithfully round-tripped is never
silently mangled.

## Raw-mode toggle

`Cmd+/` or the handle-menu "Edit as markdown" item flips the *current* edit
session to the slim raw textarea. It is momentary: leaving the segment and
clicking back in returns to WYSIWYG. It is a "show me the source" escape
hatch, not a sticky per-segment mode. (Could be made sticky later.)

## Floating toolbar

- Floats just above the active segment; follows the user between segments;
  hides when no segment is active.
- Global visibility state, **starts hidden** every edit-mode session. Toggled
  by `Cmd+Shift+F` or the handle-menu item.
- Buttons: bold, italic, strikethrough, inline code, link, clear-formatting.
  Each reflects whether the mark is active for the current selection.
- The link button and `Cmd+K` open a small URL-input popover anchored to the
  toolbar.

## Keyboard shortcuts (active WYSIWYG segment)

| Shortcut | Action |
|---|---|
| `Cmd+B` | Bold |
| `Cmd+I` | Italic |
| `Cmd+Shift+X` | Strikethrough |
| `Cmd+E` | Inline code |
| `Cmd+K` | Link (opens URL popover) |
| `Cmd+/` | Toggle raw markdown for the active segment |
| `Cmd+Shift+F` | Toggle the floating toolbar |
| `Esc` | Commit and exit the segment (unchanged) |

## Error handling and edge cases

- Empty segment → serializes to an empty string, handled as today.
- Selection spanning a partial mark → toggle unwraps only the selected run.
- Switching segments mid-edit → commit the previous segment (existing pattern).
- Unsupported inline content → segment auto-opens in raw mode (the
  `canSerialize` guard).

## Testing

- **`inlineMarkdownSerializer`** — the bulk of the coverage, since it is pure:
  every mark, nested marks, links, text escaping, and `canSerialize` rejecting
  each unsupported node type. Round-trip tests:
  `markdown → pluginManager.render → serializeInline → expect original`
  (modulo normalization).
- **`InlineEditor`** — mark toggle wraps/unwraps a selection correctly;
  partial-selection unwrap; shortcuts dispatch the right command.
- **`EditModeController`** — raw↔WYSIWYG toggle, toolbar toggle, and the commit
  flow still updates `rawMarkdown` and fires `onContentChange`; a
  `canSerialize` failure routes to raw mode.

## Out of scope

- Block-level editing (headings, lists, quotes, code blocks) — stays in the
  existing "Turn into" handle menu.
- General HTML→markdown conversion — only the five inline marks above.
- Sticky per-segment raw mode — the toggle is momentary for now.
