# File Association Button - Technical Design Document

**Author:** Claude
**Date:** 2026-01-22
**Status:** Draft

---

## 1. Problem Statement

Users want to open `.md` files directly from Finder by double-clicking them. While the app already declares file associations in `forge.config.ts`, macOS doesn't automatically set this app as the default handler. Users need a way to:

This was added after file was opened. You can easily see changes
As well as removals without having to read through the entire document
again and again. Quite handy when working with claude-code or similar models.

1. Register the app as a handler for `.md` files
2. Have the app actually open files when launched via Finder/file association

## 2. Goals & Non-Goals

### Goals

- Add a button in Preferences to set this app as the default handler for markdown files
- Support all markdown extensions: `.md`, `.markdown`, `.mdown`, `.mkdn`, `.mkd`
- Handle `app.on('open-file')` events to open markdown files passed by the OS
- Handle command-line arguments for files (e.g., `./markdown-viewer file.md`)
- Clicking the button automatically registers association (no manual steps)
- Show appropriate feedback when association succeeds or fails
- Work correctly whether app is already running or freshly launched

### Non-Goals

- Cross-platform support (Windows/Linux) - focus on macOS first
- Custom protocol handler (`markdown-viewer://`) - existing config is sufficient
- Menu bar item for setting association - Preferences only
- Undo/remove association functionality

## 3. Proposed Solution

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Main Process                             │
│  ┌──────────────────┐   ┌────────────────────────────────────┐  │
│  │ FileAssociation  │   │         app lifecycle              │  │
│  │    Service       │   │  ┌────────────────────────────┐    │  │
│  │                  │   │  │ open-file event handler    │    │  │
│  │ - setAsDefault() │   │  │ - stores pending file path │    │  │
│  │ - isDefault()    │   │  │ - sends to renderer when   │    │  │
│  │ - canSetDefault()│   │  │   window is ready          │    │  │
│  └────────┬─────────┘   │  └────────────────────────────┘    │  │
│           │             └────────────────────────────────────┘  │
│           │ IPC                                                  │
└───────────┼──────────────────────────────────────────────────────┘
            │
┌───────────┼──────────────────────────────────────────────────────┐
│           ▼            Renderer Process                          │
│  ┌──────────────────┐   ┌────────────────────────────────────┐  │
│  │ PreferencesPanel │   │           App                       │  │
│  │                  │   │  - listens for file:open-external   │  │
│  │ [Set as Default] │   │  - loads file into viewer           │  │
│  │    button        │   │                                     │  │
│  └──────────────────┘   └────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Boundaries

| Module | Exposes | Consumes |
|--------|---------|----------|
| `FileAssociationService` | `setAsDefault()`, `isDefault()`, `canSetDefault()` | Electron `app` API |
| `FileAssociationHandler` | IPC handlers for `file-association:*` | `FileAssociationService` |
| `PreferencesPanel` | UI button | `window.electronAPI.fileAssociation` |
| `App (main)` | `open-file` event handling | `FileService`, window management |
| `App (renderer)` | File loading on external open | `MarkdownViewer`, `electronAPI` |

### 3.3 Data Model

```typescript
/**
 * Supported markdown file extensions
 */
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkdn', '.mkd'] as const;
type MarkdownExtension = typeof MARKDOWN_EXTENSIONS[number];

/**
 * Result of attempting to set file association
 */
interface FileAssociationResult {
  success: boolean;
  error?: FileAssociationErrorCode;
}

/**
 * Error codes for file association operations
 */
type FileAssociationErrorCode =
  | 'NOT_SUPPORTED'      // Platform doesn't support this operation
  | 'NOT_PACKAGED'       // Running in development (not packaged app)
  | 'PERMISSION_DENIED'  // User denied permission or OS blocked
  | 'UNKNOWN';           // Unexpected error

/**
 * Current file association status
 */
interface FileAssociationStatus {
  isDefault: boolean;
  canSetDefault: boolean;  // false in dev mode or unsupported platform
}

/**
 * Event sent to renderer when file opened externally
 */
interface ExternalFileOpenEvent {
  filePath: string;
}
```

