# Change Gutter Design

## Goal

Show visual indicators in the left gutter of the rendered markdown when a file changes on disk, so users can see at a glance what was added, modified, or deleted — similar to VS Code's git gutter.

## Decisions

- **Baseline**: User-controlled with a Reset button. Changes accumulate against the baseline. Clicking Reset accepts current content as the new baseline.
- **Colors**: Green bar = added/modified lines, Red bar = deletion point. Simple two-color system matching VS Code conventions.
- **Reset button**: Floating in bottom-right of the viewer. Sticky, only visible when changes exist.
- **Diff strategy**: Diff markdown source lines, map onto rendered HTML blocks via `data-source-lines` attributes from markdown-it token maps.
- **Diff library**: `diff` (jsdiff) npm package — mature, ~15KB, BSD license, `diffArrays` for line-level comparison.

## Architecture

Three new components:

**SourceMapRule** (plugin layer) — markdown-it core rule that propagates `data-source-lines="start-end"` attributes onto rendered block-level HTML elements. Reads `token.map` which markdown-it already provides.

**DiffService** (renderer service) — Pure computation, no DOM dependency. Stores baseline content, compares against current content using `diffArrays`. Returns `DiffResult` with line changes typed as added/modified/deleted.

**ChangeGutter** (renderer component) — Reads diff results, queries `[data-source-lines]` elements, applies CSS classes for added/modified blocks, inserts thin marker divs for deletion points. Manages the floating Reset button.

### Data Flow

```
File opened    → DiffService.setBaseline(content) → ChangeGutter.clearIndicators()
File changes   → DiffService.computeDiff(newContent) → ChangeGutter.applyChanges(diff)
Reset clicked  → DiffService.setBaseline(currentContent) → ChangeGutter.clearIndicators()
File deleted   → DiffService.clearBaseline() → ChangeGutter.clearIndicators()
```

## Types

```ts
type LineChangeType = 'added' | 'modified' | 'deleted';

interface LineChange {
  type: LineChangeType;
  startLine: number;   // 0-based inclusive (in current content)
  endLine: number;     // 0-based exclusive; for 'deleted' startLine === endLine
}

interface DiffResult {
  changes: LineChange[];
  hasChanges: boolean;
}
```

## DiffService Logic

Uses `diffArrays` comparing `baseline.split('\n')` vs `current.split('\n')`:

- `removed` + `added` at same position → **modified** range (covers the added lines)
- `removed` alone → **deleted** point marker (startLine === endLine)
- `added` alone → **added** range

API: `setBaseline(content)`, `clearBaseline()`, `hasBaseline()`, `computeDiff(currentContent): DiffResult`.

## SourceMapRule

Function `applySourceMapRule(md: MarkdownIt)` pushes a core rule that iterates `state.tokens`. For tokens with `token.map` and `token.nesting === 1` (opening tags), sets `data-source-lines="${map[0]}-${map[1]}"`.

Integrated into `MarkdownRenderer` constructor after markdown-it instance creation.

## ChangeGutter

Constructor takes scroll container (`#markdown-viewer`), content container (`#markdown-content`), and `onReset` callback.

**applyChanges(diffResult)**:
1. Clear previous indicators
2. Query all `[data-source-lines]` elements
3. Parse source-line ranges, check overlap with changes, apply CSS classes
4. Insert deletion marker divs between appropriate blocks
5. Show/hide Reset button based on `hasChanges`

**Reset button**: `<button>` appended to `#markdown-viewer`, `position: sticky; bottom: 20px; float: right`.

**CSS**: `::before` pseudo-elements — 3px green bar in padding area for added/modified, 12px wide 2px tall red bar for deletions. Theme variables for light/dark.

## App Integration

- `initializeComponents()`: Create DiffService and ChangeGutter after MarkdownViewer
- `loadFile()`: Set baseline, clear indicators
- `handleFileChange()`: Compute diff, apply to gutter
- `handleResetBaseline()`: Set current content as baseline, clear indicators
- `handleFileDelete()`: Clear baseline and indicators
- `destroy()`: Call `changeGutter.destroy()`

## Testing

**SourceMapRule tests**: Verify `data-source-lines` on block elements (headings, paragraphs, lists, code blocks, blockquotes). Verify correct line ranges. Verify inline elements don't get attributes.

**DiffService tests**: Baseline management, identical content, added/deleted/modified lines, mixed changes, edge cases (empty content, single line, no baseline).

No E2E tests — visual gutter verified manually.

## Files

| File | Action |
|------|--------|
| `package.json` | Add `diff` + `@types/diff` |
| `src/shared/types/diff.ts` | NEW |
| `src/shared/types/index.ts` | MODIFY — export diff types |
| `src/plugins/core/SourceMapRule.ts` | NEW |
| `src/plugins/core/MarkdownRenderer.ts` | MODIFY — apply source map rule |
| `src/renderer/services/DiffService.ts` | NEW |
| `src/renderer/services/index.ts` | MODIFY — export DiffService |
| `src/renderer/components/ChangeGutter.ts` | NEW |
| `src/renderer/components/index.ts` | MODIFY — export ChangeGutter |
| `src/index.css` | MODIFY — gutter styles + theme vars |
| `src/renderer.ts` | MODIFY — App class integration |
| `tests/unit/plugins/core/SourceMapRule.test.ts` | NEW |
| `tests/unit/renderer/services/DiffService.test.ts` | NEW |
