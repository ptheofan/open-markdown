# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Navigation between documents**: a link to another markdown file opens it in the same window, scrolled to its anchor; `Cmd`/`Ctrl`-click opens it in a new window. Links to other local files open in the app the system associates with them (never a program). A link to a file that is not there shows a red dotted underline and the path that was looked for in its tooltip; a link that resolves shows the path.

- **Back and Forward**: every document a window shows is remembered. `Cmd+[` and `Cmd+]`, View → Back / Forward, toolbar arrows, the mouse's back and forward buttons and a two-finger swipe on macOS move through them, each landing where the reader left it. Opening a new document from the middle drops what was ahead, as a browser does.

- **Quick Switch** (`Cmd+T`, View → Quick Switch…): type part of a name to jump to an open document or a recent file, with fuzzy matching on name and path. Arrow keys move, Enter opens, Esc closes.

- **Lightbox**: clicking an image opens it on a dark backdrop at its natural size; scroll or pinch zooms, dragging pans, `+`/`-` zoom, `0` resets, Esc or a click on the backdrop closes. The caption shows the alt text or the path.

- **Diagram zoom and pan**: hovering a Mermaid diagram shows zoom in, zoom out, fit and open-large buttons; pinch or `Cmd`/`Ctrl`+wheel zooms the diagram in place without zooming the page, and dragging pans once zoomed. Open-large shows the SVG in the lightbox, so its text stays crisp.

- **Print and export**: File → Print… (`Cmd+Shift+P`) and File → Export → PDF… / HTML…. All three start from the rendered document: the app's stylesheet and theme variables are inlined, diagrams stay the vector SVG they already are, local images and the KaTeX fonts (only when there is math) become data URIs, and the copy buttons, change markers and file-reference links are stripped. The exported page runs no script and fetches nothing: its own Content-Security-Policy forbids both. A dialog asks for the theme (light by default; diagrams are redrawn in the light palette when the app is dark), and for PDF and print the paper size, orientation and whether to print backgrounds; the choices and the last folder are remembered. The PDF keeps text selectable and internal links clickable, avoids page breaks inside code blocks, tables, diagrams and alerts, and keeps headings with what follows them.

- **Front matter**: a document that opens with a `---` YAML block shows it as a collapsible key/value table (nested maps as nested tables, lists as lists) instead of a horizontal rule and a paragraph of `name: foo`. TOML between `+++` is shown as written. Only a block that parses as a YAML mapping counts, so a document that merely starts with a rule is unaffected. Collapsing or expanding the block is remembered (Preferences → Front Matter).

- **GitHub alerts**: `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` render with GitHub's icon, title and colour bar, in both themes. The marker may stand on its own line or run into the text, as generated markdown often has it.

- **Math**: `$…$`, `$$…$$`, `\(…\)` and `\[…\]` render with KaTeX, inline or as display blocks, entirely offline. `$5 and $10` stays text: a single dollar only opens math when not followed by a space, and only closes when not preceded by one and not followed by a digit. Math inside code is left alone, and a broken formula shows in red instead of blanking the document.

- **File references**: `src/app.ts:42`, `README.md`, `path/to/file.ts#L42` and `file.ts:42:7` in code spans, and paths with a folder or line number in prose, become links. Each is resolved against the document's folder, then each parent up to the project root (Preferences → Document → Project Root, or the nearest `.git`); a reference to a file that does not exist reads as plain text. Clicking opens markdown in the viewer and anything else in the external editor at that line (VS Code, Cursor, Sublime, Zed and WebStorm each get their own flag; a custom command may use `{file}`, `{line}` and `{column}`). Hovering shows the resolved path.

