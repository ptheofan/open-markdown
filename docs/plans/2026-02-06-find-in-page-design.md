# Find in Page Design

## Goal

Add Cmd+F (Ctrl+F on Windows/Linux) search functionality to find and highlight text in the loaded markdown document, powered by Electron's built-in `findInPage` API.

## Decisions

- **Engine**: Electron's `webContents.findInPage()` — handles text matching, highlighting, scrolling to matches, and wrapping. No custom DOM search.
- **UI**: Floating pill in top-right of the viewer area. Not docked or inline — overlays content without shifting layout.
- **Features**: Text input, case-sensitivity toggle ("Aa"), match count ("3 of 12"), prev/next arrows, close button.
- **Activation**: Cmd+F opens (or re-focuses). Escape closes and clears highlights.
- **Scope cut**: No whole-word match, no regex. Electron's API doesn't support these natively. Can be added later with a custom DOM-based search layer.

## Architecture

Two new pieces:

**FindBar** (renderer component) — The floating search UI. Manages input, debounced querying, result display, keyboard navigation. Lives inside `#markdown-viewer`.

**FindHandler** (main process IPC handler) — Bridges renderer requests to `webContents.findInPage()` and `webContents.stopFindInPage()`. Relays `found-in-page` event results back to the renderer.

No service layer — the logic is thin enough that FindBar orchestrates directly through IPC.

### IPC Channels

| Channel | Direction | Payload |
|---------|-----------|---------|
| `find:find-in-page` | renderer → main | `{ text: string, options: { matchCase?: boolean, forward?: boolean, findNext?: boolean } }` |
| `find:stop-finding` | renderer → main | `{ action: 'clearSelection' \| 'keepSelection' }` |
| `find:result` | main → renderer | `{ activeMatchOrdinal: number, matches: number }` |

### Data Flow

```
Cmd+F          → FindBar.show() → focus input
User types     → debounce 150ms → IPC find:find-in-page → main calls webContents.findInPage()
found-in-page  → main sends find:result → FindBar updates count display
Enter          → IPC find:find-in-page { forward: true, findNext: true }
Shift+Enter    → IPC find:find-in-page { forward: false, findNext: true }
Case toggle    → re-run current query with updated matchCase
Escape / Close → IPC find:stop-finding { action: 'clearSelection' } → FindBar.hide()
```

## Types

```ts
interface FindInPageOptions {
  matchCase?: boolean;
  forward?: boolean;
  findNext?: boolean;
}

interface FindResult {
  activeMatchOrdinal: number;
  matches: number;
}
```

## FindBar Component

Appended inside `#markdown-viewer`. HTML structure:

```html
<div class="find-bar">
  <input class="find-bar-input" type="text" placeholder="Find..." />
  <span class="find-bar-count">0 of 0</span>
  <button class="find-bar-toggle-case" title="Match Case">Aa</button>
  <button class="find-bar-prev" title="Previous Match (Shift+Enter)">↑</button>
  <button class="find-bar-next" title="Next Match (Enter)">↓</button>
  <button class="find-bar-close" title="Close (Escape)">✕</button>
</div>
```

**Constructor**: Takes scroll container (`#markdown-viewer`) and callbacks for `onFind`, `onFindNext`, `onStopFinding`.

**show()**: Makes bar visible, focuses input. If text is selected in the page, pre-fills input.

**hide()**: Hides bar, calls `onStopFinding`, clears result display.

**updateResult(result)**: Updates the "N of M" count display.

**Keyboard handling** (within the input):
- Enter → `onFindNext({ forward: true })`
- Shift+Enter → `onFindNext({ forward: false })`
- Escape → `hide()`

**Debounce**: Input events debounced at 150ms before calling `onFind`.

## FindHandler (Main Process)

Registered in `src/main/ipc/handlers/FindHandler.ts`. Receives IPC from renderer, calls the appropriate `webContents` methods.

```ts
handle('find:find-in-page', (event, { text, options }) => {
  const webContents = event.sender;
  webContents.findInPage(text, options);
});

handle('find:stop-finding', (event, { action }) => {
  const webContents = event.sender;
  webContents.stopFindInPage(action);
});
```

The `found-in-page` event listener is set up when the BrowserWindow is created. It forwards results via:

```ts
webContents.on('found-in-page', (event, result) => {
  webContents.send('find:result', {
    activeMatchOrdinal: result.activeMatchOrdinal,
    matches: result.matches,
  });
});
```

## Preload Bridge

Extends `window.electronAPI` with:

```ts
find: {
  findInPage: (text: string, options: FindInPageOptions) => void;
  stopFinding: (action: 'clearSelection' | 'keepSelection') => void;
  onResult: (callback: (result: FindResult) => void) => () => void;
}
```

## App Integration

- `initializeComponents()`: Create FindBar after MarkdownViewer.
- `setupEventListeners()`: Register Cmd+F / Ctrl+F keydown listener → `findBar.show()`.
- Wire FindBar callbacks to preload bridge calls.
- Register `find:result` listener → `findBar.updateResult()`.
- `destroy()`: Call `findBar.destroy()`, clean up result listener.

## CSS

```css
.find-bar {
  position: fixed;
  top: 52px;
  right: 20px;
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background-color: var(--toolbar-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
```

Input, buttons, and count display styled to match existing toolbar/dropdown conventions. Case toggle button gets an "active" visual state when enabled.

Hidden by default (`display: none`), shown via `.find-bar-visible` class.

## Testing

**FindHandler unit tests**: Verify IPC calls to `webContents.findInPage()` and `stopFindInPage()` with correct arguments. Mock `found-in-page` event to test result forwarding.

No DOM tests for FindBar — visual component verified manually.

## Files

| File | Action |
|------|--------|
| `src/shared/types/find.ts` | NEW — find types |
| `src/shared/types/index.ts` | MODIFY — export find types |
| `src/main/ipc/handlers/FindHandler.ts` | NEW — IPC handler |
| `src/main/ipc/handlers/index.ts` | MODIFY — register FindHandler |
| `src/preload/preload.ts` | MODIFY — add find namespace to bridge |
| `src/renderer/components/FindBar.ts` | NEW — search bar component |
| `src/renderer/components/index.ts` | MODIFY — export FindBar |
| `src/index.css` | MODIFY — find bar styles |
| `src/renderer.ts` | MODIFY — App class integration |
| `tests/unit/main/ipc/handlers/FindHandler.test.ts` | NEW — handler tests |
