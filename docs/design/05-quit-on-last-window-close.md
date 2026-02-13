# Quit on Last Window Close & Application Menu

## Context

Apple's App Store review flagged that when the user closes the last window, the app stays alive with no way to re-open a window. Apple offered two remedies:

1. Add a Window menu that lists the main window so it can be reopened.
2. If the app is a single-window app, save data and quit when the main window is closed.

We chose option 2 (quit on last close) and also add a proper application menu with a Window menu listing open windows — both satisfy the review and improve the app.

## Part 1: Quit on Last Window Close

### Remove platform guard in `window-all-closed` handler

`src/main/index.ts` — Remove the `process.platform !== 'darwin'` check. Quit unconditionally.

### Remove dead `activate` handler

`src/main/index.ts` — Remove the handler that re-creates a window when the dock icon is clicked with zero windows. Dead code since the app now quits before that can happen.

## Part 2: Application Menu

The app currently has no custom application menu (uses Electron's default). Add a proper macOS menu bar.

### Menu Structure

```
Open Markdown
  About Open Markdown
  ─────────
  Preferences...        Cmd+,
  ─────────
  Hide Open Markdown    Cmd+H
  Hide Others           Cmd+Opt+H
  Show All
  ─────────
  Quit Open Markdown    Cmd+Q

File
  New Window            Cmd+N
  Open File...          Cmd+O
  ─────────
  Close Window          Cmd+W

Edit
  Copy                  Cmd+C
  Select All            Cmd+A
  ─────────
  Find...               Cmd+F

View
  Zoom In               Cmd+=
  Zoom Out              Cmd+-
  Actual Size           Cmd+0
  ─────────
  Toggle Full Screen    Ctrl+Cmd+F

Window (role: windowMenu)
  Minimize              Cmd+M
  Zoom
  ─────────
  Bring All to Front
  ─────────
  (open windows auto-listed by macOS)

Help
  Open Markdown Website
  Report an Issue
```

### Implementation

1. **New file `src/main/menu/applicationMenu.ts`** — Builds the menu via `Menu.setApplicationMenu()`. Called during `initialize()`.

2. **Main-process actions** — New Window, Close Window, Quit, Minimize, Zoom, Fullscreen use Electron `role` properties or existing main-process code.

3. **Renderer-side actions** — Find, Zoom In/Out/Reset, and Preferences send an IPC message to the focused window: `webContents.send('menu:action', actionName)`.

4. **New IPC listener in renderer** — A single listener for `menu:action` that dispatches to existing methods (toggle find bar, zoom, open preferences).

5. **Clean up dead renderer keydown handlers** — Remove `Cmd+N`, `Cmd+O`, `Cmd+F`, and zoom keydown handlers from the renderer since the menu now owns those shortcuts.

6. **About dialog** — `app.showAboutWindow()` with app icon, version, copyright "ARALU Single Member P.C.", and website link `https://ptheofan.github.io/open-markdown/`.

7. **Help menu links** — Open in external browser via `shell.openExternal()`:
   - Open Markdown Website → `https://ptheofan.github.io/open-markdown/`
   - Report an Issue → `https://github.com/ptheofan/open-markdown/issues`

## What stays the same

- **`open-file` handler** — Still needed for cold launch via Finder double-click.
- **Window close cleanup** in `WindowManager` and `FileHandler` — Still runs normally before the app quits.