- **Code block info strings**: the language is the first word of the fence; `title="src/app.ts"`, `filename=…` or `file=…` draws a title bar; `{2-3}`, `highlight=` or `hl_lines=` call out lines; `diff` blocks colour whole added and removed lines; `env`, `dotenv`, `mdx`, `vue`, `svelte`, `hcl`, `terraform` and `jsonl` fences highlight. A ```` ```mermaid title="…" ```` fence is still a diagram.

- **Footnotes**: `[^1]` references and definitions render with a separator, numbered notes and back links.

- `<details>`/`<summary>` blocks have a border, a clickable summary and spacing in both themes. A fixture covering all of the above lives in `examples/llm-markdown.md`.

- **Clickable task lists**: clicking a checkbox in a rendered task list ticks or unticks it in the file, without entering edit mode. Only the `[ ]`/`[x]` marker on that one line changes; indentation, list marker, casing, CRLF line endings and the rest of the document stay as they were. The write does not re-render the view, and a write that fails (a read-only file, say) puts the view back to what the file says. Preferences → Document → "Clickable task lists" turns it off.

- **Copy button on code blocks**: hovering a fenced code block shows a button in its top-right corner that copies the raw code (not the highlighted HTML), with a check mark for a moment afterwards. A language written on the fence is shown as a small label. `Cmd+Shift+C` copies the block holding the selection, or the one under the mouse. Neither the button nor the label shows up in Select All, find-in-page or a copied document.

- **Copy as Rich Text**: the Copy dropdown has a new entry that puts `text/html` and `text/plain` on the clipboard, so pasting into Slack, Gmail, Notion or Apple Notes keeps headings, bold, lists, tables and code. With text selected in the document it copies the selection; otherwise the whole document, with the markdown source as the plain-text alternative. Right-clicking a heading offers "Copy Section as Rich Text" and "Copy Section as Markdown" for that heading and everything under it.

### Fixed

- Task-list items no longer print their `[ ]` / `[x]` marker next to the checkbox.

- **Open by path**: `Cmd+P` (File → Open Path…) opens a bar to type or paste the path of a document and open it in the current window. A full path, `~/…`, a `file://` URL, a quoted path and a path with shell-escaped spaces are all accepted; anything else is taken as relative to the folder of the document the window shows, or to the home folder when the window is empty. The resolved path is shown as you type, with the reason when it cannot be opened (missing, a folder, not markdown); Enter opens, Esc closes.

- **Open Documents browser**: `Cmd+Shift+D` (View → Browse Open Documents) opens a grid of every open document, each shown as a capture of its document view at its current scroll position, change markers included, without the window chrome. Type to filter by file name or by document content; arrow keys move, Enter brings that window to the front, Esc closes. Recently opened files that are not open anywhere are listed below, filtered by name; picking one fills the current window if it is empty, otherwise opens it in a new one.

- **Document outline**: a sidebar on the left lists every heading, indented by level, with its own scrolling. The section at the top of the view is highlighted and kept in view in the sidebar; clicking a sidebar entry scrolls the document to that heading, and clicking inside a section of the document moves the sidebar to it. Toggle it from the toolbar or View → Toggle Outline (`Cmd+Shift+O`); the choice is remembered. Hidden automatically for documents without headings.

## [1.5.0] - 2026-08-22

### Added

- **Google Docs sync** (experimental, off by default): link a markdown file to a Google Doc and keep the two in step. Enable under Preferences → Experimental Features.
- **Comment-preserving sync**: paragraph-level diffing with character-level diffs inside modified paragraphs, so comments anchored to untouched text survive a sync. Unchanged paragraphs, tables and images are skipped entirely.
- **Pull as well as push.** The toolbar has a button for each direction, so the app never decides which way to reconcile on the user's behalf. Either answers even when there is nothing to carry — "nothing to push" is a result, not silence.
- **Review every difference before it is applied.** A three-pane merge screen lists each changed block with the file's version, the Doc's version and the result, and lets the user settle them one at a time. It appears only when something of theirs is at stake: their own edits during a pull, the Doc's during a push.
- **A panel for the linked document.** Pull, push and "choose the document" are drawn as one segmented control. A sync disables the whole panel behind a single spinner rather than spinning each button, and the spinner stays clickable so a dismissed progress bar can be reopened. The target document can be changed at any time, not only before the first link.
- **Sync progress snackbar**: a bar at the bottom of the window reporting what a sync is doing and how far along it is. Diagram uploads and table inserts each advance it, so the slowest part of a sync visibly moves instead of appearing to hang.
- **Sign-in with Google** via OAuth2 with PKCE; tokens are encrypted at rest with the system keychain. Optional custom OAuth credentials for users who prefer their own Google Cloud project.
- **Tables**, inserted with their inline formatting intact and their column widths matched to the proportions shown in the app.
- **Mermaid diagrams**, rendered to images and uploaded, each with a link back to mermaid.live for editing.
- **Code blocks**, shaded and set in Consolas with syntax colours computed locally. Untagged fences have their language detected against a constrained candidate list, and are left plain when detection is not confident.
- **Google Docs section in Preferences** with sign-out and custom credential settings, shown whenever the feature is enabled or an account is still signed in.

### Changed

