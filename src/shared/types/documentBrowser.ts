import type { PinnedFileEntry, RecentFileEntry } from './recentFiles';

/**
 * Where the document view sits inside a window, in CSS pixels of the page,
 * plus the text it currently shows. Reported by a renderer when the main
 * process asks, so a capture can be cut down to the document alone.
 */
export interface ViewerDescription {
  /** Bounding box of the document view, or null when no document is shown. */
  rect: { x: number; y: number; width: number; height: number } | null;
  /** Plain text of the rendered document, used for content filtering. */
  text: string;
}

/**
 * One open document in the browser: a window with a file loaded.
 */
export interface OpenDocumentEntry {
  windowId: number;
  filePath: string;
  fileName: string;
  /** Data URL of the document view, or null when no capture was possible. */
  thumbnail: string | null;
  /** True for the window that asked for the snapshot. */
  isCurrent: boolean;
  /** Plain text of the document, used for content filtering. */
  text: string;
}

/**
 * A pinned document, with when it was last changed on disk
 */
export interface PinnedDocumentEntry extends PinnedFileEntry {
  /** ISO 8601 modification time, or null when the file cannot be read */
  modifiedAt: string | null;
  /** The window showing it, or null when it is not open */
  windowId: number | null;
}

/**
 * Everything the document browser shows: pinned documents, open documents,
 * then recent files that are neither pinned nor open in any window.
 */
export interface DocumentBrowserSnapshot {
  pinned: PinnedDocumentEntry[];
  open: OpenDocumentEntry[];
  recent: RecentFileEntry[];
}
