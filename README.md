# Open Markdown

A fast, native macOS/Windows/Linux desktop app for viewing Markdown files with live preview, syntax highlighting, and Mermaid diagram support.

## Features

- **GitHub-flavored Markdown** - Tables, task lists, strikethrough, and more
- **Syntax Highlighting** - Code blocks with language detection and theme-aware colors
- **Mermaid Diagrams** - Flowcharts, sequence diagrams, ERDs, and more
- **Live Reload** - Automatically updates when the file changes
- **Dark/Light Theme** - Follows system preference or manual toggle
- **Drag & Drop** - Drop markdown files directly into the app
- **Native Performance** - Built with Electron for a smooth experience

## Installation

Download the latest release for your platform from the [Releases](https://github.com/aralu/markdown-viewer/releases) page:

- **macOS**: `.dmg` or `.zip`
- **Windows**: `.exe` installer
- **Linux**: `.deb` or `.rpm`

## Usage

1. **Open a file**: Click the "Open" button or use `Cmd+O` (macOS) / `Ctrl+O` (Windows/Linux)
2. **Drag & Drop**: Drag a `.md` file directly into the app window
3. **Toggle theme**: Click the theme button in the toolbar to switch between light and dark mode

The app will automatically reload when the file is modified externally.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+

### Setup

```bash
# Clone the repository
git clone https://github.com/aralu/markdown-viewer.git
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
