/**
 * IPC handlers for exporting and printing documents
 */
import { ipcMain, BrowserWindow } from 'electron';
import path from 'node:path';

import { getExportService } from '../../services/ExportService';
import { getPreferencesService } from '../../services/PreferencesService';
import { IPC_CHANNELS } from '../channels';

import type { ExportResult, PageOptions } from '@shared/types/export';

/** Where the renderer's bundled assets (KaTeX fonts among them) are served from */
function rendererDir(): string | null {
  return typeof MAIN_WINDOW_VITE_NAME !== 'undefined'
    ? path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`)
    : null;
}

function safeName(name: unknown, extension: string): string {
  const base = typeof name === 'string' ? path.basename(name).trim() : '';
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '_');
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : `document${extension}`;
}

function pageOptions(input: unknown): PageOptions {
  const o = (input ?? {}) as Partial<PageOptions>;
  return {
    pageSize: o.pageSize === 'Letter' ? 'Letter' : 'A4',
    landscape: o.landscape === true,
    printBackground: o.printBackground !== false,
  };
}

/**
 * Register export-related IPC handlers
 */
export function registerExportHandlers(): void {
  const preferences = getPreferencesService();
  const exportService = getExportService({
    rendererDir: rendererDir(),
    getLastDirectory: () => preferences.getPreferences().core.export.lastDirectory,
    setLastDirectory: (dir) => {
      void preferences.updatePreferences({ core: { export: { lastDirectory: dir } } });
    },
  });

  ipcMain.handle(
    IPC_CHANNELS.EXPORT.SAVE_PDF,
    async (event, html: string, defaultName: string, options: unknown): Promise<ExportResult> => {
      if (typeof html !== 'string') return { success: false, error: 'Nothing to export' };
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      return exportService.savePdf(html, safeName(defaultName, '.pdf'), pageOptions(options), window);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPORT.SAVE_HTML,
    async (event, html: string, defaultName: string): Promise<ExportResult> => {
      if (typeof html !== 'string') return { success: false, error: 'Nothing to export' };
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      return exportService.saveHtml(html, safeName(defaultName, '.html'), window);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPORT.PRINT,
    async (event, html: string, options: unknown): Promise<ExportResult> => {
      if (typeof html !== 'string') return { success: false, error: 'Nothing to print' };
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      return exportService.print(html, pageOptions(options), window);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPORT.INLINE_ASSETS,
    async (_event, urls: unknown): Promise<Record<string, string | null>> => {
      if (!Array.isArray(urls)) return {};
      const list = urls.filter((u): u is string => typeof u === 'string').slice(0, 2000);
      return exportService.inlineAssets(list);
    }
  );
}

/**
 * Unregister export-related IPC handlers
 */
export function unregisterExportHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.EXPORT.SAVE_PDF);
  ipcMain.removeHandler(IPC_CHANNELS.EXPORT.SAVE_HTML);
  ipcMain.removeHandler(IPC_CHANNELS.EXPORT.PRINT);
  ipcMain.removeHandler(IPC_CHANNELS.EXPORT.INLINE_ASSETS);
}