- **Linking a file to a Google Doc goes through Google's own file picker** instead of pasting a document URL. Picking a document is what grants access to it, so the app no longer needs the sensitive `documents` scope ("see, edit, create and delete all your Google Docs documents") and requests only per-file `drive.file` access.
- **Choosing a document links it and stops there.** Picking a target says nothing about which way the user wants to reconcile, and there is a button for each.
- **Syncing only sends what actually changed.** Formatting was re-applied to every paragraph on every sync — a paragraph-style request, one request per text run, and a colour reset, for the whole document — which on a large file meant thousands of no-op requests and dominated sync time. Paragraphs whose formatting already matches are left untouched, and a sync where nothing changed does no API work beyond reading the document.
- **Diagrams are only uploaded when they change.** Each rendered image is remembered by a hash of its bytes, so an unchanged diagram reuses the file already in Drive.
- **Diagrams are exported in light mode**, whatever theme the app is in, so a dark-theme window no longer produces unreadable images in the document.
- **Preferences sidebar**: Experimental Features stays at the bottom, Reset to Defaults is pinned to the panel rather than riding up the scrolling list, and sections that exist only because an experimental feature is on carry an `exp` badge.

### Fixed

- **Sign-in and document picking work in the Mac App Store build.** Google's desktop OAuth flow redirects to a loopback HTTP server, and the sandbox denied `listen()` because the app carried `network.client` but not `network.server`. The failure compounded itself: the server was kept even though it never bound, so every later attempt skipped startup and sent Google a redirect on port 0, which browsers refuse outright.
- **A wholesale rewrite no longer destroys the document.** Google applies a batch sequentially, each request seeing what the previous ones left. Ordering the batch by reversing the generated list put an insert ahead of the deletes it shared a position with, so every delete after it landed thousands of characters late — eating the newly inserted text and, past the end of the body, failing the whole request.
- **A wrapped source line no longer costs a document its formatting.** A soft break became a literal newline, which `insertText` reads as the end of a paragraph rather than a line break. One paragraph became two, nothing after it matched its model element, and the text kept whatever style sat above the insertion point — an entire document rendered as headings.
- **Pushed text no longer inherits the style above it.** Only runs that wanted a style were written, so text inserted with no styling of its own kept whatever `insertText` gave it. Bold, italic, strikethrough, link and font are now cleared before the real formatting goes on.
- **Replaced paragraphs no longer leave blank lines behind.** Every delete stopped one character short — a blanket workaround for a restriction that applies only in front of a table, table of contents or section break, and at the end of the body.
- **Blank lines in front of a table can finally be removed.** The old attempt deleted the newline the API refuses to touch unless the table goes with it, inside a `try/catch` that logged and moved on, so it never once worked. Merging the blank into the paragraph above it does the same job legally.
- **Tables, rows and diagrams keep their identity.** They were matched by position, so deleting one table shifted every later one onto the wrong content and a restored row was appended at the bottom — moving every comment anchored below it. Tables now pair by header row, diagrams by their mermaid.live link, and rows by their cell content.
- **Deletes no longer span a table.** Paragraph runs that look adjacent can have a whole table between them, and a range crossing one is refused outright.
- **A markdown table written directly under a list item is recognised as a table**, rather than pushed into the document as literal pipe characters.
- **Syncing no longer leaves stray characters behind when a paragraph changes.** Every delete had one character trimmed to protect a paragraph's trailing newline, but a character-level delete inside a paragraph has no newline to trim — so the last character of every removed run survived. Correcting `**bold**` markers left a lone `*` in the document.
- **Saving straight from an open editor no longer loses the edit.** Text being typed only reaches the document when the editor commits, and committing is also what marks the document as changed. Save checked "is there anything to change?" before that happened, so an edit the user never clicked away from looked like no change at all. Pending edits are now committed before the document is read or judged unchanged.
- **Bolding a word mid-sentence no longer leaves literal asterisks.** Selecting a word by double-click takes its trailing space with it, and a closing `**` preceded by a space is not a valid CommonMark closer. Emphasis markers are now placed inside any surrounding whitespace, for bold, italic and strikethrough alike.
- Select All no longer picks up app chrome. The toolbar, status bar, find bar and drop zone are excluded, so Cmd+A copies the document and nothing else — including the find bar's own search term, which sits inside the viewer.
- Mac App Store uploads no longer fail code-signing validation. The `keychain-access-groups` entitlement used the Xcode build variable `$(AppIdentifierPrefix)`, which nothing in this pipeline expands, so the literal text shipped as the group name and did not match the provisioning profile.
- Window dragging works again across the whole toolbar. Both toolbar halves span the full width, and their `no-drag` region had covered the bar's own drag region, leaving nowhere to grab the window.

### Removed

- The "paste a Google Doc URL" dialog. A pasted address cannot grant per-file access, so it no longer has a way to work.

### Migration

- Existing links created by pasting a URL will stop working, and signing in again is required. Re-link the affected files through the picker.

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
