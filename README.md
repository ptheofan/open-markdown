# Open Markdown

A fast, native macOS/Windows/Linux desktop app for viewing Markdown files with live preview, syntax highlighting, and Mermaid diagram support.

## Features

- **GitHub-flavored Markdown** - Tables, task lists, strikethrough, and more
- **Syntax Highlighting** - Code blocks with language detection and theme-aware colors
- **Mermaid Diagrams** - Flowcharts, sequence diagrams, ERDs, and more
- **Live Reload** - Automatically updates when the file changes, with change highlighting
- **Multi-Window** - Open multiple files side by side (`Cmd+N`)
- **Dark/Light Theme** - Follows system preference or manual toggle
- **Drag & Drop** - Drop markdown files directly into the app
- **Find in Page** - Search within rendered content (`Cmd+F`)
- **Document Outline** - Sidebar of headings that follows your scroll position and jumps to any section (`Cmd+Shift+O`)
- **Open Documents Browser** - Grid of thumbnails of every open document plus recent files, filtered by name or content (`Cmd+Shift+D`)
- **Open by Path** - Paste a full path, or a path relative to the current document, and press Enter (`Cmd+P`)
- **Clickable Task Lists** - Tick a checkbox in the rendered document and the `- [ ]` in the file follows
- **Copy Code** - Hover a code block for a copy button, or press `Cmd+Shift+C`
- **Copy as Rich Text** - Paste the document, a selection or a section into Slack, mail, Notion or Google Docs with formatting intact
- **Front Matter** - YAML metadata at the top of a file shows as a collapsible table
- **Alerts** - `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` render as GitHub does
- **Math** - `$…$`, `$$…$$`, `\(…\)` and `\[…\]` rendered with KaTeX, offline
- **File References** - `src/app.ts:42` opens the file in your editor at that line; `docs/plan.md` opens in the viewer
- **Code Block Titles & Line Highlights** - ```` ```ts title="app.ts" {2-3} ```` draws a title bar and calls out lines; `diff` blocks colour whole lines
- **Footnotes** - `[^1]` references with back links
- **Native Performance** - Built with Electron for a smooth experience

## Installation

**Mac App Store** (recommended for macOS):

[![Download on the Mac App Store](https://developer.apple.com/assets/elements/badges/download-on-the-mac-app-store.svg)](https://apps.apple.com/us/app/open-markdown/id6758868093?mt=12)

Or download the latest release from the [Releases](https://github.com/ptheofan/open-markdown/releases) page:

- **macOS**: `.dmg` or `.zip`
- **Windows**: `.exe` installer
- **Linux**: `.deb` or `.rpm`

## Usage

1. **Open a file**: Click the "Open" button or use `Cmd+O` (macOS) / `Ctrl+O` (Windows/Linux)
2. **Drag & Drop**: Drag a `.md` file directly into the app window
3. **New window**: `Cmd+N` to open additional windows for side-by-side viewing
4. **Toggle theme**: Click the theme button in the toolbar to switch between light and dark mode

The app will automatically reload when the file is modified externally.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+

### Setup

```bash
# Clone the repository
git clone https://github.com/ptheofan/open-markdown.git
cd markdown-viewer

# Install dependencies
pnpm install
```

### Running Locally

```bash
# Start the app in development mode with hot reload
pnpm start
```

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm start` | Start app in development mode |
| `pnpm test` | Run unit tests |
| `pnpm test:e2e` | Run end-to-end tests |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm package` | Package the app (no installer) |
| `pnpm make` | Build distributable installers |

### Building

```bash
# Package for current platform
pnpm package

# Create distributable installers (DMG, EXE, DEB, RPM)
pnpm make
```

Build artifacts are output to the `out/` directory.

## Tech Stack

- **Framework**: [Electron](https://www.electronjs.org/) with [Electron Forge](https://www.electronforge.io/)
- **Language**: TypeScript (strict mode)
- **Bundler**: [Vite](https://vitejs.dev/)
- **Markdown**: [markdown-it](https://github.com/markdown-it/markdown-it)
- **Syntax Highlighting**: [highlight.js](https://highlightjs.org/)
- **Diagrams**: [Mermaid](https://mermaid.js.org/)
- **File Watching**: [chokidar](https://github.com/paulmillr/chokidar)
- **Testing**: [Vitest](https://vitest.dev/) + [Playwright](https://playwright.dev/)

## Project Structure

```
src/
├── main/           # Main process (Node.js)
│   ├── window/     # BrowserWindow management
│   ├── ipc/        # IPC handlers
│   └── services/   # File, theme, and watcher services
├── preload/        # Preload scripts (secure bridge)
├── renderer/       # Renderer process (UI)
│   └── components/ # UI components
├── plugins/        # Markdown plugin system
│   ├── core/       # Plugin manager and renderer
│   └── builtin/    # GFM, syntax highlight, Mermaid
└── shared/         # Shared types, constants, errors
```

## License

GPL-3.0
