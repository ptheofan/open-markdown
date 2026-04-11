# Google Docs Sync — Design Document

## Problem

The current workflow for collaborative markdown review:
1. Write markdown locally
2. Copy-paste to Google Docs
3. Reviewers add comments in Google Docs
4. Edit markdown locally
5. Need to update Google Docs with changes — but re-pasting the entire document destroys all reviewer comments
6. Manually copy-paste changed sections one by one

Step 6 is slow, error-prone, and frustrating.

## Solution

Integrate Google Docs sync into the app. The user links a markdown file to a Google Doc, and the app pushes changes surgically via the Google Docs API — preserving reviewer comments on unchanged (and even modified) text.

## Workflow

1. User creates an empty Google Doc and shares it with reviewers
2. In the app, user pastes the Google Doc URL → "Link to Google Docs"
3. User authenticates with Google (one-time OAuth2 flow)
4. First sync: app populates the entire doc via Docs API
5. Reviewers add comments in Google Docs
6. User edits markdown, clicks "Sync to Google Docs"
7. App reads current doc, diffs against baseline, applies only changes → comments survive

## Sync Direction

**v1: One-way (Markdown → Google Docs)** with three-way baseline tracking.

The three-way infrastructure stores what was last synced, enabling detection of external edits to the Google Doc. This positions v2 to support reverse sync (Google Docs → Markdown) without rearchitecting.

## Architecture

### New Components

| Component | Process | Responsibility |
|-----------|---------|----------------|
| `GoogleAuthService` | main | OAuth2 + PKCE flow, token storage/refresh, credential source selection |
| `GoogleDocsService` | main | Google Docs API and Drive API communication |
| `GoogleDocsSyncService` | main | Orchestrates sync: convert, diff, generate batch updates |
| `GoogleDocsLinkStore` | main | Manages file → doc mappings and baseline snapshots |
| `MarkdownToDocsConverter` | main | Converts markdown-it token stream → Docs API document structure |
| IPC handlers | main | New channels for link/unlink, sync, auth |
| UI components | renderer | Link dialog, sync button, auth flow, status indicator |

### Data Flow

```
User clicks "Sync to Google Docs"
  → Renderer sends IPC
  → GoogleDocsSyncService:
      1. MarkdownToDocsConverter: markdown → Docs API structure
      2. GoogleDocsService: read current doc content
      3. GoogleDocsLinkStore: read baseline (last synced content)
      4. Three-way diff: baseline vs current doc vs new markdown
      5. If doc was externally edited: warn user, await confirmation
      6. Generate minimal batchUpdate requests (reverse index order)
      7. GoogleDocsService: apply batch updates
      8. GoogleDocsLinkStore: update baseline snapshot
  → Renderer shows success/failure toast
```

## Authentication

### OAuth2 with PKCE (no client secret)

Desktop apps are public clients. PKCE replaces the client secret.

- **Flow:** App opens system browser → Google consent screen → redirect to `http://localhost:<port>/callback` → app captures auth code → exchanges for tokens using PKCE verifier
- **Scopes:**
  - `https://www.googleapis.com/auth/documents` — read/write docs
  - `https://www.googleapis.com/auth/drive.file` — upload mermaid images (scoped to app-created files only)
- **Token storage:** Encrypted via Electron `safeStorage` API, stored in user data directory
- **Token refresh:** Automatic via refresh token before expiry

### Credential Sources

1. **Default: Built-in app credentials** — Ships with Client ID only (public, not sensitive). Zero friction.
2. **Custom: User-provided credentials** — User creates a "Desktop app" OAuth client in Google Cloud Console, pastes Client ID in Preferences. For corporate environments and security-conscious users.

The app checks for user-provided credentials first, falls back to built-in.

## Link Storage

Stored in app user data directory (not in the markdown file or repo):

```
~/Library/Application Support/open-markdown/
  google-docs-links.json          # file path → doc mapping
  google-docs-sync/
    <docId>.baseline.txt          # full text snapshot of last sync per doc
```

**links.json structure:**
```json
{
  "/Users/pt/work/project/README.md": {
    "docId": "1aBcDeFgHiJkLmNoPqRsTuVwXyZ",
    "lastSyncedAt": "2026-03-09T14:30:00Z"
  }
}
```

Baseline stored as separate files to keep the JSON clean and avoid bloat.

## Sync & Diffing Logic

### First Sync (empty doc)

