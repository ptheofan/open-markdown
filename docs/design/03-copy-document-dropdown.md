# Copy Document Dropdown - Technical Design Document

**Author:** Claude
**Date:** 2026-01-22
**Status:** Completed

---

## 1. Problem Statement

Users need to share markdown documents in formats suitable for external tools:

1. **Google Docs**: Copy as rich text that pastes correctly into Google Docs, with mermaid diagrams converted to PNG images + mermaid.live edit links (matching existing context menu behavior)

2. **Image sharing**: Copy the entire rendered document as a single PNG image, preserving exact visual appearance including current zoom level

Currently, users can only copy individual mermaid diagrams via context menu. There's no way to copy the entire document.

## 2. Goals & Non-Goals

### Goals

- Add a dropdown button to toolbar (left of settings) with two copy options
- **Copy for Google Docs**: Rich text matching Google Docs markdown import format, mermaid → image + link
- **Copy as Image**: Full document PNG at current zoom level, exactly as rendered
- Provide toast feedback on success/failure
- Disable/hide when no document is loaded

### Non-Goals

- Other export formats (PDF, Word, etc.)
- Partial document selection
- Customizable export settings via preferences
- File save dialogs (clipboard only)

## 3. Proposed Solution

Add a dropdown button to the toolbar with two menu items. Each triggers a different copy operation handled by a new `DocumentCopyService`.

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Renderer Process                          │
├─────────────────────────────────────────────────────────────────┤
│  Toolbar                                                         │
│    └── CopyDropdown (new)                                       │
│          ├── "Copy for Google Docs" ──┐                         │
│          └── "Copy as Image" ─────────┼─► onCopyDocument(type)  │
│                                       │                          │
│  App (renderer.ts)                    │                          │
│    └── handleCopyDocument(type) ◄─────┘                         │
│          │                                                       │
│          ▼                                                       │
│  DocumentCopyService (new)                                       │
│    ├── copyForGoogleDocs()                                       │
│    │     ├── cloneContent()                                      │
│    │     ├── processMermaidDiagrams() → MermaidPlugin            │
│    │     ├── convertToGoogleDocsHtml()                          │
│    │     └── clipboard.writeHtml() ─────────────────────────────┼──┐
│    │                                                             │  │
│    └── copyAsImage()                                             │  │
│          ├── getScrollContainer()                                │  │
│          ├── captureFullDocument() → html-to-image               │  │
│          └── clipboard.writeImage() ────────────────────────────┼──┤
│                                                                  │  │
│  Toast                                                           │  │
│    └── show() (success/error feedback)                          │  │
└─────────────────────────────────────────────────────────────────┘  │
                                                                     │
┌─────────────────────────────────────────────────────────────────┐  │
│                         Main Process                             │  │
├─────────────────────────────────────────────────────────────────┤  │
│  ClipboardHandler (existing)                                     │  │
│    ├── clipboard:write-html ◄────────────────────────────────────┘
│    └── clipboard:write-image ◄───────────────────────────────────┘
│          │
│          ▼
│  ClipboardService (existing)
│    ├── writeHtml()
│    └── writeImage()
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Boundaries

| Module | Exposes | Consumes |
|--------|---------|----------|
| Toolbar | `onCopyDocument(type: CopyDocumentType)` callback | - |
| CopyDropdown (new) | Dropdown UI component | Toolbar integration |
| DocumentCopyService (new) | `copyForGoogleDocs()`, `copyAsImage()` | MermaidPlugin, ClipboardAPI, html-to-image |
| MermaidPlugin (existing) | `renderToPng()`, `generateMermaidLiveUrl()`, `decodeFromAttribute()` - expose publicly | - |
| ZoomController (existing) | `getCurrentZoom()` | - |
| ClipboardService (existing) | `writeHtml()`, `writeImage()` | Electron clipboard |

### 3.3 Data Model

```typescript
/**
 * Types of document copy operations
 */
type CopyDocumentType = 'google-docs' | 'image';

/**
 * Options for copy operations
 */
interface DocumentCopyOptions {
  /** The markdown content container element */
  contentElement: HTMLElement;
  /** The scroll container for full-page capture */
  scrollContainer: HTMLElement;
  /** Plugin manager to access MermaidPlugin */
  pluginManager: PluginManager;
  /** Current zoom level (1.0 = 100%) */
  zoomLevel: number;
}

/**
 * Result of document copy operation
 */
interface DocumentCopyResult {
  success: boolean;
  error?: string;
  /** For google-docs: number of mermaid diagrams processed */
  diagramCount?: number;
  /** For image: dimensions of captured image */
  dimensions?: { width: number; height: number };
}
```