### 3.4 API Design

#### IPC Channels (add to `IPC_CHANNELS`)

```typescript
FILE_ASSOCIATION: {
  GET_STATUS: 'file-association:get-status',
  SET_AS_DEFAULT: 'file-association:set-as-default',
  ON_EXTERNAL_OPEN: 'file-association:on-external-open',
}
```

#### Main Process Service

```typescript
interface FileAssociationService {
  /**
   * Check if app is currently the default handler for .md files
   */
  isDefault(): boolean;

  /**
   * Check if setting default is supported (packaged app on macOS)
   */
  canSetDefault(): boolean;

  /**
   * Attempt to set app as default handler for .md files
   * On macOS, uses app.setAsDefaultProtocolClient() for bundled apps
   * or falls back to Launch Services API
   */
  setAsDefault(): FileAssociationResult;

  /**
   * Get combined status
   */
  getStatus(): FileAssociationStatus;
}
```

#### Electron API Extension (preload bridge)

```typescript
interface FileAssociationAPI {
  getStatus: () => Promise<FileAssociationStatus>;
  setAsDefault: () => Promise<FileAssociationResult>;
  onExternalOpen: (callback: (event: ExternalFileOpenEvent) => void) => () => void;
}

// Add to ElectronAPI interface
interface ElectronAPI {
  // ... existing
  fileAssociation: FileAssociationAPI;
}
```

### 3.5 Error Handling

| Error Class | When Thrown | Data Included |
|-------------|-------------|---------------|
| `FileAssociationError` | Setting default fails | `errorCode: FileAssociationErrorCode`, `originalError?: Error` |

```typescript
class FileAssociationError extends DomainError {
  constructor(
    public readonly errorCode: FileAssociationErrorCode,
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
  }
}
```

### 3.6 Main Process: `open-file` Event Handling

The main process must handle files opened via Finder. Key considerations:

1. **Before window ready**: Store file path, open when window loads
2. **While app running**: Send to existing window via IPC
3. **Command-line args**: Parse `process.argv` on startup

```typescript
// Pseudocode for main/index.ts additions

let pendingFilePath: string | null = null;

// macOS: Handle file open before app is ready
app.on('open-file', (event, filePath) => {
  event.preventDefault();

  const mainWindow = getMainWindow();
  if (mainWindow.isReady()) {
    // Send to renderer immediately
    mainWindow.send(IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN, { filePath });
  } else {
    // Store for later
    pendingFilePath = filePath;
  }
});

// After window is ready, send pending file
function onWindowReady(): void {
  if (pendingFilePath) {
    mainWindow.send(IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN, {
      filePath: pendingFilePath
    });
    pendingFilePath = null;
  }
}

// Also check process.argv for command-line file argument
function checkCommandLineArgs(): void {
  const markdownExtensions = ['.md', '.markdown', '.mdown', '.mkdn', '.mkd'];
  const filePath = process.argv.find(arg =>
    markdownExtensions.some(ext => arg.endsWith(ext)) && !arg.startsWith('-')
  );
  if (filePath) {
    pendingFilePath = filePath;
  }
}
```

### 3.7 Preferences Panel UI

Add a new "System" section to PreferencesPanel with:

```
┌─────────────────────────────────────────┐
│ ▼ System                                │
├─────────────────────────────────────────┤
│                                         │
│  File Associations                      │
│  ┌───────────────────────────────────┐  │
│  │ Make Markdown Viewer the default  │  │
│  │ app for markdown files            │  │
│  │ (.md, .markdown, .mdown, .mkdn,   │  │
│  │  .mkd)                            │  │
│  │                                   │  │
│  │ [Set as Default]  ✓ Already set   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ⚠ Only available in packaged app      │
│  (shown in dev mode)                    │
│                                         │
└─────────────────────────────────────────┘
```

