/**
 * Main process entry point
 */
import { app, shell } from 'electron';
import path from 'node:path';

import { registerAllHandlers } from './ipc/handlers';
import {
  registerAssetProtocolScheme,
  registerAssetProtocolHandler,
} from './services/AssetProtocolService';
import { setupApplicationMenu } from './menu/applicationMenu';
import { getPreferencesService } from './services/PreferencesService';
import { getRecentFilesService } from './services/RecentFilesService';
import { getWindowManager } from './window/WindowManager';
import { getFileService } from './services/FileService';
import { getGoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import { MARKDOWN_EXTENSIONS } from '@shared/constants';

let preReadyFilePath: string | null = null;

// Custom protocol used to serve local image assets must be registered as a
// privileged scheme before the app `ready` event fires.
registerAssetProtocolScheme();

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
 * Initialize application
 */
async function initialize(): Promise<void> {
  // Pre-ready open-file event takes priority over CLI args
  const pendingFilePath = preReadyFilePath ?? checkCommandLineArgs();
  preReadyFilePath = null;

  // Initialize services
  // Note: ThemeService needs no initialization — it only detects OS theme.
  // PreferencesService is the single source of truth for theme mode preference.
  await getPreferencesService().initialize();
  await getRecentFilesService().initialize();
  await getGoogleDocsLinkStore().initialize();
  // GoogleAuthService initializes lazily on first use (avoids keychain prompt at startup)

  // Serve local image assets referenced by markdown documents
  registerAssetProtocolHandler();

  // Register IPC handlers before creating windows
  registerAllHandlers();

  // Set up application menu
  setupApplicationMenu();

  getWindowManager().createWindow(pendingFilePath ?? undefined);
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

  if (app.isReady()) {
    getWindowManager().openFile(filePath);
  } else {
    // Store for initialize() to pick up when app is ready
    preReadyFilePath = filePath;
  }
});

app.whenReady()
  .then(() => {
    void initialize();
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize app:', error);
    app.quit();
  });

// Quit when all windows are closed
app.on('window-all-closed', () => {
  app.quit();
});

// Security: Deny in-app new windows, but open https/http links in the
// user's default browser via the OS. This lets renderer-side <a target="_blank">
// links (e.g. GitHub issues link in Preferences) work without broadening the
// renderer's privileges.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
});