### 3.4 API Design

#### DocumentCopyService

```typescript
/**
 * Service for copying document content to clipboard
 * Location: src/renderer/services/DocumentCopyService.ts
 */
export class DocumentCopyService {
  constructor(private clipboardApi: ClipboardAPI) {}

  /**
   * Copy document as Google Docs-compatible rich text HTML
   * - Clones rendered content
   * - Converts mermaid diagrams to PNG + mermaid.live links
   * - Applies inline styles matching Google Docs markdown import
   */
  copyForGoogleDocs(options: DocumentCopyOptions): Promise<DocumentCopyResult>;

  /**
   * Copy document as a full-page PNG image
   * - Captures entire scrollable content at current zoom level
   * - Uses html-to-image library (already in project)
   * - Maintains exact visual appearance
   */
  copyAsImage(options: DocumentCopyOptions): Promise<DocumentCopyResult>;
}

export function createDocumentCopyService(
  clipboardApi: ClipboardAPI
): DocumentCopyService;
```

#### Toolbar Extension

```typescript
/**
 * Copy document type for dropdown selection
 */
type CopyDocumentType = 'google-docs' | 'image';

/**
 * Extended toolbar callbacks
 */
interface ToolbarCallbacks {
  onOpenFile?: () => void;
  onToggleTheme?: () => void;
  onOpenPreferences?: () => void;
  onCopyDocument?: (type: CopyDocumentType) => void; // New
}
```

#### CopyDropdown Component

```typescript
/**
 * Dropdown button for document copy options
 * Location: src/renderer/components/CopyDropdown.ts
 */
export interface CopyDropdownCallbacks {
  onSelect: (type: CopyDocumentType) => void;
}

export class CopyDropdown {
  constructor(container: HTMLElement);

  /** Set selection callback */
  setCallbacks(callbacks: CopyDropdownCallbacks): void;

  /** Enable/disable the dropdown (for document loaded state) */
  setEnabled(enabled: boolean): void;

  /** Set loading state (spinner + disabled during operation) */
  setLoading(loading: boolean): void;

  /** Show/hide the dropdown menu */
  private toggleMenu(): void;
}

export function createCopyDropdown(container: HTMLElement): CopyDropdown;
```

#### MermaidPlugin Public API Extension

```typescript
/**
 * Methods to expose publicly (currently private)
 */
interface MermaidPlugin {
  // Existing public methods...

  /**
   * Render a mermaid container to PNG base64
   * @param container - The .mermaid-container element
   * @returns Base64 PNG string (without data: prefix)
   */
  renderToPng(container: HTMLElement): Promise<string>;

  /**
   * Generate mermaid.live edit URL
   * @param code - Raw mermaid diagram code
   * @returns Full mermaid.live URL
   */
  generateMermaidLiveUrl(code: string): string;

  /**
   * Decode mermaid source from element attribute
   * @param encoded - Base64 encoded source from data-mermaid-source
   * @returns Original mermaid code
   */
  decodeFromAttribute(encoded: string): string;
}
```

### 3.5 Copy as Image Implementation

Use `html-to-image` library (already used by MermaidPlugin) to capture the full document:

```typescript
async copyAsImage(options: DocumentCopyOptions): Promise<DocumentCopyResult> {
  const { contentElement, scrollContainer, zoomLevel } = options;

  // Get full scrollable dimensions
  const fullWidth = scrollContainer.scrollWidth;
  const fullHeight = scrollContainer.scrollHeight;

  // Capture at current zoom level
  // The content is already scaled by CSS transform, so pixelRatio handles resolution
  const dataUrl = await toPng(contentElement, {
    width: fullWidth,
    height: fullHeight,
    pixelRatio: 2, // High quality
    backgroundColor: getComputedStyle(document.documentElement)
      .getPropertyValue('--bg').trim(),
  });

  // Extract base64 and write to clipboard
  const base64 = dataUrl.split(',')[1];
  await this.clipboardApi.writeImage(base64);

  return {
    success: true,
    dimensions: { width: fullWidth, height: fullHeight },
  };
}
```

