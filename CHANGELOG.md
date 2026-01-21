# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