States:
- **Can set**: Show enabled button
- **Already default**: Show disabled button with checkmark
- **Dev mode**: Show disabled button with info message
- **Error**: Show button with error message, allow retry

## 4. Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **A: Button in Preferences** | Discoverable, consistent with macOS patterns | Requires UI work | ✅ Chosen |
| **B: Menu bar item** | Quick access | Hidden, not standard location | Rejected |
| **C: First-run prompt** | One-time setup | Intrusive, users may not want it | Rejected |
| **D: Auto-register on install** | Zero friction | No user control, may conflict with existing prefs | Rejected |

### macOS Implementation Approach

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **`app.setAsDefaultProtocolClient`** | Built-in Electron API | Only works for URL protocols, not file extensions | Rejected for files |
| **Launch Services API via `duti` CLI** | Simple, reliable, no compilation | Requires bundling `duti` binary | ✅ Chosen |
| **Launch Services via native module** | Full control, proper API | Requires native compilation, complex | Rejected |
| **Guide user to System Preferences** | No dependencies | Manual steps, poor UX | Rejected |

**Final Decision**: Use `duti` CLI tool bundled with the app.

`duti` is a small (~50KB) command-line utility that sets default applications for document types on macOS using Launch Services. It's the standard solution for programmatic file association on macOS.

```typescript
// Implementation approach
import { execSync } from 'child_process';
import path from 'path';

// duti bundled in resources/bin/duti
const dutiPath = path.join(process.resourcesPath, 'bin', 'duti');
const bundleId = 'com.aralu.markdown-viewer';

// Set as default for each UTI
const utis = [
  'net.daringfireball.markdown',  // Standard markdown UTI
  'public.plain-text',            // Fallback for .md files
];

for (const uti of utis) {
  execSync(`"${dutiPath}" -s ${bundleId} ${uti} viewer`);
}
```

**Note**: `duti` must be included in the app bundle under `resources/bin/duti`. It can be downloaded from https://github.com/moretension/duti or installed via Homebrew for development.

## 5. Testing Strategy

### Unit Tests

- `FileAssociationService.isDefault()` returns correct status
- `FileAssociationService.canSetDefault()` returns false in dev mode
- `FileAssociationService.setAsDefault()` returns appropriate error codes
- Error classes include correct data

### Integration Tests

- IPC handlers respond correctly to all operations
- `open-file` event stores pending path when window not ready
- `open-file` event sends to renderer when window ready
- Command-line argument parsing extracts file path

### E2E Tests (Manual)

- Package app, double-click .md file → opens in app
- Set as default button updates status correctly
- App already running + double-click .md → opens in existing window

## 6. Migration / Rollout Plan

- [ ] No feature flag needed - additive feature
- [ ] No database migrations
- [ ] No backward compatibility concerns - new functionality
- [ ] Bundle `duti` binary (~50KB) in `resources/bin/`
- [ ] Update `forge.config.ts` to include `resources/bin` in package

## 7. Implementation Order

1. **Bundle `duti` binary** - Add to `resources/bin/duti`, update forge config to include
2. **Main process `open-file` handler** - Enable file opening to work at all
3. **`FileAssociationService`** - Core logic using `duti` for checking/setting status
4. **IPC handler + preload bridge** - Wire up to renderer
5. **PreferencesPanel UI** - New "System" section with button and status display
6. **Error handling + user feedback** - Polish

## 8. Open Questions

None - all questions resolved.

## 9. References

- [duti - command-line utility for macOS file associations](https://github.com/moretension/duti)
- [Electron open-file event](https://www.electronjs.org/docs/latest/api/app#event-open-file-macos)
- [macOS Launch Services](https://developer.apple.com/documentation/coreservices/launch_services)
- [Uniform Type Identifiers for Markdown](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/UTIRef/Articles/System-DeclaredUniformTypeIdentifiers.html)
- Existing: `forge.config.ts` CFBundleDocumentTypes configuration
