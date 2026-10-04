/**
 * Folder sidebar types: a directory opened as a collection of documents
 */

export type FolderEntryKind = 'file' | 'directory';

/** One row of a directory listing */
export interface FolderEntry {
  name: string;
  /** Absolute path */
  path: string;
  kind: FolderEntryKind;
  /** Whether a file is a markdown document (always false for directories) */
  isMarkdown: boolean;
}

export interface FolderListOptions {
  /** The folder opened in the sidebar; `.gitignore` files between it and the listed directory apply */
  root: string;
  /** Include files that are not markdown and hidden entries */
  showAll: boolean;
}

/** Sent when the contents of a watched directory change */
export interface FolderChangeEvent {
  dirPath: string;
}

export interface FolderAPI {
  /** Ask the user for a folder; null when they cancel */
  openDialog: () => Promise<string | null>;
  isDirectory: (targetPath: string) => Promise<boolean>;
  /** Entries of one directory, directories first, ignored names left out */
  list: (dirPath: string, options: FolderListOptions) => Promise<FolderEntry[]>;
  /** Every document under the root, as paths relative to it, for filtering */
  listAll: (root: string, options: { showAll: boolean }) => Promise<string[]>;
  /** The document to show when a folder opens: README, index, else the first one */
  defaultDocument: (root: string) => Promise<string | null>;
  watch: (dirPath: string) => Promise<void>;
  unwatch: (dirPath: string) => Promise<void>;
  onChange: (callback: (event: FolderChangeEvent) => void) => () => void;
}
