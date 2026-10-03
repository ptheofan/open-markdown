/**
 * ExportService - PDF, print and HTML export in the main process
 *
 * The renderer builds a self-contained HTML page of the document; this
 * service turns it into a PDF or a print job by loading it in a hidden window
 * and asking Chromium, or writes it out as is. Everything the page needs is
 * already inside it, so the hidden window runs with no preload, no node, and
 * a page whose own CSP forbids scripts.
 */
import { app, BrowserWindow, dialog } from 'electron';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASSET_PROTOCOL_SCHEME } from '@shared/constants';

import type { ExportResult, PageOptions } from '@shared/types/export';

/** Largest single asset that is inlined, and the most inlined per request */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ASSET_BYTES = 60 * 1024 * 1024;

/** Environment variable that, when set, writes exports there without a dialog (tests) */
export const EXPORT_DIR_ENV = 'OPEN_MARKDOWN_E2E_EXPORT_DIR';

const ASSET_MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.apng': 'image/apng',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);

/** The MIME type an asset is inlined with, by extension; null when not inlinable */
export function mimeForAsset(filePath: string): string | null {
  return ASSET_MIME[path.extname(filePath).toLowerCase()] ?? null;
}

/**
 * The local file an asset URL points at, or null. `om-asset:` URLs carry the
 * path the way the protocol handler reads them; `file:` URLs are only
 * honoured for the app's own font files, which the exported stylesheet
 * refers to, and only inside the app's resources.
 */
