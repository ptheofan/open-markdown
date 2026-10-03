/**
 * IPC handlers for file operations
 */
import { ipcMain, BrowserWindow } from 'electron';

import { getFileService } from '../../services/FileService';
import { resolveFileReferences } from '../../services/FileReferenceResolver';
import { getFileWatcherService } from '../../services/FileWatcherService';
import { getPreferencesService } from '../../services/PreferencesService';
import { getWindowManager } from '@main/window/WindowManager';
import { IPC_CHANNELS } from '../channels';

import type {
  FileOpenResult,
  FileReadResult,
  FileWriteResult,
  PathResolveResult,
} from '@shared/types';

// Track per-window subscription cleanup functions to prevent duplicate callbacks
const windowSubscriptions = new Map<number, () => void>();

/**
 * Register file-related IPC handlers
 */
export function registerFileHandlers(): void {
  const fileService = getFileService();
  const fileWatcherService = getFileWatcherService();

  // Handle file open dialog
  ipcMain.handle(
    IPC_CHANNELS.FILE.OPEN_DIALOG,
    async (event): Promise<FileOpenResult> => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      return fileService.openFileDialog(window);
    }
  );

  // Resolve a typed or pasted path. A relative path is taken from the
  // folder of the document this window shows, so "../spec.md" means what
  // it would mean inside that document.
  ipcMain.handle(
    IPC_CHANNELS.FILE.RESOLVE_PATH,
    async (event, input: string): Promise<PathResolveResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const baseFilePath = window
        ? getWindowManager().getWindowFilePath(window.id)
        : null;
      return fileService.resolvePath(input, baseFilePath);
    }
  );

  // Resolve file references written in a document against its folder and
  // the project root (Preferences → Document → Project root, else the nearest
  // .git). Only existing files resolve.
  ipcMain.handle(
    IPC_CHANNELS.FILE.RESOLVE_REFERENCES,
    async (_event, documentPath: string, refs: string[]): Promise<Record<string, string | null>> => {
      if (typeof documentPath !== 'string' || !Array.isArray(refs)) return {};
      const projectRoot = getPreferencesService().getPreferences().core.viewer.projectRoot;
      return resolveFileReferences(
        refs.filter((ref): ref is string => typeof ref === 'string').slice(0, 500),
        documentPath,
        { projectRoot }
      );
    }
  );

  // Handle file read
  ipcMain.handle(
    IPC_CHANNELS.FILE.READ,
    async (_event, filePath: string): Promise<FileReadResult> => {
      return fileService.readFile(filePath);
    }
  );

  // Handle file write
  ipcMain.handle(
    IPC_CHANNELS.FILE.WRITE,
    async (_event, filePath: string, content: string): Promise<FileWriteResult> => {
      return fileService.writeFile(filePath, content);
    }
  );

  // Handle file watch
  ipcMain.handle(
    IPC_CHANNELS.FILE.WATCH,
    async (event, filePath: string): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;

      const windowId = window.id;

      // Unsubscribe previous callbacks for this window (prevents duplicates on file switch)
      const previousCleanup = windowSubscriptions.get(windowId);
      if (previousCleanup) {
        previousCleanup();
      }

      // Set up forwarding of file events to the renderer
      const unsubscribeChange = fileWatcherService.onFileChange(windowId, (changeEvent) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.FILE.ON_CHANGE, changeEvent);
        }
      });

      const unsubscribeDelete = fileWatcherService.onFileDelete(windowId, (deleteEvent) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.FILE.ON_DELETE, deleteEvent);
        }
      });

      const cleanup = (): void => {
        unsubscribeChange();
        unsubscribeDelete();
        windowSubscriptions.delete(windowId);
      };

      windowSubscriptions.set(windowId, cleanup);

      // Clean up subscriptions when window closes
      window.once('closed', () => {
        cleanup();
        void fileWatcherService.unwatchAll(windowId);
        getWindowManager().setWindowFilePath(windowId, null);
      });

      await fileWatcherService.watch(filePath, windowId);
      getWindowManager().setWindowFilePath(windowId, filePath);
    }
  );

  // Handle file unwatch
  ipcMain.handle(
    IPC_CHANNELS.FILE.UNWATCH,
    async (event, filePath: string): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;

      await fileWatcherService.unwatch(filePath, window.id);
      getWindowManager().setWindowFilePath(window.id, null);
    }
  );
}

/**
 * Unregister file-related IPC handlers
 */
export function unregisterFileHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.FILE.OPEN_DIALOG);
  ipcMain.removeHandler(IPC_CHANNELS.FILE.RESOLVE_PATH);
  ipcMain.removeHandler(IPC_CHANNELS.FILE.RESOLVE_REFERENCES);
  ipcMain.removeHandler(IPC_CHANNELS.FILE.READ);
  ipcMain.removeHandler(IPC_CHANNELS.FILE.WRITE);
  ipcMain.removeHandler(IPC_CHANNELS.FILE.WATCH);
  ipcMain.removeHandler(IPC_CHANNELS.FILE.UNWATCH);
}
