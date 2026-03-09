# Google Docs Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One-way markdown → Google Docs sync with surgical updates that preserve reviewer comments.

**Architecture:** OAuth2+PKCE auth, markdown-it tokens → Docs API structure converter, three-way diffing (baseline/theirs/ours) with character-level diffs applied in reverse index order. Link store + baseline snapshots in app userData.

**Tech Stack:** Electron (main process), google-auth-library (OAuth), native fetch (API calls), diff library (already installed), markdown-it token stream.

---

### Task 1: Add Dependencies & Entitlements

**Files:**
- Modify: `package.json`
- Modify: `resources/entitlements.mac.plist`

**Step 1: Install google-auth-library**

```bash
npm install google-auth-library
```

This gives us OAuth2 with PKCE support without pulling in the full googleapis bundle. We'll use native `fetch` for Docs/Drive API calls.

**Step 2: Add network entitlement for direct distribution**

In `resources/entitlements.mac.plist`, add inside the `<dict>`:

```xml
<key>com.apple.security.network.client</key>
<true/>
```

MAS build already has this. Direct distribution build needs it for OAuth + API calls.

**Step 3: Commit**

```bash
git add package.json package-lock.json resources/entitlements.mac.plist
git commit -m "feat(gdocs): add google-auth-library dependency and network entitlement"
```

---

### Task 2: Shared Types & IPC Channels

**Files:**
- Create: `src/shared/types/google-docs.ts`
- Modify: `src/shared/types/api.ts` (add IPC channels + API interface)
- Modify: `src/shared/types/preferences.ts` (add Google Docs preferences)

**Step 1: Write types file**

Create `src/shared/types/google-docs.ts`:

```typescript
/** Mapping of a local file to a Google Doc */
export interface GoogleDocLink {
  docId: string;
  lastSyncedAt: string | null; // ISO timestamp
}

/** Result of a sync operation */
export interface GoogleDocsSyncResult {
  success: boolean;
  error?: string;
  /** True if external edits were detected */
  externalEditsDetected?: boolean;
}

/** Auth state exposed to renderer */
export interface GoogleAuthState {
  isAuthenticated: boolean;
  userEmail?: string;
}

/** Credentials source config */
export interface GoogleCredentialsConfig {
  useCustomCredentials: boolean;
  customClientId?: string;
}

/** Represents a text segment with formatting for Docs API */
export interface DocsTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
  strikethrough?: boolean;
}

/** A paragraph-level element in Docs API structure */
export interface DocsElement {
  type: 'paragraph' | 'heading' | 'code_block' | 'table' | 'list_item' | 'image' | 'horizontal_rule' | 'blockquote';
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  runs?: DocsTextRun[];
  /** For code blocks: the full code text */
  code?: string;
  /** For code blocks: language hint */
  language?: string;
  /** For tables: rows of cells, each cell is an array of runs */
  rows?: DocsTextRun[][][];
  /** For images: base64 PNG data */
  imageBase64?: string;
  /** For images: alt text */
  imageAlt?: string;
  /** For images: optional link URL (e.g., mermaid live edit) */
  imageLink?: string;
  /** For list items: nesting depth (0-based) */
  listDepth?: number;
  /** For list items: ordered vs unordered */
  listOrdered?: boolean;
  /** For blockquotes: nested elements */
  children?: DocsElement[];
}

/** Full document structure for Docs API */
export interface DocsDocument {
  elements: DocsElement[];
}
```

**Step 2: Add IPC channels**

In `src/shared/types/api.ts`, add to `IPC_CHANNELS`:

```typescript
GOOGLE_DOCS: {
  AUTH_STATUS: 'google-docs:auth-status',
  AUTH_SIGN_IN: 'google-docs:auth-sign-in',
  AUTH_SIGN_OUT: 'google-docs:auth-sign-out',
  LINK: 'google-docs:link',
  UNLINK: 'google-docs:unlink',
  GET_LINK: 'google-docs:get-link',
  SYNC: 'google-docs:sync',
  SYNC_CONFIRM_OVERWRITE: 'google-docs:sync-confirm-overwrite',
  ON_AUTH_CHANGE: 'google-docs:on-auth-change',
  ON_SYNC_STATUS: 'google-docs:on-sync-status',
},
```

**Step 3: Add GoogleDocsAPI to ElectronAPI interface**

In `src/shared/types/api.ts`, add the interface:

```typescript
export interface GoogleDocsAPI {
  getAuthStatus: () => Promise<GoogleAuthState>;
  signIn: () => Promise<GoogleAuthState>;
  signOut: () => Promise<void>;
  link: (filePath: string, docUrl: string) => Promise<GoogleDocLink>;
  unlink: (filePath: string) => Promise<void>;
  getLink: (filePath: string) => Promise<GoogleDocLink | null>;
  sync: (filePath: string, markdownContent: string) => Promise<GoogleDocsSyncResult>;
  syncConfirmOverwrite: (filePath: string, markdownContent: string) => Promise<GoogleDocsSyncResult>;
  onAuthChange: (callback: (state: GoogleAuthState) => void) => () => void;
  onSyncStatus: (callback: (status: { syncing: boolean; error?: string }) => void) => () => void;
}
```

Add `googleDocs: GoogleDocsAPI;` to the `ElectronAPI` interface.

**Step 4: Add Google Docs preferences**

