// ── Google Docs API response types ─────────────────────────────────
// These mirror the subset of the Google Docs REST API v1 response
// structure that we actually use.  They are intentionally loose
// (most fields optional) to match the API's shape without requiring
// a full generated client.

interface GDocsLink {
  url?: string;
}

interface GDocsTextStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  link?: GDocsLink;
  fontSize?: { magnitude: number; unit: string };
  weightedFontFamily?: { fontFamily: string };
}

interface GDocsTextRun {
  content?: string;
  textStyle?: GDocsTextStyle;
  startIndex?: number;
  endIndex?: number;
}

interface GDocsInlineObjectElement {
  inlineObjectId?: string;
  startIndex?: number;
  endIndex?: number;
}

interface GDocsParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: GDocsTextRun;
  inlineObjectElement?: GDocsInlineObjectElement;
}

/** Present on a paragraph that Docs is rendering as a list item. */
interface GDocsBullet {
  listId?: string;
  nestingLevel?: number;
}

interface GDocsParagraph {
  elements?: GDocsParagraphElement[];
  paragraphStyle?: Record<string, unknown>;
  bullet?: GDocsBullet;
}

export interface GDocsTableCell {
  content?: GDocsStructuralElement[];
}

interface GDocsTableRow {
  tableCells?: GDocsTableCell[];
}

interface GDocsTable {
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
  /** Never written by this app, but a user's document may already have one,
   *  and it shares a table's deletion restrictions. */
  tableOfContents?: Record<string, unknown>;
}

interface GDocsBody {
  content?: GDocsStructuralElement[];
}

/** A length in the units the Docs API reports. */
interface GDocsDimension {
  magnitude?: number;
  unit?: string;
}

/** Page geometry, read so table widths can be sized to the real text column. */
interface GDocsDocumentStyle {
  pageSize?: { width?: GDocsDimension; height?: GDocsDimension };
  marginLeft?: GDocsDimension;
  marginRight?: GDocsDimension;
}

/** An image (or other embed) referenced by an inlineObjectElement. */
export interface GDocsInlineObject {
  inlineObjectProperties?: {
    embeddedObject?: {
      title?: string;
      description?: string;
      imageProperties?: {
        /** The URL we handed to insertInlineImage. Stable across reads,
         *  unlike contentUri, which Google regenerates every fetch. */
        sourceUri?: string;
        contentUri?: string;
      };
    };
  };
}

/** A list definition, which is where ordered-vs-bulleted actually lives. */
export interface GDocsList {
  listProperties?: {
    nestingLevels?: Array<{ glyphType?: string; glyphSymbol?: string }>;
  };
}

/** A Google Docs API document response (subset of fields we use). */
export interface GDocsApiDocument {
  documentId?: string;
  title?: string;
  body?: GDocsBody;
  inlineObjects?: Record<string, GDocsInlineObject>;
  /** Bullet presets, keyed by the listId a paragraph's bullet points at. */
  lists?: Record<string, GDocsList>;
  documentStyle?: GDocsDocumentStyle;
}

// ── Application types ──────────────────────────────────────────────

/** Mapping of a local file to a Google Doc */
export interface GoogleDocLink {
  docId: string;
  lastSyncedAt: string | null;
}

/** Why a sync stopped to ask the user. */
export type SyncConflictKind = 'both' | 'remote-only';

/**
 * Which way the user asked to sync.
 *
 * The direction names the intent and sets every change's default: a pull
 * makes the file say what the Doc says, a push the reverse. It is not a
 * read-only lock on the other side -- keeping one of your own blocks during
 * a pull sends that block to the Doc, because an apply that left the two
 * sides holding different content would make the next sync blind to the
 * difference. The snapshots record what both sides agree on, so a divergence
 * baked into them can never be found again.
 */
export type SyncDirection = 'push' | 'pull';

/**
 * The two halves of carrying out a sync.
 *
 * 'preview' computes every difference and hands it back without touching
 * either side; 'apply' takes the markdown the user settled on and makes both
 * the file and the Doc hold it.
 */
export type SyncResolveMode = 'preview' | 'apply';

/** What the user picked for a single difference. */
export type SyncConflictChoice = 'local' | 'remote' | 'both';

/**
 * What kind of difference a change represents.
 *
 * 'local-only' and 'remote-only' have an obvious default, but they are still
 * reported: the user asked to see every difference before it is applied, and
 * a silently-applied hunk is one they cannot decline.
 */
export type SyncChangeKind = 'conflict' | 'local-only' | 'remote-only';

/** One difference between the file and the Doc, for the user to settle. */
export interface SyncChange {
  /** Position in the merged block list, used to apply the choice. */
  index: number;
  kind: SyncChangeKind;
  /** The block as it stands in the local markdown file. Empty if absent. */
  local: string;
  /** The block as it stands in the Google Doc. Empty if absent. */
  remote: string;
  /** What happens if the user changes nothing. */
  choice: SyncConflictChoice;
}

/** Result of a sync operation */
export interface GoogleDocsSyncResult {
  success: boolean;
  error?: string;
  /**
   * Set when the sync stopped to ask the user how to reconcile.
   * 'both' -- the file and the Doc each changed since the last sync.
   * 'remote-only' -- only the Doc changed, so there is nothing to resolve.
   */
  conflict?: SyncConflictKind;
  /** HTTP status when the failure came from a Google API call. */
  status?: number;
  /** Nothing had changed on either side; no API work was done. */
  unchanged?: boolean;
}

/** Result of resolving a two-sided change. */
export interface GoogleDocsResolveResult extends GoogleDocsSyncResult {
  /** New content for the local markdown file, when the choice changed it. */
  markdown?: string;
  /** Every difference between the file and the Doc, for the review screen. */
  changes?: SyncChange[];
  /**
   * The merged document with each change at its default, one block per slot.
   * The review screen substitutes into this to preview a different choice.
   */
  blocks?: string[];
  /**
   * The chosen direction has nothing to carry: a pull where the Doc has not
   * moved, or a push where the file has not. Reported rather than applied
   * silently, so the user gets an answer either way.
   */
  nothingToDo?: boolean;
  /**
   * Something of the user's is at stake -- their own edits during a pull, the
   * Doc's during a push -- so the defaults must not be applied unseen.
   */
  needsReview?: boolean;
}

/** Which stage of a sync is running. */
export type SyncPhase =
  | 'reading'
  | 'converting'
  | 'diagrams'
  | 'applying'
  | 'tables'
  | 'formatting'
  | 'done';

/** A point in a sync's progress, as reported to the UI. */
export interface SyncProgressUpdate {
  /** 0-100, monotonically rising across a single sync. */
  percent: number;
  /** What is happening right now, e.g. "Uploading diagram 3 of 5". */
  label: string;
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
/**
 * Relative column widths of one rendered table, measured in the app's view.
 *
 * Fractions of the table's total width rather than pixels: the document's text
 * column is a different size from the app window, so only the proportions
 * transfer.
 */
export interface TableColumnWidths {
  fractions: number[];
}

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
  /** Relative column widths measured in the app's view, if available. */
  columnWidths?: number[];
  /**
   * Drop the blank paragraph Docs inserts before a table. Set when a heading
   * precedes it, where the heading's own spacing already separates the two.
   */
  suppressLeadingBlank?: boolean;
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
