/**
 * Main process entry point
 */
import { app, shell } from 'electron';
import { statSync } from 'node:fs';
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

/** A file or folder named before the app was ready, opened once it is */
let preReadyOpen: PendingOpen | null = null;

interface PendingOpen {
  filePath?: string;
  folderPath?: string;
}

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

// Custom protocol used to serve local image assets must be registered as a
// privileged scheme before the app `ready` event fires.
registerAssetProtocolScheme();

/**
 * The markdown file or folder named on the command line, if any
 */
function checkCommandLineArgs(): PendingOpen | null {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);

  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    const resolved = path.isAbsolute(arg) ? arg : path.resolve(arg);
    const ext = path.extname(arg).toLowerCase();
    if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) {
      return { filePath: resolved };
    }
    if (isDirectory(resolved)) {
      return { folderPath: resolved };
    }
  }

  return null;
}

/**
 * Initialize application
 */
async function initialize(): Promise<void> {
  // Pre-ready open-file event takes priority over CLI args
  const pending = preReadyOpen ?? checkCommandLineArgs();
  preReadyOpen = null;

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

  getWindowManager().createWindow(pending ?? undefined);
}

// Electron app lifecycle events

// macOS: Handle file open events (can fire before app is ready)
app.on('open-file', (event, filePath) => {
  event.preventDefault();

  let pending: PendingOpen;
  if (isDirectory(filePath)) {
    pending = { folderPath: filePath };
  } else {
    const ext = path.extname(filePath).toLowerCase();
    if (!getFileService().isMarkdownFile(ext)) {
      return;
    }
    pending = { filePath };
  }

  if (app.isReady()) {
    const windows = getWindowManager();
    if (pending.folderPath) {
      windows.openFolder(pending.folderPath);
    } else if (pending.filePath) {
      windows.openFile(pending.filePath);
    }
  } else {
    // Store for initialize() to pick up when app is ready
    preReadyOpen = pending;
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