export function assetFilePath(url: string, rendererDir: string | null): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol === `${ASSET_PROTOCOL_SCHEME}:`) {
    try {
      return fileURLToPath(`file://${parsed.pathname}`);
    } catch {
      return null;
    }
  }

  if (parsed.protocol === 'file:') {
    let filePath: string;
    try {
      filePath = fileURLToPath(parsed);
    } catch {
      return null;
    }
    if (!FONT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null;
    if (!rendererDir) return null;
    const relative = path.relative(rendererDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return filePath;
  }

  return null;
}

/** A data URI for the bytes */
export function toDataUri(data: Buffer, mime: string): string {
  return `data:${mime};base64,${data.toString('base64')}`;
}

/** Electron's name for a page size */
function pageSizeOf(options: PageOptions): 'A4' | 'Letter' {
  return options.pageSize === 'Letter' ? 'Letter' : 'A4';
}

export interface ExportServiceOptions {
  /** Folder the renderer's bundled assets live in; fonts outside it are refused */
  rendererDir?: string | null;
  /** Remembered save folder, read before and written after each save */
  getLastDirectory?: () => string;
  setLastDirectory?: (dir: string) => void;
}

/**
 * Service for exporting and printing documents
 */
export class ExportService {
  private readonly rendererDir: string | null;
  private readonly getLastDirectory: () => string;
  private readonly setLastDirectory: (dir: string) => void;

  constructor(options: ExportServiceOptions = {}) {
    this.rendererDir = options.rendererDir ?? null;
    this.getLastDirectory = options.getLastDirectory ?? ((): string => '');
    this.setLastDirectory = options.setLastDirectory ?? ((): void => undefined);
  }

  /**
   * Render the page to a PDF and save it.
   */
  async savePdf(
    html: string,
    defaultName: string,
    options: PageOptions,
    parentWindow?: BrowserWindow
  ): Promise<ExportResult> {
    const target = await this.chooseTarget(defaultName, 'pdf', parentWindow);
    if (!target) return { success: false, cancelled: true };

    try {
      const pdf = await this.withHiddenPage(html, async (win) => {
        return win.webContents.printToPDF({
          pageSize: pageSizeOf(options),
          landscape: options.landscape,
          printBackground: options.printBackground,
          preferCSSPageSize: false,
          margins: { marginType: 'default' },
        });
      });
      await writeFile(target, pdf);
      this.setLastDirectory(path.dirname(target));
      return { success: true, filePath: target };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to export PDF' };
    }
  }

  /**
   * Save the page as an HTML file.
   */
  async saveHtml(html: string, defaultName: string, parentWindow?: BrowserWindow): Promise<ExportResult> {
    const target = await this.chooseTarget(defaultName, 'html', parentWindow);
    if (!target) return { success: false, cancelled: true };

    try {
      await writeFile(target, html, 'utf-8');
      this.setLastDirectory(path.dirname(target));
      return { success: true, filePath: target };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to export HTML' };
    }
  }

  /**
   * Open the system print dialog for the page. Resolves once the dialog is
   * closed, whether or not anything was printed.
   */
  async print(html: string, options: PageOptions, parentWindow?: BrowserWindow): Promise<ExportResult> {
    try {
      await this.withHiddenPage(html, (win) => {
        return new Promise<void>((resolve, reject) => {
          const printOptions: Electron.WebContentsPrintOptions = {
            silent: false,
            printBackground: options.printBackground,
            landscape: options.landscape,
            pageSize: pageSizeOf(options),
          };
          win.webContents.print(printOptions, (ok, failureReason) => {
            if (ok || failureReason === 'cancelled' || failureReason === 'Print job canceled') {
              resolve();
            } else {
              reject(new Error(failureReason || 'Print failed'));
            }
          });
        });
      }, parentWindow);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to print' };
    }
  }

  /**
   * Read assets as data URIs, keyed by URL. Unreadable, unsupported and
   * oversized ones map to null; a total budget stops a document full of
   * screenshots from producing a gigabyte of HTML.
   */
  async inlineAssets(urls: string[]): Promise<Record<string, string | null>> {
    const results: Record<string, string | null> = {};
    let total = 0;

    for (const url of new Set(urls)) {
      results[url] = null;
      const filePath = assetFilePath(url, this.rendererDir);
      if (!filePath) continue;
      const mime = mimeForAsset(filePath);
      if (!mime) continue;

      try {
        const info = await stat(filePath);
        if (!info.isFile() || info.size > MAX_ASSET_BYTES || total + info.size > MAX_TOTAL_ASSET_BYTES) {
          continue;
        }
        const data = await readFile(filePath);
        total += data.byteLength;
        results[url] = toDataUri(data, mime);
      } catch {
        // Stays null
      }
    }

    return results;
  }

  /**
   * Where to save: a dialog, or the folder named by the test environment.
   * Returns null when the user cancels.
   */
  private async chooseTarget(
    defaultName: string,
    kind: 'pdf' | 'html',
    parentWindow?: BrowserWindow
  ): Promise<string | null> {
    const envDir = process.env[EXPORT_DIR_ENV];
    if (envDir) {
      return path.join(envDir, defaultName);
    }

    const lastDir = this.getLastDirectory();
    let baseDir = lastDir;
    if (!baseDir) {
      try {
        baseDir = app.getPath('downloads');
      } catch {
        baseDir = os.homedir();
      }
    }

    const options: Electron.SaveDialogOptions = {
      title: kind === 'pdf' ? 'Export as PDF' : 'Export as HTML',
      defaultPath: path.join(baseDir, defaultName),
      filters:
        kind === 'pdf'
          ? [{ name: 'PDF', extensions: ['pdf'] }]
          : [{ name: 'HTML', extensions: ['html', 'htm'] }],
    };

    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  }

  /**
   * Load the HTML in a hidden window, run the job, and tear everything down.
   * The page goes through a temp file rather than a data: URL, which has a
   * length limit a document with inlined images would blow past.
   */
  private async withHiddenPage<T>(
    html: string,
    job: (win: BrowserWindow) => Promise<T>,
    parentWindow?: BrowserWindow
  ): Promise<T> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'open-markdown-export-'));
    const file = path.join(dir, 'document.html');
    await writeFile(file, html, 'utf-8');

    const win = new BrowserWindow({
      show: false,
      parent: parentWindow,
      width: 1000,
      height: 800,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: false,
      },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        win.webContents.once('did-finish-load', () => resolve());
        win.webContents.once('did-fail-load', (_event, code, description) => {
          reject(new Error(`Could not load the document for export (${code}: ${description})`));
        });
        void win.loadFile(file);
      });

      // Fonts load after the DOM does; a PDF taken too early draws fallbacks
      try {
        await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      return await job(win);
    } finally {
      if (!win.isDestroyed()) win.destroy();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Singleton instance
 */
let exportServiceInstance: ExportService | null = null;

/**
 * Get the ExportService singleton instance
 */
export function getExportService(options?: ExportServiceOptions): ExportService {
  if (!exportServiceInstance) {
    exportServiceInstance = new ExportService(options);
  }
  return exportServiceInstance;
}
