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
  listDepth?: number;
  listOrdered?: boolean;
  children?: DocsElement[];
}

/** Full document structure for Docs API */
export interface DocsDocument {
  elements: DocsElement[];
}
