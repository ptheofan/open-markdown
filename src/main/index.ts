/**
 * Main process entry point
 */
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

import { registerAllHandlers } from './ipc/handlers';
import { getThemeService } from './services/ThemeService';
import { getPreferencesService } from './services/PreferencesService';
import { getRecentFilesService } from './services/RecentFilesService';
import { getMainWindow } from './window/MainWindow';
import { getFileService } from './services/FileService';
import { IPC_CHANNELS } from '@shared/types';
import { MARKDOWN_EXTENSIONS } from '@shared/constants';

let pendingFilePath: string | null = null;
let rendererReady = false;

/**
 * Check command-line arguments for markdown file
 */
function checkCommandLineArgs(): void {
  // Skip the first args (electron path, app path in dev, or just app path in prod)
  const args = process.argv.slice(app.isPackaged ? 1 : 2);

  const filePath = args.find((arg) => {
    if (arg.startsWith('-')) return false;
    const ext = path.extname(arg).toLowerCase();
    return (MARKDOWN_EXTENSIONS as readonly string[]).includes(ext);
  });

  if (filePath) {
    // Resolve to absolute path if needed
    pendingFilePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(filePath);
  }
}

/**
 * Send pending file to renderer when ready
 */
function sendPendingFile(): void {
  const mainWindow = getMainWindow();
  if (pendingFilePath && mainWindow.exists()) {
    mainWindow.send(IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN, {
      filePath: pendingFilePath,
    });
    pendingFilePath = null;
  }
}

/**
 * Create application window
 */
function createWindow(): void {
  const mainWindow = getMainWindow();
  mainWindow.create();

  // Open DevTools in development
  if (process.env['NODE_ENV'] !== 'production') {
    mainWindow.openDevTools();
  }
}

/**
 * Initialize application
 */
async function initialize(): Promise<void> {
  // Check for file argument in command line
  checkCommandLineArgs();

  // Initialize services
  await getThemeService().initialize();
  await getPreferencesService().initialize();
  await getRecentFilesService().initialize();

  // Register IPC handlers before creating windows
  registerAllHandlers();

  rendererReady = false;
  createWindow();

  const mainWindow = getMainWindow();
  const win = mainWindow.getWindow();
  if (win) {
    win.webContents.once('did-finish-load', () => {
      rendererReady = true;
      sendPendingFile();
    });
  }
}

// Electron app lifecycle events

// macOS: Handle file open events (can fire before app is ready)
app.on('open-file', (event, filePath) => {
  event.preventDefault();

  // Validate it's a markdown file
  const ext = path.extname(filePath).toLowerCase();
  const fileService = getFileService();
  if (!fileService.isMarkdownFile(ext)) {
    return;
  }

  if (rendererReady) {
    const mainWindow = getMainWindow();
    mainWindow.send(IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN, {
      filePath,
    });
  } else {
    pendingFilePath = filePath;
  }
});

app.whenReady()
  .then(() => {
    void initialize();

    // macOS: re-create window when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        rendererReady = false;
        createWindow();

        const mainWindow = getMainWindow();
        const win = mainWindow.getWindow();
        if (win) {
          win.webContents.once('did-finish-load', () => {
            rendererReady = true;
            sendPendingFile();
          });
        }
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

// Security: Prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
