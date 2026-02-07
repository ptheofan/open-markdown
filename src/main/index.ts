/**
 * Main process entry point
 */
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

import { registerAllHandlers } from './ipc/handlers';
import { getThemeService } from './services/ThemeService';
import { getPreferencesService } from './services/PreferencesService';
import { getRecentFilesService } from './services/RecentFilesService';
import { getWindowManager } from './window/WindowManager';
import { getFileService } from './services/FileService';
import { IPC_CHANNELS } from '@shared/types';
import { MARKDOWN_EXTENSIONS } from '@shared/constants';

interface PendingWindow {
  filePath: string | null;
  rendererReady: boolean;
}

const pendingWindows = new Map<number, PendingWindow>();
let preReadyFilePath: string | null = null;

/**
 * Check command-line arguments for markdown file
 */
function checkCommandLineArgs(): string | null {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);

  const filePath = args.find((arg) => {
    if (arg.startsWith('-')) return false;
    const ext = path.extname(arg).toLowerCase();
    return (MARKDOWN_EXTENSIONS as readonly string[]).includes(ext);
  });

  if (filePath) {
    return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  }

  return null;
}

/**
 * Send pending file to a specific window when its renderer is ready
 */
function sendPendingFile(windowId: number): void {
  const pending = pendingWindows.get(windowId);
  if (!pending?.filePath) return;

  const windowManager = getWindowManager();
  const win = windowManager.getWindow(windowId);
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN, {
      filePath: pending.filePath,
    });
    pending.filePath = null;
  }
}

/**
 * Create an application window, optionally with a file to open
 */
function createWindow(filePath?: string): BrowserWindow {
  const windowManager = getWindowManager();
  const win = windowManager.createWindow();

  pendingWindows.set(win.id, {
    filePath: filePath ?? null,
    rendererReady: false,
  });

  win.webContents.ipc.once(IPC_CHANNELS.APP.RENDERER_READY, () => {
    const pending = pendingWindows.get(win.id);
    if (pending) {
      pending.rendererReady = true;
    }
    sendPendingFile(win.id);
  });

  win.on('closed', () => {
    pendingWindows.delete(win.id);
  });

  return win;
}

/**
 * Focus an existing window
 */
function focusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
}

/**
 * Initialize application
 */
async function initialize(): Promise<void> {
  // Pre-ready open-file event takes priority over CLI args
  const pendingFilePath = preReadyFilePath ?? checkCommandLineArgs();
  preReadyFilePath = null;

  // Initialize services
  await getThemeService().initialize();
  await getPreferencesService().initialize();
  await getRecentFilesService().initialize();

  // Register IPC handlers before creating windows
  registerAllHandlers();

  createWindow(pendingFilePath ?? undefined);
}

// Electron app lifecycle events

// macOS: Handle file open events (can fire before app is ready)
app.on('open-file', (event, filePath) => {
  event.preventDefault();

  const ext = path.extname(filePath).toLowerCase();
  const fileService = getFileService();
  if (!fileService.isMarkdownFile(ext)) {
    return;
  }

  const windowManager = getWindowManager();

  // If a window already has this file, focus it
  const existingWin = windowManager.getWindowByFilePath(filePath);
  if (existingWin && !existingWin.isDestroyed()) {
    focusWindow(existingWin);
    return;
  }

  // If there's an empty window, load the file there
  const emptyWin = windowManager.getEmptyWindow();
  if (emptyWin && !emptyWin.isDestroyed()) {
    const pending = pendingWindows.get(emptyWin.id);
    if (pending?.rendererReady) {
      emptyWin.webContents.send(IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN, {
        filePath,
      });
    } else if (pending) {
      pending.filePath = filePath;
    }
    focusWindow(emptyWin);
    return;
  }

  // Otherwise create a new window
  if (app.isReady()) {
    createWindow(filePath);
  } else {
    // Store for initialize() to pick up when app is ready
    preReadyFilePath = filePath;
  }
});

app.whenReady()
  .then(() => {
    void initialize();

    // macOS: re-create window when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize app:', error);
    app.quit();
  });

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent new window creation from web content
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
