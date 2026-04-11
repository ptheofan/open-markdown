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
 * Result of writing a file
 */
export interface FileWriteResult {
  success: boolean;
  error?: string;
}