In `src/shared/types/preferences.ts`, add to `CorePreferences`:

```typescript
googleDocs: {
  useCustomCredentials: boolean;
  customClientId: string;
};
```

Add defaults in `src/preferences/defaults.ts`:

```typescript
googleDocs: {
  useCustomCredentials: false,
  customClientId: '',
},
```

**Step 5: Write failing test for types**

Create `tests/unit/shared/types/google-docs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { GoogleDocLink, DocsElement, DocsTextRun } from '@shared/types/google-docs';

describe('Google Docs types', () => {
  it('should create a valid GoogleDocLink', () => {
    const link: GoogleDocLink = {
      docId: '1aBcDeFg',
      lastSyncedAt: '2026-03-09T14:30:00Z',
    };
    expect(link.docId).toBe('1aBcDeFg');
  });

  it('should create a valid DocsElement paragraph with runs', () => {
    const el: DocsElement = {
      type: 'paragraph',
      runs: [
        { text: 'Hello ' },
        { text: 'bold', bold: true },
        { text: ' world' },
      ],
    };
    expect(el.runs).toHaveLength(3);
    expect(el.runs![1].bold).toBe(true);
  });

  it('should create a valid heading element', () => {
    const el: DocsElement = {
      type: 'heading',
      headingLevel: 2,
      runs: [{ text: 'Section Title' }],
    };
    expect(el.headingLevel).toBe(2);
  });
});
```

**Step 6: Run test**

```bash
npx vitest run tests/unit/shared/types/google-docs.test.ts
```

Expected: PASS

**Step 7: Commit**

```bash
git add src/shared/types/google-docs.ts src/shared/types/api.ts src/shared/types/preferences.ts src/preferences/defaults.ts tests/unit/shared/types/google-docs.test.ts
git commit -m "feat(gdocs): add shared types, IPC channels, and preferences for Google Docs sync"
```

---

### Task 3: GoogleDocsLinkStore

**Files:**
- Create: `src/main/services/GoogleDocsLinkStore.ts`
- Test: `tests/unit/main/services/GoogleDocsLinkStore.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGoogleDocsLinkStore, type GoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('GoogleDocsLinkStore', () => {
  let store: GoogleDocsLinkStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-test-'));
    store = createGoogleDocsLinkStore(tempDir);
    await store.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should return null for unlinked file', async () => {
    const link = store.getLink('/some/file.md');
    expect(link).toBeNull();
  });

  it('should store and retrieve a link', async () => {
    await store.setLink('/some/file.md', '1aBcDeFg');
    const link = store.getLink('/some/file.md');
    expect(link).toEqual({ docId: '1aBcDeFg', lastSyncedAt: null });
  });

  it('should remove a link', async () => {
    await store.setLink('/some/file.md', '1aBcDeFg');
    await store.removeLink('/some/file.md');
    expect(store.getLink('/some/file.md')).toBeNull();
  });

  it('should update lastSyncedAt', async () => {
    await store.setLink('/some/file.md', '1aBcDeFg');
    const now = new Date().toISOString();
    await store.updateLastSynced('/some/file.md', now);
    expect(store.getLink('/some/file.md')?.lastSyncedAt).toBe(now);
  });

  it('should save and load baseline', async () => {
    await store.saveBaseline('1aBcDeFg', 'hello world content');
    const baseline = await store.loadBaseline('1aBcDeFg');
    expect(baseline).toBe('hello world content');
  });

  it('should return null for missing baseline', async () => {
    const baseline = await store.loadBaseline('nonexistent');
    expect(baseline).toBeNull();
  });

  it('should delete baseline', async () => {
    await store.saveBaseline('1aBcDeFg', 'content');
    await store.deleteBaseline('1aBcDeFg');
    const baseline = await store.loadBaseline('1aBcDeFg');
    expect(baseline).toBeNull();
  });

  it('should persist links across instances', async () => {
    await store.setLink('/some/file.md', '1aBcDeFg');
    const store2 = createGoogleDocsLinkStore(tempDir);
    await store2.initialize();
    expect(store2.getLink('/some/file.md')).toEqual({ docId: '1aBcDeFg', lastSyncedAt: null });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/main/services/GoogleDocsLinkStore.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement GoogleDocsLinkStore**

Create `src/main/services/GoogleDocsLinkStore.ts`:

```typescript
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import type { GoogleDocLink } from '@shared/types/google-docs';

interface LinksData {
  [filePath: string]: GoogleDocLink;
}

export class GoogleDocsLinkStore {
  private linksPath: string;
  private baselineDir: string;
  private links: LinksData = {};
  private initialized = false;

