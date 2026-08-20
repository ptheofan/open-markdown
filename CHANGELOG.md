# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Sync progress snackbar**: a bar at the bottom of the window reporting what a Google Docs sync is doing and how far along it is. Diagram uploads and table inserts each advance it, so the slowest part of a sync visibly moves instead of appearing to hang. Dismiss it with the ✕; clicking the spinning sync button brings it back, still tracking the sync in progress.

### Fixed

- **Saving straight from an open editor no longer loses the edit.** Text being typed only reaches the document when the editor commits, and committing is also what marks the document as changed. Save checked "is there anything to change?" before that happened, so an edit the user never clicked away from looked like no change at all: nothing was written to disk, exiting edit mode committed it into the view anyway, and the change was gone the next time the file was opened. Pending edits are now committed before the document is read or judged unchanged.
- **Bolding a word mid-sentence no longer leaves literal asterisks.** Selecting a word by double-click takes its trailing space with it, so the editor wrapped `Testt2 ` rather than `Testt2` and wrote `**Testt2 **`. A closing `**` preceded by a space is not a valid CommonMark closer, so the markers survived as text instead of becoming bold. Emphasis markers are now placed inside any surrounding whitespace, for bold, italic and strikethrough alike.

### Changed

- **Linking a file to a Google Doc now goes through Google's own file picker** instead of pasting a document URL. Picking a document is what grants access to it, so the app no longer needs the sensitive `documents` scope ("see, edit, create and delete all your Google Docs documents") and requests only per-file `drive.file` access.

### Removed

- The "paste a Google Doc URL" dialog. A pasted address cannot grant per-file access, so it no longer has a way to work.

### Migration

- Existing links created by pasting a URL will stop working, and signing in again is required. Re-link the affected files through the picker.

## [1.5.0] - 2026-08-20

### Added

- **Google Docs sync** (experimental, off by default): link a markdown file to a Google Doc and push changes to it. Enable under Preferences → Experimental Features.
- **Comment-preserving sync**: paragraph-level diffing with character-level diffs inside modified paragraphs, so comments anchored to untouched text survive a sync. Unchanged paragraphs, tables and images are skipped entirely.
- **Sign-in with Google** via OAuth2 with PKCE; tokens are encrypted at rest with the system keychain. Optional custom OAuth credentials for users who prefer their own Google Cloud project.
- **Tables**, inserted with their inline formatting intact and their column widths matched to the proportions shown in the app.
- **Mermaid diagrams**, rendered to images and uploaded, each with a link back to mermaid.live for editing.
- **Code blocks**, shaded and set in Consolas with syntax colours computed locally. Untagged fences have their language detected against a constrained candidate list, and are left plain when detection is not confident.
- **Google Docs section in Preferences** with sign-out and custom credential settings, shown whenever the feature is enabled or an account is still signed in.

### Fixed

- Select All no longer picks up app chrome. The toolbar, status bar, find bar and drop zone are excluded, so Cmd+A copies the document and nothing else — including the find bar's own search term, which sits inside the viewer.
- Mac App Store uploads no longer fail code-signing validation. The `keychain-access-groups` entitlement used the Xcode build variable `$(AppIdentifierPrefix)`, which nothing in this pipeline expands, so the literal text shipped as the group name and did not match the provisioning profile.
- No blank line between a heading and a table that follows it. Google Docs always writes a newline before an inserted table, which after a heading left a gap on top of the heading's own spacing.
- Window dragging works again across the whole toolbar. Both toolbar halves span the full width, and their `no-drag` region had covered the bar's own drag region, leaving nowhere to grab the window.

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
