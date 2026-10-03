/**
 * Export types: printing a document and saving it as PDF or self-contained HTML.
 */

/** Paper sizes offered for PDF and print */
export type ExportPageSize = 'A4' | 'Letter';

/** Which palette an export is drawn in */
export type ExportTheme = 'light' | 'current';

/** What the user picks in the export dialog; remembered between exports */
export interface ExportPreferences {
  theme: ExportTheme;
  pageSize: ExportPageSize;
  landscape: boolean;
  printBackground: boolean;
  /** Folder the last export was saved to; '' for the system default */
  lastDirectory: string;
}

/** Page options handed to main for a PDF or a print job */
export interface PageOptions {
  pageSize: ExportPageSize;
  landscape: boolean;
  printBackground: boolean;
}

/** Outcome of a save or print */
export interface ExportResult {
  success: boolean;
  /** Where the file was written, on success */
  filePath?: string;
  /** The user dismissed the save dialog; not an error */
  cancelled?: boolean;
  error?: string;
}

/**
 * Export API exposed to the renderer
 */
export interface ExportAPI {
  /** Render HTML to a PDF and save it, asking where unless the environment says */
  savePdf: (html: string, defaultName: string, options: PageOptions) => Promise<ExportResult>;
  /** Save self-contained HTML, asking where */
  saveHtml: (html: string, defaultName: string) => Promise<ExportResult>;
  /** Open the system print dialog for the HTML */
  print: (html: string, options: PageOptions) => Promise<ExportResult>;
  /**
   * Read local assets the document refers to -- images under `om-asset:` and
   * the app's own font files -- as data URIs, keyed by the URL as given;
   * null for anything unreadable, unsupported or over the size limit.
   */
  inlineAssets: (urls: string[]) => Promise<Record<string, string | null>>;
}