### 3.6 Google Docs HTML Format

HTML with inline styles that Google Docs preserves when pasting:

```html
<!-- Headings -->
<h1 style="font-size: 20pt; font-weight: bold; margin: 16pt 0 8pt 0;">Heading 1</h1>
<h2 style="font-size: 16pt; font-weight: bold; margin: 14pt 0 6pt 0;">Heading 2</h2>
<h3 style="font-size: 14pt; font-weight: bold; margin: 12pt 0 4pt 0;">Heading 3</h3>

<!-- Paragraphs with inline formatting -->
<p style="font-size: 11pt; margin: 0 0 8pt 0;">
  Text with <strong>bold</strong> and <em>italic</em> and <code style="font-family: 'Courier New', monospace; background-color: #f5f5f5; padding: 2px 4px; border-radius: 2px;">inline code</code>
</p>

<!-- Code blocks -->
<pre style="font-family: 'Courier New', monospace; font-size: 10pt; background-color: #f5f5f5; padding: 12px; border-radius: 4px; margin: 8pt 0; white-space: pre-wrap;"><code>function example() {
  return 'code block';
}</code></pre>

<!-- Lists -->
<ul style="margin: 8pt 0; padding-left: 24pt;">
  <li style="font-size: 11pt; margin: 4pt 0;">List item</li>
</ul>
<ol style="margin: 8pt 0; padding-left: 24pt;">
  <li style="font-size: 11pt; margin: 4pt 0;">Numbered item</li>
</ol>

<!-- Links -->
<a href="https://example.com" style="color: #1a73e8; text-decoration: underline;">Link text</a>

<!-- Tables -->
<table style="border-collapse: collapse; margin: 8pt 0;">
  <thead>
    <tr>
      <th style="border: 1px solid #dadce0; padding: 8px 12px; background-color: #f8f9fa; font-weight: bold; text-align: left;">Header</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border: 1px solid #dadce0; padding: 8px 12px;">Cell content</td>
    </tr>
  </tbody>
</table>

<!-- Mermaid diagrams: image + link -->
<div style="margin: 16pt 0;">
  <img src="data:image/png;base64,..." alt="Mermaid diagram" style="max-width: 100%;"/>
  <p style="font-size: 10pt; margin: 4pt 0 0 0;">
    <a href="https://mermaid.live/edit#pako:..." style="color: #1a73e8;">Edit in Mermaid Live</a>
  </p>
</div>

<!-- Blockquotes -->
<blockquote style="border-left: 4px solid #dadce0; margin: 8pt 0; padding: 8pt 16pt; color: #5f6368;">
  <p style="margin: 0;">Quoted text</p>
</blockquote>

<!-- Horizontal rules -->
<hr style="border: none; border-top: 1px solid #dadce0; margin: 16pt 0;"/>
```

### 3.7 UI Design

#### Dropdown Button Placement

```
┌─────────────────────────────────────────────────────────────────┐
│ [Open]                    filename.md           [💾▾][⚙][🌙]  │
└─────────────────────────────────────────────────────────────────┘
                                                    ↑
                                         New dropdown (disk icon)
```

#### Dropdown Menu

```
┌─────────────────────────────┐
│ Copy for Google Docs        │
├─────────────────────────────┤
│ Copy as Image               │
└─────────────────────────────┘
```

#### Loading State

```
┌─────────────────────────────────────────────────────────────────┐
│ [Open]                    filename.md           [⟳ ][⚙][🌙]   │
└─────────────────────────────────────────────────────────────────┘
                                                    ↑
                                         Spinner replaces icon,
                                         button disabled
```

#### HTML Structure Addition to index.html

```html
<div class="toolbar-right">
  <div class="toolbar-spacer"></div>

  <!-- New: Copy dropdown -->
  <div id="copy-dropdown" class="toolbar-dropdown">
    <button id="copy-dropdown-btn" class="toolbar-btn" title="Copy document" disabled>
      <svg><!-- disk/save icon --></svg>
      <svg class="dropdown-arrow"><!-- small chevron down --></svg>
      <div class="spinner hidden"><!-- loading spinner overlay --></div>
    </button>
    <div class="dropdown-menu hidden">
      <button data-copy-type="google-docs" class="dropdown-item">
        Copy for Google Docs
      </button>
      <button data-copy-type="image" class="dropdown-item">
        Copy as Image
      </button>
    </div>
  </div>

  <button id="preferences-btn" class="toolbar-btn" title="Preferences">
    <!-- existing -->
  </button>
  <!-- ... -->
</div>
```

