# Multi-Window Support Design

Open multiple markdown files simultaneously, each in its own window.

## Current State

The app is built as a single-window singleton architecture:

- `MainWindow` is a singleton managing one `BrowserWindow`
- `FileWatcherService` is a singleton watching one file at a time
- IPC handlers are registered globally once via `ipcMain.handle()`
- The renderer `App` class manages one file in `state.currentFilePath`
- `open-file` event sends to the single `mainWindow`

## Design

### Window Management

Replace the `MainWindow` singleton with a `WindowManager` that tracks multiple windows.

**`WindowManager`** maintains a `Map<number, BrowserWindow>` keyed by window ID and exposes:

- `createWindow(filePath?: string)` -- create a new window, optionally loading a file
- `getWindow(id)` / `getAllWindows()` / `getFocusedWindow()`
- `getWindowByFilePath(filePath)` -- find if a file is already open

Window creation logic (BrowserWindow config, content loading, fullscreen events) moves from `MainWindow` into `WindowManager.createWindow()`. The `MainWindow` class is deleted.

### File Watching

The single `FileWatcherService` gains multi-file support with reference counting.

- `watch(filePath, windowId)` -- add a file to the watch list, associated with a window
- `unwatch(filePath, windowId)` -- remove the association; stop the chokidar watcher when no windows remain
- Internally: `Map<string, { watcher: FSWatcher, windowIds: Set<number> }>` -- one chokidar watcher per unique file, reference-counted by windows

Callbacks become per-window. When a file changes, only windows watching that file are notified. Window close automatically cleans up subscriptions.

### IPC Handlers

All `ipcMain.handle()` registrations remain global and registered once. `event.sender` identifies which window sent the request.

Changes:

- **FileHandler**: watch/unwatch pass `window.id` to `FileWatcherService`
- **Window.GET_FULLSCREEN**: move from `MainWindow.create()` into global handler registration, use `event.sender` to find the right window
- **New channel `WINDOW.OPEN_NEW`**: renderer requests opening a new window, handler calls `windowManager.createWindow(filePath)`

No changes needed for: ThemeHandler, PreferencesHandler, RecentFilesHandler, ClipboardHandler, ContextMenuHandler. These are either app-wide (broadcast to all windows) or stateless.

### Renderer

No structural changes. Each `BrowserWindow` loads its own renderer instance with its own `App` class and state. The single-file-per-renderer design is exactly what multi-window needs.

Additions:

- Keyboard shortcut Cmd+Shift+N opens a new empty window
- Modifier-click (Cmd or Option) on a recent file opens it in a new window
- Both call `window.electronAPI.window.openNew(filePath?)`

### macOS Behavior

**Double-click .md in Finder** (`open-file` event):

1. Check if file is already open in a window -- focus it
2. Check if an empty window exists (welcome screen) -- load there
3. Otherwise create a new window

**Dock click** (`activate` event): create an empty window only if zero windows exist.

**Window title**: call `BrowserWindow.setTitle(fileName)` so macOS shows file names in Mission Control, window menu, and Cmd+\` switcher.

### Security

The `web-contents-created` handler continues to deny `setWindowOpenHandler`. All new windows are created programmatically from the main process, not via `window.open()`.

## Implementation Order

1. **Extract WindowManager** -- replace `MainWindow` singleton, move `GET_FULLSCREEN` handler to global registration, update `main/index.ts`. App works identically without singleton assumptions.
2. **Multi-file FileWatcherService** -- refactor to accept `windowId`, support watching multiple files with reference counting. Update FileHandler IPC.
3. **Wire up open-file routing** -- update `app.on('open-file')` to create new windows or focus existing. Add window title support.
4. **Add "Open in New Window" trigger** -- new IPC channel, preload bridge, keyboard shortcut, modifier-click on recent files.

## Deferred (Tabs/Splits)

The following are explicitly out of scope and can be layered on later:

- Tab bar UI
- Split pane layout engine
- Drag-and-drop tab arrangement
- Per-pane state management within a single window

The singleton removal in this design is a prerequisite for tabs/splits.