  constructor(dataDir?: string) {
    const dir = dataDir ?? app.getPath('userData');
    this.linksPath = path.join(dir, 'google-docs-links.json');
    this.baselineDir = path.join(dir, 'google-docs-sync');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.linksPath), { recursive: true });
    await fs.mkdir(this.baselineDir, { recursive: true });
    try {
      const data = await fs.readFile(this.linksPath, 'utf-8');
      this.links = JSON.parse(data);
    } catch {
      this.links = {};
    }
    this.initialized = true;
  }

  getLink(filePath: string): GoogleDocLink | null {
    return this.links[filePath] ?? null;
  }

  async setLink(filePath: string, docId: string): Promise<void> {
    this.links[filePath] = { docId, lastSyncedAt: null };
    await this.save();
  }

  async removeLink(filePath: string): Promise<void> {
    const link = this.links[filePath];
    if (link) {
      await this.deleteBaseline(link.docId);
    }
    delete this.links[filePath];
    await this.save();
  }

  async updateLastSynced(filePath: string, timestamp: string): Promise<void> {
    if (this.links[filePath]) {
      this.links[filePath].lastSyncedAt = timestamp;
      await this.save();
    }
  }

  async saveBaseline(docId: string, content: string): Promise<void> {
    const baselinePath = path.join(this.baselineDir, `${docId}.baseline.txt`);
    await fs.writeFile(baselinePath, content, 'utf-8');
  }

  async loadBaseline(docId: string): Promise<string | null> {
    const baselinePath = path.join(this.baselineDir, `${docId}.baseline.txt`);
    try {
      return await fs.readFile(baselinePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async deleteBaseline(docId: string): Promise<void> {
    const baselinePath = path.join(this.baselineDir, `${docId}.baseline.txt`);
    try {
      await fs.unlink(baselinePath);
    } catch {
      // ignore if not found
    }
  }

  private async save(): Promise<void> {
    await fs.writeFile(this.linksPath, JSON.stringify(this.links, null, 2), 'utf-8');
  }
}

// Singleton
let instance: GoogleDocsLinkStore | null = null;

export function getGoogleDocsLinkStore(): GoogleDocsLinkStore {
  if (!instance) {
    instance = new GoogleDocsLinkStore();
  }
  return instance;
}

export function createGoogleDocsLinkStore(dataDir?: string): GoogleDocsLinkStore {
  return new GoogleDocsLinkStore(dataDir);
}

export function resetGoogleDocsLinkStore(): void {
  instance = null;
}
```

**Step 4: Run tests**

```bash
npx vitest run tests/unit/main/services/GoogleDocsLinkStore.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/main/services/GoogleDocsLinkStore.ts tests/unit/main/services/GoogleDocsLinkStore.test.ts
git commit -m "feat(gdocs): add GoogleDocsLinkStore for file-to-doc mapping and baselines"
```

---

### Task 4: GoogleAuthService

**Files:**
- Create: `src/main/services/GoogleAuthService.ts`
- Test: `tests/unit/main/services/GoogleAuthService.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGoogleAuthService } from '@main/services/GoogleAuthService';

// Mock electron
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-userdata' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace('enc:', ''),
  },
  shell: { openExternal: vi.fn() },
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('GoogleAuthService', () => {
  let service: ReturnType<typeof createGoogleAuthService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createGoogleAuthService();
  });

  it('should report not authenticated initially', () => {
    expect(service.getAuthState().isAuthenticated).toBe(false);
  });

  it('should generate auth URL with PKCE', () => {
    const { url, codeVerifier } = service.generateAuthUrl('test-client-id');
    expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('code_challenge');
    expect(url).not.toContain('client_secret');
    expect(codeVerifier).toBeTruthy();
  });

  it('should extract doc ID from various URL formats', () => {
    expect(service.extractDocId('https://docs.google.com/document/d/1aBcDeFg/edit'))
      .toBe('1aBcDeFg');
    expect(service.extractDocId('https://docs.google.com/document/d/1aBcDeFg/edit?usp=sharing'))
      .toBe('1aBcDeFg');
    expect(service.extractDocId('https://docs.google.com/document/d/1aBcDeFg'))
      .toBe('1aBcDeFg');
    expect(service.extractDocId('not-a-url')).toBeNull();
  });

  it('should use custom client ID when configured', () => {
    service.setCustomClientId('custom-id-123');
    const { url } = service.generateAuthUrl();
    expect(url).toContain('client_id=custom-id-123');
  });
});
```

**Step 2: Run test to verify failure**

```bash
npx vitest run tests/unit/main/services/GoogleAuthService.test.ts
```

**Step 3: Implement GoogleAuthService**

Create `src/main/services/GoogleAuthService.ts`. Key responsibilities:

- `generateAuthUrl(clientId?)` — Build OAuth2 URL with PKCE (code_challenge + state)
- `handleAuthCallback(code, codeVerifier)` — Exchange code for tokens
- `getAccessToken()` — Return valid token, auto-refresh if expired
- `signOut()` — Clear stored tokens
- `getAuthState()` — Return `GoogleAuthState`
- `extractDocId(url)` — Parse Google Doc URL to extract document ID
- `setCustomClientId(id)` — Override built-in client ID

Token storage: encrypt with `safeStorage`, save to `userData/google-docs-tokens.enc`.

OAuth callback: start a temporary local HTTP server on a random port, use `http://localhost:<port>/callback` as redirect URI.

The built-in client ID will be a constant (set up in Google Cloud Console later — use placeholder during development).

**Step 4: Run tests**

```bash
npx vitest run tests/unit/main/services/GoogleAuthService.test.ts
```

**Step 5: Commit**

```bash
git add src/main/services/GoogleAuthService.ts tests/unit/main/services/GoogleAuthService.test.ts
git commit -m "feat(gdocs): add GoogleAuthService with OAuth2 PKCE flow"
```

---

### Task 5: MarkdownToDocsConverter

**Files:**
- Create: `src/main/services/MarkdownToDocsConverter.ts`
- Test: `tests/unit/main/services/MarkdownToDocsConverter.test.ts`