#### Loading State Behavior

During copy operations:
1. Button becomes disabled (prevents clicks)
2. Spinner overlay appears over the button icon
3. Dropdown menu closes and cannot be opened
4. On completion (success or failure): spinner hides, button re-enables, toast shows result

### 3.8 Error Handling

| Error Class | When Thrown | Data Included |
|-------------|-------------|---------------|
| `DocumentCopyError` | Base class for copy errors | `message`, `cause` |
| `NoDocumentError` | Copy attempted with no document loaded | - |
| `MermaidRenderError` | Failed to render mermaid diagram (google-docs) | `diagramIndex`, `errorMessage` |
| `ImageCaptureError` | Failed to capture document as image | `cause` |
| `ClipboardWriteError` | Failed to write to clipboard | `clipboardType`, `cause` |

Error strategy:
- **Google Docs copy**: If a mermaid diagram fails, log warning, skip it, continue with rest
- **Image copy**: If capture fails, show error toast, abort
- Both: Show success/failure toast to user

## 4. Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **A: Dropdown button** | Groups related actions, extensible | Slightly more complex UI | **Selected** - clean UX for multiple options |
| B: Two separate buttons | Simpler implementation | Clutters toolbar | Rejected |
| C: Context menu on document | Consistent with mermaid | Not discoverable for "whole document" | Rejected |

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **A: html-to-image for screenshot** | Already in project, proven | May have issues with very long documents | **Selected** - reuse existing dependency |
| B: Electron native screenshot | More reliable | Captures window chrome, complex | Rejected |
| C: Canvas rendering | Full control | Significant implementation effort | Rejected |

## 5. Testing Strategy

### Unit Tests

**DocumentCopyService - copyForGoogleDocs()**
- Returns error when container is empty
- Produces valid HTML structure for headings (h1-h6)
- Handles bold, italic, inline code
- Handles fenced code blocks with language
- Handles ordered and unordered lists (including nested)
- Handles tables with headers
- Handles links and images
- Handles blockquotes
- Handles horizontal rules
- Processes mermaid diagrams to images + links
- Continues if one mermaid diagram fails
- Reports correct diagram count

**DocumentCopyService - copyAsImage()**
- Returns error when container is empty
- Calls html-to-image with correct dimensions
- Uses current zoom level
- Applies background color from theme
- Returns dimensions in result

**CopyDropdown**
- Renders button with disk icon and dropdown arrow
- Opens menu on click
- Closes menu on outside click
- Closes menu on Escape key
- Emits correct type on item selection
- Disabled state prevents interaction
- Loading state shows spinner and disables button
- Loading state closes and prevents menu opening

### Integration Tests

- Toolbar shows copy dropdown when document loaded
- Toolbar hides/disables copy dropdown when no document
- Copy for Google Docs writes HTML to clipboard
- Copy as Image writes PNG to clipboard
- Toast appears on success
- Toast appears on failure

### E2E Tests (Manual)

- Copy for Google Docs → Paste in Google Docs → Verify formatting
- Copy as Image → Paste in image editor → Verify dimensions match zoom
- Very long document → Copy as Image → Verify complete capture

## 6. Migration / Rollout Plan

- [ ] No feature flag needed - additive feature
- [ ] No database migrations
- [ ] No backward compatibility concerns

Implementation order:
1. Add `DocumentCopyService` with unit tests
2. Expose MermaidPlugin methods publicly
3. Add `CopyDropdown` component with styles
4. Update `Toolbar` to include dropdown
5. Update `index.html` with dropdown markup
6. Wire up in `App` coordinator
7. Manual QA with Google Docs
8. Release

## 7. Design Decisions

1. **Button icon**: Disk/save icon with dropdown arrow indicator

2. **Very long documents**: No size limit - allow capture of any document length

3. **Loading state**: Spinner overlay on button + button disabled during operation

## 8. References

- Existing: `MermaidPlugin.getContextMenuData()` for image + link copy
- Existing: `html-to-image` usage in `MermaidPlugin.renderToPng()`
- Google Docs HTML paste: Internal testing required
- Electron clipboard: https://www.electronjs.org/docs/latest/api/clipboard
