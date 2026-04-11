// ── Google Docs API response types ─────────────────────────────────
// These mirror the subset of the Google Docs REST API v1 response
// structure that we actually use.  They are intentionally loose
// (most fields optional) to match the API's shape without requiring
// a full generated client.

export interface GDocsLink {
  url?: string;
}

export interface GDocsTextStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  link?: GDocsLink;
  fontSize?: { magnitude: number; unit: string };
  weightedFontFamily?: { fontFamily: string };
}

export interface GDocsTextRun {
  content?: string;
  textStyle?: GDocsTextStyle;
  startIndex?: number;
  endIndex?: number;
}

export interface GDocsInlineObjectElement {
  inlineObjectId?: string;
  startIndex?: number;
  endIndex?: number;
}

export interface GDocsParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: GDocsTextRun;
  inlineObjectElement?: GDocsInlineObjectElement;
}

export interface GDocsParagraph {
  elements?: GDocsParagraphElement[];
  paragraphStyle?: Record<string, unknown>;
}

export interface GDocsTableCell {
  content?: GDocsStructuralElement[];
}

export interface GDocsTableRow {
  tableCells?: GDocsTableCell[];
}

export interface GDocsTable {
  rows?: number;
  columns?: number;
  tableRows?: GDocsTableRow[];
}

export interface GDocsStructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: GDocsParagraph;
  table?: GDocsTable;
  sectionBreak?: Record<string, unknown>;
}

export interface GDocsBody {
  content?: GDocsStructuralElement[];
}

/** A Google Docs API document response (subset of fields we use). */
export interface GDocsApiDocument {
  documentId?: string;
  title?: string;
  body?: GDocsBody;
  inlineObjects?: Record<string, unknown>;
}

// ── Application types ──────────────────────────────────────────────

/** Mapping of a local file to a Google Doc */
export interface GoogleDocLink {
  docId: string;
  lastSyncedAt: string | null;
}

/** Result of a sync operation */
export interface GoogleDocsSyncResult {
  success: boolean;
  error?: string;
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

/** Mermaid diagram data extracted from the renderer for sync */
export interface MermaidDiagramData {
  code: string;
  pngBase64: string;
  liveUrl: string;
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
  code?: string;
  language?: string;
  rows?: DocsTextRun[][][];
  imageBase64?: string;
  imageAlt?: string;
  imageLink?: string;
  /** For mermaid diagrams: link to mermaid.live editor */
  mermaidLiveUrl?: string;
  listDepth?: number;
  listOrdered?: boolean;
  children?: DocsElement[];
}

/** Full document structure for Docs API */
export interface DocsDocument {
  elements: DocsElement[];
}