This is the core converter: markdown string → `DocsDocument` (array of `DocsElement`).

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

describe('MarkdownToDocsConverter', () => {
  it('should convert a plain paragraph', () => {
    const doc = convertMarkdownToDocs('Hello world');
    expect(doc.elements).toHaveLength(1);
    expect(doc.elements[0].type).toBe('paragraph');
    expect(doc.elements[0].runs).toEqual([{ text: 'Hello world' }]);
  });

  it('should convert headings', () => {
    const doc = convertMarkdownToDocs('# Title\n\n## Subtitle');
    expect(doc.elements).toHaveLength(2);
    expect(doc.elements[0].type).toBe('heading');
    expect(doc.elements[0].headingLevel).toBe(1);
    expect(doc.elements[1].headingLevel).toBe(2);
  });

  it('should convert inline formatting', () => {
    const doc = convertMarkdownToDocs('Hello **bold** and *italic* text');
    const runs = doc.elements[0].runs!;
    expect(runs).toContainEqual({ text: 'bold', bold: true });
    expect(runs).toContainEqual({ text: 'italic', italic: true });
  });

  it('should convert links', () => {
    const doc = convertMarkdownToDocs('[Click here](https://example.com)');
    const runs = doc.elements[0].runs!;
    expect(runs).toContainEqual({ text: 'Click here', link: 'https://example.com' });
  });

  it('should convert code blocks', () => {
    const doc = convertMarkdownToDocs('```js\nconst x = 1;\n```');
    expect(doc.elements[0].type).toBe('code_block');
    expect(doc.elements[0].code).toBe('const x = 1;\n');
    expect(doc.elements[0].language).toBe('js');
  });

  it('should convert unordered lists', () => {
    const doc = convertMarkdownToDocs('- Item 1\n- Item 2');
    expect(doc.elements.filter(e => e.type === 'list_item')).toHaveLength(2);
    expect(doc.elements[0].listOrdered).toBe(false);
  });

  it('should convert ordered lists', () => {
    const doc = convertMarkdownToDocs('1. First\n2. Second');
    expect(doc.elements.filter(e => e.type === 'list_item')).toHaveLength(2);
    expect(doc.elements[0].listOrdered).toBe(true);
  });

  it('should convert tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const doc = convertMarkdownToDocs(md);
    const table = doc.elements.find(e => e.type === 'table');
    expect(table).toBeDefined();
    expect(table!.rows).toHaveLength(2); // header + 1 row
  });

  it('should convert horizontal rules', () => {
    const doc = convertMarkdownToDocs('---');
    expect(doc.elements[0].type).toBe('horizontal_rule');
  });

  it('should convert blockquotes', () => {
    const doc = convertMarkdownToDocs('> Quoted text');
    expect(doc.elements[0].type).toBe('blockquote');
  });

  it('should handle inline code', () => {
    const doc = convertMarkdownToDocs('Use `console.log()` here');
    const runs = doc.elements[0].runs!;
    expect(runs).toContainEqual({ text: 'console.log()', code: true });
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/main/services/MarkdownToDocsConverter.test.ts
```

**Step 3: Implement**

Uses `markdown-it` to parse tokens, then walks the token stream to build `DocsElement[]`. Key approach:

- Instantiate markdown-it with GFM tables enabled
- Call `md.parse(markdown, {})` to get token stream
- Walk tokens: track open/close nesting, accumulate inline children into `DocsTextRun[]`
- Handle `heading_open`, `paragraph_open`, `fence`, `bullet_list_open`, `ordered_list_open`, `table_open`, `blockquote_open`, `hr`

Mermaid diagrams are detected as `fence` tokens with `info === 'mermaid'` — these become `DocsElement` with `type: 'image'` (the actual PNG rendering happens later in the sync service, since it needs the renderer process).

**Step 4: Run tests, iterate**

```bash
npx vitest run tests/unit/main/services/MarkdownToDocsConverter.test.ts
```

**Step 5: Commit**

```bash
git add src/main/services/MarkdownToDocsConverter.ts tests/unit/main/services/MarkdownToDocsConverter.test.ts
git commit -m "feat(gdocs): add MarkdownToDocsConverter for markdown-it tokens to Docs API structure"
```

---

### Task 6: GoogleDocsService (API wrapper)

**Files:**
- Create: `src/main/services/GoogleDocsService.ts`
- Test: `tests/unit/main/services/GoogleDocsService.test.ts`

Thin wrapper around Google Docs API + Drive API using `fetch`.

**Step 1: Write failing tests**

Test with mocked fetch — verify correct URL construction, headers, and request body structure.

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGoogleDocsService } from '@main/services/GoogleDocsService';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GoogleDocsService', () => {
  let service: ReturnType<typeof createGoogleDocsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createGoogleDocsService(() => Promise.resolve('fake-token'));
  });

  it('should read document content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Hello' } }] } }] },
      }),
    });

    const doc = await service.getDocument('doc-123');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://docs.googleapis.com/v1/documents/doc-123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fake-token',
        }),
      }),
    );
    expect(doc.body.content).toBeDefined();
  });

  it('should send batch update', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ replies: [] }),
    });

    const requests = [{ insertText: { text: 'Hello', location: { index: 1 } } }];
    await service.batchUpdate('doc-123', requests);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://docs.googleapis.com/v1/documents/doc-123:batchUpdate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ requests }),
      }),
    );
  });

  it('should upload image to Drive', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'file-123' }),
    });

    const imageId = await service.uploadImage(Buffer.from('png-data'), 'diagram.png');
    expect(imageId).toBe('file-123');
  });

  it('should throw on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: () => Promise.resolve({ error: { message: 'No access' } }),
    });

    await expect(service.getDocument('doc-123')).rejects.toThrow('No access');
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/main/services/GoogleDocsService.test.ts
```

**Step 3: Implement**

Methods:
- `getDocument(docId)` — GET documents endpoint, returns full doc structure
- `batchUpdate(docId, requests)` — POST batchUpdate endpoint
- `uploadImage(data, filename)` — POST to Drive API, returns file ID for inline image insertion
- All methods call `getAccessToken()` callback before each request for fresh token

**Step 4: Run tests**

```bash
npx vitest run tests/unit/main/services/GoogleDocsService.test.ts
```

**Step 5: Commit**

```bash
git add src/main/services/GoogleDocsService.ts tests/unit/main/services/GoogleDocsService.test.ts
git commit -m "feat(gdocs): add GoogleDocsService API wrapper for Docs and Drive"
```

---

### Task 7: DocsDocumentBuilder (DocsElement → batchUpdate requests)

**Files:**
- Create: `src/main/services/DocsDocumentBuilder.ts`
- Test: `tests/unit/main/services/DocsDocumentBuilder.test.ts`

Converts `DocsDocument` → array of Google Docs API `batchUpdate` request objects.

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { buildInsertRequests } from '@main/services/DocsDocumentBuilder';
import type { DocsDocument } from '@shared/types/google-docs';

describe('DocsDocumentBuilder', () => {
  it('should build insert requests for a paragraph', () => {
    const doc: DocsDocument = {
      elements: [{ type: 'paragraph', runs: [{ text: 'Hello world' }] }],
    };
    const requests = buildInsertRequests(doc, 1); // startIndex=1
    // Should have InsertText + UpdateParagraphStyle
    const insertText = requests.find((r: any) => r.insertText);
    expect(insertText).toBeDefined();
    expect(insertText.insertText.text).toContain('Hello world');
  });

  it('should build requests for bold text', () => {
    const doc: DocsDocument = {
      elements: [{ type: 'paragraph', runs: [
        { text: 'normal ' },
        { text: 'bold', bold: true },
      ]}],
    };
    const requests = buildInsertRequests(doc, 1);
    const boldStyle = requests.find((r: any) =>
      r.updateTextStyle?.textStyle?.bold === true
    );
    expect(boldStyle).toBeDefined();
  });

  it('should build requests for headings', () => {
    const doc: DocsDocument = {
      elements: [{ type: 'heading', headingLevel: 1, runs: [{ text: 'Title' }] }],
    };
    const requests = buildInsertRequests(doc, 1);
    const paragraphStyle = requests.find((r: any) =>
      r.updateParagraphStyle?.paragraphStyle?.namedStyleType === 'HEADING_1'
    );
    expect(paragraphStyle).toBeDefined();
  });

  it('should build requests for a table', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'table',
        rows: [
          [[{ text: 'Header' }]],
          [[{ text: 'Cell' }]],
        ],
      }],
    };
    const requests = buildInsertRequests(doc, 1);
    const insertTable = requests.find((r: any) => r.insertTable);
    expect(insertTable).toBeDefined();
    expect(insertTable.insertTable.rows).toBe(2);
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/main/services/DocsDocumentBuilder.test.ts
```

**Step 3: Implement**

Key logic:
- Track a running `index` position as content is inserted
- Each element type produces the right combination of API requests
- Paragraphs: `insertText` (with \n) + `updateTextStyle` per run + `updateParagraphStyle`
- Headings: Same as paragraph but with `namedStyleType: 'HEADING_N'`
- Code blocks: `insertText` with monospace styling
- Tables: `insertTable` + populate cells
- Lists: `insertText` + `createParagraphBullets`
- Images: `insertInlineImage` with Drive URI
- Horizontal rules: `insertText('___\n')` with styling

**Step 4: Run tests**

```bash
npx vitest run tests/unit/main/services/DocsDocumentBuilder.test.ts
```

**Step 5: Commit**

```bash
git add src/main/services/DocsDocumentBuilder.ts tests/unit/main/services/DocsDocumentBuilder.test.ts
git commit -m "feat(gdocs): add DocsDocumentBuilder for converting DocsElements to API requests"
```

---

### Task 8: GoogleDocsSyncService (orchestrator)

**Files:**
- Create: `src/main/services/GoogleDocsSyncService.ts`
- Test: `tests/unit/main/services/GoogleDocsSyncService.test.ts`

Orchestrates the full sync flow: convert, three-way diff, generate minimal updates.

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';

describe('GoogleDocsSyncService', () => {
  const mockDocsService = {
    getDocument: vi.fn(),
    batchUpdate: vi.fn(),
    uploadImage: vi.fn(),
  };
  const mockLinkStore = {
    loadBaseline: vi.fn(),
    saveBaseline: vi.fn(),
    updateLastSynced: vi.fn(),
  };

  let syncService: ReturnType<typeof createGoogleDocsSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = createGoogleDocsSyncService(
      mockDocsService as any,
      mockLinkStore as any,
    );
  });

  it('should do full populate on first sync (no baseline)', async () => {
    mockLinkStore.loadBaseline.mockResolvedValue(null);
    mockDocsService.getDocument.mockResolvedValue({
      body: { content: [{ endIndex: 1 }] },
    });
    mockDocsService.batchUpdate.mockResolvedValue({});

    const result = await syncService.sync('/file.md', 'doc-123', '# Hello\n\nWorld');
    expect(result.success).toBe(true);
    expect(mockDocsService.batchUpdate).toHaveBeenCalled();
    expect(mockLinkStore.saveBaseline).toHaveBeenCalled();
  });

  it('should detect external edits (baseline != current doc)', async () => {
    mockLinkStore.loadBaseline.mockResolvedValue('original text');
    mockDocsService.getDocument.mockResolvedValue({
      body: {
        content: [{
          paragraph: { elements: [{ textRun: { content: 'someone edited this' } }] },
          startIndex: 1,
          endIndex: 20,
        }],
      },
    });

    const result = await syncService.sync('/file.md', 'doc-123', '# New content');
    expect(result.externalEditsDetected).toBe(true);
    // Should NOT have called batchUpdate (needs user confirmation)
    expect(mockDocsService.batchUpdate).not.toHaveBeenCalled();
  });

  it('should apply minimal diff when no external edits', async () => {
    const baselineText = 'Hello world\n';
    mockLinkStore.loadBaseline.mockResolvedValue(baselineText);
    mockDocsService.getDocument.mockResolvedValue({
      body: {
        content: [{
          paragraph: {
            elements: [{ textRun: { content: 'Hello world\n' } }],
          },
          startIndex: 1,
          endIndex: 13,
        }],
      },
    });
    mockDocsService.batchUpdate.mockResolvedValue({});

    const result = await syncService.sync('/file.md', 'doc-123', 'Hello universe');
    expect(result.success).toBe(true);
    expect(mockDocsService.batchUpdate).toHaveBeenCalled();
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/main/services/GoogleDocsSyncService.test.ts
```

**Step 3: Implement**

Core algorithm:

```typescript
async sync(filePath: string, docId: string, markdown: string): Promise<GoogleDocsSyncResult> {
  // 1. Load baseline
  const baseline = await this.linkStore.loadBaseline(docId);

  // 2. Read current doc
  const currentDoc = await this.docsService.getDocument(docId);
  const currentText = this.extractPlainText(currentDoc);

  // 3. Convert new markdown to DocsDocument + extract plain text
  const newDocsDoc = convertMarkdownToDocs(markdown);
  const newText = this.extractPlainTextFromDocsDoc(newDocsDoc);

  // 4. Three-way check
  if (baseline !== null && baseline !== currentText) {
    return { success: false, externalEditsDetected: true };
  }

  // 5. First sync (no baseline) → full populate
  if (baseline === null) {
    return this.fullPopulate(docId, filePath, newDocsDoc, newText);
  }

  // 6. Diff and apply minimal changes
  return this.applyDiff(docId, filePath, currentDoc, currentText, newDocsDoc, newText);
}
```

The `applyDiff` method uses the `diff` library for character-level diffing, generates `DeleteContentRange` + `InsertText` operations in reverse index order, and applies formatting via `UpdateTextStyle` / `UpdateParagraphStyle`.

**Step 4: Run tests**

```bash
npx vitest run tests/unit/main/services/GoogleDocsSyncService.test.ts
```

**Step 5: Commit**

```bash
git add src/main/services/GoogleDocsSyncService.ts tests/unit/main/services/GoogleDocsSyncService.test.ts
git commit -m "feat(gdocs): add GoogleDocsSyncService with three-way diff orchestration"
```

---

### Task 9: IPC Handlers + Preload

**Files:**
- Create: `src/main/ipc/handlers/GoogleDocsHandler.ts`
- Modify: `src/main/ipc/handlers/index.ts` (register new handlers)
- Modify: `src/preload/preload.ts` (expose googleDocs API)

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { ipcMain } from 'electron';
import { registerGoogleDocsHandlers, unregisterGoogleDocsHandlers } from '@main/ipc/handlers/GoogleDocsHandler';

describe('GoogleDocsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register all Google Docs IPC handlers', () => {
    registerGoogleDocsHandlers();
    const handleCalls = vi.mocked(ipcMain.handle).mock.calls.map(c => c[0]);
    expect(handleCalls).toContain('google-docs:auth-status');
    expect(handleCalls).toContain('google-docs:auth-sign-in');
    expect(handleCalls).toContain('google-docs:link');
    expect(handleCalls).toContain('google-docs:sync');
  });

  it('should unregister all handlers', () => {
    unregisterGoogleDocsHandlers();
    const removeCalls = vi.mocked(ipcMain.removeHandler).mock.calls.map(c => c[0]);
    expect(removeCalls).toContain('google-docs:auth-status');
    expect(removeCalls).toContain('google-docs:sync');
  });
});
```

**Step 2: Implement handler**

Follow existing pattern from `PreferencesHandler.ts`:

```typescript
export function registerGoogleDocsHandlers(): void {
  const authService = getGoogleAuthService();
  const linkStore = getGoogleDocsLinkStore();
  const docsService = createGoogleDocsService(() => authService.getAccessToken());
  const syncService = createGoogleDocsSyncService(docsService, linkStore);

  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.AUTH_STATUS, () => authService.getAuthState());
  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.AUTH_SIGN_IN, () => authService.signIn());
  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.AUTH_SIGN_OUT, () => authService.signOut());

  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.LINK, async (_event, filePath: string, docUrl: string) => {
    const docId = authService.extractDocId(docUrl);
    if (!docId) throw new Error('Invalid Google Docs URL');
    await linkStore.setLink(filePath, docId);
    return linkStore.getLink(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.UNLINK, async (_event, filePath: string) => {
    await linkStore.removeLink(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.GET_LINK, (_event, filePath: string) => {
    return linkStore.getLink(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.SYNC, async (_event, filePath: string, markdownContent: string) => {
    const link = linkStore.getLink(filePath);
    if (!link) throw new Error('File not linked to Google Docs');
    return syncService.sync(filePath, link.docId, markdownContent);
  });

  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.SYNC_CONFIRM_OVERWRITE, async (_event, filePath: string, markdownContent: string) => {
    const link = linkStore.getLink(filePath);
    if (!link) throw new Error('File not linked to Google Docs');
    return syncService.syncForceOverwrite(filePath, link.docId, markdownContent);
  });
}
```

**Step 3: Update preload**

Add `googleDocs` namespace to `electronAPI` in `src/preload/preload.ts`, following existing patterns (invoke for requests, on+removeListener for events).

**Step 4: Register in handler index**

Add `registerGoogleDocsHandlers` / `unregisterGoogleDocsHandlers` to `src/main/ipc/handlers/index.ts`.

**Step 5: Run tests**

```bash
npx vitest run tests/unit/main/ipc/handlers/GoogleDocsHandler.test.ts
```

**Step 6: Commit**

```bash
git add src/main/ipc/handlers/GoogleDocsHandler.ts src/main/ipc/handlers/index.ts src/preload/preload.ts
git commit -m "feat(gdocs): add IPC handlers and preload bridge for Google Docs sync"
```

---

### Task 10: UI — Link Dialog Component

**Files:**
- Create: `src/renderer/components/GoogleDocsLinkDialog.ts`
- Modify: `index.html` (add dialog markup)

**Step 1: Add dialog HTML to index.html**

```html
<!-- Google Docs Link Dialog -->
<div id="gdocs-link-dialog" class="modal hidden">
  <div class="modal-backdrop"></div>
  <div class="modal-content">
    <h3>Link to Google Docs</h3>
    <p>Paste the URL of an empty Google Doc:</p>
    <input type="text" id="gdocs-url-input" placeholder="https://docs.google.com/document/d/..." />
    <div class="modal-actions">
      <button id="gdocs-link-cancel" class="btn-secondary">Cancel</button>
      <button id="gdocs-link-confirm" class="btn-primary">Link</button>
    </div>
    <div id="gdocs-link-error" class="error-text hidden"></div>
  </div>
</div>
```

**Step 2: Create component**

Follow CopyDropdown pattern — class with DOM caching, event listeners, factory function:

```typescript
export class GoogleDocsLinkDialog {
  private dialog: HTMLElement;
  private urlInput: HTMLInputElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private errorText: HTMLElement | null = null;
  private onLink: ((url: string) => void) | null = null;

  constructor(dialog: HTMLElement) { /* cache elements, setup listeners */ }

  show(onLink: (url: string) => void): void { /* show modal, focus input */ }
  hide(): void { /* hide modal, clear input */ }
  showError(message: string): void { /* show validation error */ }
  destroy(): void { /* cleanup */ }
}

export function createGoogleDocsLinkDialog(dialog: HTMLElement): GoogleDocsLinkDialog {
  return new GoogleDocsLinkDialog(dialog);
}
```

**Step 3: Add CSS**

Add modal styles to `src/index.css` — backdrop, centered content, input styling. Follow existing app styling patterns.

**Step 4: Commit**

```bash
git add src/renderer/components/GoogleDocsLinkDialog.ts index.html src/index.css
git commit -m "feat(gdocs): add Google Docs link dialog UI component"
```

---

### Task 11: UI — Toolbar Sync Button & Status

**Files:**
- Modify: `index.html` (add Google Docs button to toolbar)
- Create: `src/renderer/components/GoogleDocsButton.ts`
- Modify: `src/index.css` (button styles)

**Step 1: Add toolbar button HTML**

Next to existing copy dropdown, add:

```html
<div class="toolbar-item" id="gdocs-toolbar">
  <button id="gdocs-btn" class="toolbar-btn" disabled title="Google Docs">
    <svg><!-- Google Docs icon --></svg>
    <span id="gdocs-btn-label">Link to Docs</span>
    <span id="gdocs-spinner" class="spinner hidden"></span>
  </button>
</div>
```

**Step 2: Create GoogleDocsButton component**

States: not-linked, needs-auth, ready, syncing. Each state changes label, icon, click behavior.

```typescript
export class GoogleDocsButton {
  // States: 'unlinked' | 'needs-auth' | 'ready' | 'syncing'
  private state: string = 'unlinked';
  private callbacks: GoogleDocsButtonCallbacks = {};

  setState(state: 'unlinked' | 'needs-auth' | 'ready' | 'syncing'): void { /* update UI */ }
  setLastSynced(timestamp: string | null): void { /* update tooltip */ }
  setEnabled(enabled: boolean): void { /* toggle disabled */ }
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/GoogleDocsButton.ts index.html src/index.css
git commit -m "feat(gdocs): add Google Docs toolbar button with state management"
```

---

### Task 12: UI — Settings Panel Addition

**Files:**
- Modify: Preferences/settings UI files (wherever the existing preferences panel is)

**Step 1: Add Google Docs section to settings**

- "Use custom Google API credentials" toggle
- Client ID input (shown when toggle on)
- "Sign out of Google" button
- Current auth status display

Follow existing preferences UI patterns.

**Step 2: Wire to preferences service**

Read/write `googleDocs.useCustomCredentials` and `googleDocs.customClientId` via existing preferences IPC.

**Step 3: Commit**

```bash
git commit -m "feat(gdocs): add Google Docs settings section in preferences"
```

---

### Task 13: Integration — Wire Everything in App

**Files:**
- Modify: `src/renderer.ts` (integrate new components)
- Modify: `src/main/index.ts` (initialize services)

**Step 1: Initialize services in main process**

In `src/main/index.ts`, add initialization of `GoogleDocsLinkStore` and `GoogleAuthService` alongside existing service initialization.

**Step 2: Wire UI in renderer**

In `src/renderer.ts`:
- Create `GoogleDocsLinkDialog` and `GoogleDocsButton` in `initializeComponents()`
- Add handlers:
  - Button click (unlinked) → show link dialog
  - Button click (needs-auth) → call `electronAPI.googleDocs.signIn()`
  - Button click (ready) → call `electronAPI.googleDocs.sync(filePath, content)`
  - Sync result with `externalEditsDetected` → show confirmation dialog
  - Auth change events → update button state
- On file load: check if file has a link, update button state
- On file unload: reset button to disabled

**Step 3: Commit**

```bash
git commit -m "feat(gdocs): wire Google Docs sync into main app flow"
```

---

### Task 14: Status Bar & Confirmation Dialog

**Files:**
- Modify: `src/renderer/components/StatusBar.ts` (add sync status)
- Create: `src/renderer/components/GoogleDocsConfirmDialog.ts`

**Step 1: Add sync status to status bar**

Show "Linked to Google Docs · Last synced 2 min ago" when a linked file is open.

**Step 2: Add overwrite confirmation dialog**

When sync detects external edits, show: "Google Doc has been edited since last sync. Overwrite with your changes?" → Overwrite / Cancel.

**Step 3: Commit**

```bash
git commit -m "feat(gdocs): add status bar sync indicator and overwrite confirmation dialog"
```

---

### Task 15: Mermaid Diagram Sync Support

**Files:**
- Modify: `src/main/services/GoogleDocsSyncService.ts`
- Modify: `src/main/services/MarkdownToDocsConverter.ts`

**Step 1: Handle mermaid fence tokens in converter**

When converter encounters a `fence` token with `info === 'mermaid'`, emit a `DocsElement` with `type: 'image'` and store the mermaid source code. The actual PNG needs to be rendered in the renderer process (since mermaid uses DOM).

**Step 2: Add IPC for mermaid rendering**

Add an IPC channel where the main process can request the renderer to render a mermaid diagram to PNG. Reuse `MermaidPlugin.renderToPng()`.

**Step 3: In sync service, process mermaid elements**

Before building batch update requests, iterate `DocsElement`s with mermaid source → request PNG from renderer → upload to Drive → set image URI.

**Step 4: Test with a markdown file containing mermaid**

**Step 5: Commit**

```bash
git commit -m "feat(gdocs): add mermaid diagram support for Google Docs sync"
```

---

### Task 16: End-to-End Integration Test

**Files:**
- Create: `tests/e2e/google-docs-sync.spec.ts`

**Step 1: Write E2E test**

Test the full flow with a mock Google API (intercept HTTP requests):
- Link a file to a doc URL
- Trigger sync
- Verify API calls made with correct structure

**Step 2: Run**

```bash
npx playwright test tests/e2e/google-docs-sync.spec.ts
```

**Step 3: Commit**

```bash
git commit -m "test(gdocs): add end-to-end test for Google Docs sync flow"
```

---

## Dependency Graph

```
Task 1 (deps + entitlements)
  └→ Task 2 (types + channels)
       ├→ Task 3 (link store)
       ├→ Task 4 (auth service)
       ├→ Task 5 (markdown converter)
       │    └→ Task 7 (document builder)
       └→ Task 6 (API wrapper)
            └→ Task 8 (sync service) ← depends on 3, 5, 6, 7
                 └→ Task 9 (IPC handlers + preload) ← depends on 3, 4, 6, 8
                      ├→ Task 10 (link dialog UI)
                      ├→ Task 11 (toolbar button UI)
                      ├→ Task 12 (settings UI)
                      └→ Task 13 (wire everything) ← depends on 9-12
                           ├→ Task 14 (status bar + confirm dialog)
                           ├→ Task 15 (mermaid support)
                           └→ Task 16 (E2E test)
```

**Parallelizable groups:**
- Tasks 3, 4, 5, 6 can be done in parallel (independent services)
- Tasks 10, 11, 12 can be done in parallel (independent UI components)
- Tasks 14, 15, 16 can be done in parallel (independent enhancements)
