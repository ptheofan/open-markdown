/**
 * Result of opening a file dialog
 */
export interface FileOpenResult {
  success: boolean;
  filePath?: string;
  content?: string;
  error?: string;
  cancelled?: boolean;
}

/**
 * Result of reading a file
 */
export interface FileReadResult {
  success: boolean;
  content?: string;
  error?: string;
  stats?: FileStats;
}

/**
 * File statistics
 */
export interface FileStats {
  size: number;
  modifiedAt: Date;
  createdAt: Date;
}

/**
 * Information about a watched file
 */
export interface WatchedFile {
  filePath: string;
  lastModified: Date;
}

/**
 * File change event data
 */
export interface FileChangeEvent {
  filePath: string;
  content: string;
  stats: FileStats;
}

/**
 * File delete event data
 */
export interface FileDeleteEvent {
  filePath: string;
}

/**
 * What a typed or pasted path was resolved against
 */
export type PathResolveBase = 'absolute' | 'document' | 'home';

/**
 * Result of resolving a typed or pasted path to a document on disk
 */
export interface PathResolveResult {
  success: boolean;
  /** The absolute path the input resolved to, when it could be resolved at all */
  filePath?: string;
  /** What a relative input was resolved against */
  resolvedFrom?: PathResolveBase;
  error?: string;
}

/**
 * Result of writing a file
 */
export interface FileWriteResult {
  success: boolean;
  error?: string;
}
