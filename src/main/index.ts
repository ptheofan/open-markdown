/**
 * Main process entry point
 */
import { app, BrowserWindow } from 'electron';

import started from 'electron-squirrel-startup';

import { registerAllHandlers } from './ipc/handlers';
import { getThemeService } from './services/ThemeService';
import { getMainWindow } from './window/MainWindow';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
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
  // Initialize services
  await getThemeService().initialize();

  // Register IPC handlers before creating windows
  registerAllHandlers();

  // Create window when ready
  createWindow();
}

// Electron app lifecycle events

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

// Security: Prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
