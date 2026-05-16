# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-05-16

### Added

- **Inline WYSIWYG edit mode**: clicking a slice now opens a slim inline editor (no more chunky textarea). Bold / italic / strikethrough / inline code / link are toggled directly via shortcuts or a floating toolbar.
- **Notion-style block flow**: `Enter` splits the current slice into two paragraphs (the new one gets focus); `Shift+Enter` inserts a soft line break inside the slice.
- **Cross-slice arrow navigation**: `ArrowUp` at the top of a slice moves to the previous slice; `ArrowDown` at the bottom moves to the next.
- **Raw-markdown escape hatch**: `Cmd+/` or the handle menu's "Edit as markdown" item toggles a slice to a slim raw-markdown editor. Slices containing unsupported inline content (e.g. inline `<img>`, `<sup>`) automatically open in raw mode.
- **Floating format toolbar**: `Cmd+Shift+F` reveals a small toolbar above the active slice with buttons for the five inline marks.

### Changed

- Edit-mode layout now matches view-mode exactly — no horizontal shift, identical vertical rhythm between blocks.
- Slice handle is positioned per block type so it aligns with the first line of text instead of the slice's top edge.

## [1.3.3] - 2026-05-14

### Added

- **Local image rendering**: Markdown documents now display images referenced by relative or absolute filesystem paths, served through a dedicated `om-asset:` protocol restricted to image file types
- **Remote image rendering**: Images referenced over `https:` now load in rendered documents
- **Link hover preview**: Hovering over a link in a rendered document now shows the target URL in the status bar
- **Open links in browser**: Clicking an internet link in a rendered document opens it in the default system browser; right-clicking a link offers copy and open actions
- **Window state persistence**: Window size, position, and maximized state are restored across application sessions

## [1.1.0] - 2025-01-21

### Added

- **Zoom support**: Pinch-to-zoom gesture on trackpad for rendered markdown content
- **Keyboard zoom shortcuts**: Cmd/Ctrl + Plus to zoom in, Cmd/Ctrl + Minus to zoom out, Cmd/Ctrl + 0 to reset
- **Zoom indicator**: Status bar now displays current zoom level (50% - 300%)
- **Fullscreen toolbar adjustment**: Toolbar repositions when entering fullscreen mode (traffic lights hidden)

### Changed

- Migrated ESLint configuration from legacy `.eslintrc.json` to ESLint 9 flat config format (`eslint.config.mjs`)

### Fixed

- Fixed ES module error that prevented app from launching (removed `"type": "module"` from package.json)
- Fixed toolbar padding in fullscreen mode - Open button now aligns to the left edge when macOS traffic lights are hidden

## [1.0.0] - 2025-01-20

### Added

- Initial release
- GitHub-flavored markdown rendering with markdown-it
- Syntax highlighting for code blocks using highlight.js
- Mermaid diagram support (flowcharts, sequence diagrams, etc.)
- Drag-and-drop file opening
- File watching with auto-refresh on external changes
- Light and dark theme support with system theme detection
- macOS native title bar with traffic light controls
- Plugin architecture for markdown extensions