1. Parse markdown with existing markdown-it pipeline
2. Walk token stream, build ordered Docs API operations:
   - `InsertText` for content
   - `UpdateParagraphStyle` for headings (HEADING_1 through HEADING_6)
   - `UpdateTextStyle` for bold, italic, inline code, links
   - `InsertTable` for tables
   - `InsertInlineImage` for mermaid PNGs (uploaded to Drive first)
   - `CreateParagraphBullets` for lists
3. Send as single `batchUpdate` request
4. Store baseline snapshot

### Subsequent Syncs (three-way diff)

**Three-way model:**

| Source | Description |
|--------|-------------|
| Base | What we last pushed (stored locally as baseline) |
| Theirs | Current Google Doc content (read from API) |
| Ours | Current markdown content |

**Logic:**

- `base == theirs` → No external edits. Apply our changes freely.
- `base != theirs` → External edits detected. Warn user: "Google Doc has been edited since last sync. Overwrite?" → Overwrite / Cancel.

**Diffing steps:**

1. Read current doc via `documents.get` (returns text + element positions)
2. Build plain text + formatting map from current doc
3. Convert new markdown → same plain text + formatting map
4. Character-level diff using `diff` library (already a project dependency)
5. Generate batch operations in **reverse document order** (so earlier indices stay valid):
   - Delete hunks → `DeleteContentRange`
   - Insert hunks → `InsertText` + `UpdateTextStyle` / `UpdateParagraphStyle`
   - Equal hunks → check formatting changes, apply style updates only if needed

### Structural Elements

- **Mermaid diagrams:** Compare source code. If changed, upload new PNG to Drive, replace `InlineImage`. If unchanged, skip.
- **Tables:** If changed, delete and re-insert (tables are hard to diff cell-by-cell via the API; comments on tables are uncommon).
- **Images:** Compare source, replace if changed.

### Comment Preservation

| Scenario | Comment preserved? |
|----------|-------------------|
| Surrounding text untouched | Yes |
| Text under comment edited (not deleted) | Yes — anchor shifts with insertions |
| Text under comment fully deleted | No — unavoidable, same as Google Docs UI |
| Paragraph moved to different position | No — this is a delete + insert |
| Formatting-only change | Yes — style updates don't affect anchors |

## Formatting

Replicates the same rich formatting as the existing "Copy for Google Docs" feature:

- Headings (h1–h6) → Google Docs heading styles
- Bold, italic, inline code → text style runs
- Code blocks → monospace with background
- Links → hyperlinks
- Ordered/unordered lists → Docs bullet/number lists
- Tables → Docs tables with borders
- Blockquotes → indented with left border
- Horizontal rules → border styling
- Mermaid diagrams → PNG image + "Edit in Mermaid Live" link

## UI/UX

### Toolbar

New button with contextual states:

| State | Button label | Action |
|-------|-------------|--------|
| Not linked | "Link to Google Docs" | Opens link dialog |
| Linked, not authenticated | "Sign in to Google" | Triggers OAuth flow |
| Linked & authenticated | "Sync to Google Docs" | Triggers sync |
| Syncing | Spinner | Disabled |

### Link Dialog

- Modal with text input for Google Doc URL
- Validates URL format, extracts doc ID
- "Link" and "Cancel" buttons
- "Unlink" option if already linked

### OAuth Flow

- Click "Sign in" → system browser opens consent screen
- App shows "Waiting for authorization..." state
- Success: toast "Signed in to Google", token stored
- Failure: toast with error message

### Sync Feedback

- Success: toast "Synced to Google Docs" with timestamp
- External edits detected: modal "Google Doc has been edited since last sync. Overwrite with your changes?" → Overwrite / Cancel
- Error: toast with message (auth expired, network, permissions)

### Status Bar

Small indicator showing: "Linked to Google Docs · Last synced 2 min ago"

### Settings / Preferences

- **Google Docs section:**
  - "Use custom Google API credentials" toggle
  - Client ID text input (shown when toggle is on)
  - "Sign out of Google" button
  - Current auth status display

## Future (v2)

The three-way baseline enables these without rearchitecting:

- **Reverse sync (Google Docs → Markdown):** Pull reviewer text edits back into the markdown file
- **Auto-merge:** When changes are in different sections, merge both directions automatically
- **Conflict resolution UI:** When the same section is edited in both places, show both versions and let user choose
- **Google Docs → Markdown converter:** Reverse-convert Docs API structure back to markdown syntax
