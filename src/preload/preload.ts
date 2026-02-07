/**
 * Preload script - Runs in an isolated context with access to Node.js
 * Exposes a secure API to the renderer process via contextBridge
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';

import { IPC_CHANNELS } from '@shared/types/api';

import type {
  ElectronAPI,
  FileChangeEvent,
  FileDeleteEvent,
  FileOpenResult,
  FileReadResult,
  FullscreenChangeEvent,
  RecentFileEntry,
  ResolvedTheme,
  ThemeChangeEvent,
  ThemeMode,
  ContextMenuShowRequest,
  SaveFileResult,
  AppPreferences,
  DeepPartial,
  FileAssociationStatus,
  FileAssociationResult,
  ExternalFileOpenEvent,
} from '@shared/types';

/**
 * Create the API object to expose to renderer
 */
const electronAPI: ElectronAPI = {
  file: {
    openDialog: (): Promise<FileOpenResult> => {
      return ipcRenderer.invoke(IPC_CHANNELS.FILE.OPEN_DIALOG);
    },

    read: (filePath: string): Promise<FileReadResult> => {
      return ipcRenderer.invoke(IPC_CHANNELS.FILE.READ, filePath);
    },

    watch: (filePath: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.FILE.WATCH, filePath);
    },

    unwatch: (filePath: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.FILE.UNWATCH, filePath);
    },

    getDroppedFilePath: (file: File): string => {
      return webUtils.getPathForFile(file);
    },

    onFileChange: (callback: (event: FileChangeEvent) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: FileChangeEvent
      ): void => {
        callback(data);
      };

      ipcRenderer.on(IPC_CHANNELS.FILE.ON_CHANGE, handler);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.FILE.ON_CHANGE, handler);
      };
    },

    onFileDelete: (callback: (event: FileDeleteEvent) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: FileDeleteEvent
      ): void => {
        callback(data);
      };

      ipcRenderer.on(IPC_CHANNELS.FILE.ON_DELETE, handler);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.FILE.ON_DELETE, handler);
      };
    },
  },

  theme: {
    getCurrent: (): Promise<ThemeMode> => {
      return ipcRenderer.invoke(IPC_CHANNELS.THEME.GET_CURRENT);
    },

    set: (theme: ThemeMode): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.THEME.SET, theme);
    },

    getSystem: (): Promise<ResolvedTheme> => {
      return ipcRenderer.invoke(IPC_CHANNELS.THEME.GET_SYSTEM);
    },

    onSystemChange: (
      callback: (event: ThemeChangeEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: ThemeChangeEvent
      ): void => {
        callback(data);
      };

      ipcRenderer.on(IPC_CHANNELS.THEME.ON_SYSTEM_CHANGE, handler);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.THEME.ON_SYSTEM_CHANGE, handler);
      };
    },
  },

  app: {
    getVersion: (): string => {
      return process.env['npm_package_version'] ?? '1.0.0';
    },

    getPlatform: (): NodeJS.Platform => {
      return process.platform;
    },

    signalReady: (): void => {
      ipcRenderer.send(IPC_CHANNELS.APP.RENDERER_READY);
    },
  },

  window: {
    getFullscreen: (): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WINDOW.GET_FULLSCREEN);
    },

    openNew: (filePath?: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, filePath);
    },

    onFullscreenChange: (
      callback: (event: FullscreenChangeEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: FullscreenChangeEvent
      ): void => {
        callback(data);
      };

      ipcRenderer.on(IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE, handler);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(
          IPC_CHANNELS.WINDOW.ON_FULLSCREEN_CHANGE,
          handler
        );
      };
    },
  },

  contextMenu: {
    show: (request: ContextMenuShowRequest): Promise<string | null> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MENU.SHOW, request);
    },
  },

  clipboard: {
    writeText: (text: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD.WRITE_TEXT, text);
    },

    writeHtml: (html: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD.WRITE_HTML, html);
    },

    writeImage: (base64: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD.WRITE_IMAGE, base64);
    },

    saveFile: (base64: string, filename: string): Promise<SaveFileResult> => {
      return ipcRenderer.invoke(
        IPC_CHANNELS.CLIPBOARD.SAVE_FILE,
        base64,
        filename
      );
    },
  },

  preferences: {
    get: (): Promise<AppPreferences> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES.GET);
    },

    set: (updates: DeepPartial<AppPreferences>): Promise<AppPreferences> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES.SET, updates);
    },

    reset: (): Promise<AppPreferences> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES.RESET);
    },

    getPluginPreferences: <T>(pluginId: string): Promise<T | null> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES.GET_PLUGIN, pluginId);
    },

    setPluginPreferences: <T>(pluginId: string, preferences: T): Promise<void> => {
      return ipcRenderer.invoke(
        IPC_CHANNELS.PREFERENCES.SET_PLUGIN,
        pluginId,
        preferences
      );
    },

    onChange: (
      callback: (preferences: AppPreferences) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: AppPreferences
      ): void => {
        callback(data);
      };

      ipcRenderer.on(IPC_CHANNELS.PREFERENCES.ON_CHANGE, handler);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.PREFERENCES.ON_CHANGE, handler);
      };
    },
  },

  fileAssociation: {
    getStatus: (): Promise<FileAssociationStatus> => {
      return ipcRenderer.invoke(IPC_CHANNELS.FILE_ASSOCIATION.GET_STATUS);
    },

    setAsDefault: (): Promise<FileAssociationResult> => {
      return ipcRenderer.invoke(IPC_CHANNELS.FILE_ASSOCIATION.SET_AS_DEFAULT);
    },

    onExternalOpen: (
      callback: (event: ExternalFileOpenEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: ExternalFileOpenEvent
      ): void => {
        callback(data);
      };

      ipcRenderer.on(IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN, handler);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(
          IPC_CHANNELS.FILE_ASSOCIATION.ON_EXTERNAL_OPEN,
          handler
        );
      };
    },
  },

  recentFiles: {
    get: (): Promise<RecentFileEntry[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.RECENT_FILES.GET);
    },

    add: (filePath: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.RECENT_FILES.ADD, filePath);
    },

    remove: (filePath: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.RECENT_FILES.REMOVE, filePath);
    },

    clear: (): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.RECENT_FILES.CLEAR);
    },

    onChange: (callback: (files: RecentFileEntry[]) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: RecentFileEntry[]
      ): void => {
        callback(data);
      };

      ipcRenderer.on(IPC_CHANNELS.RECENT_FILES.ON_CHANGE, handler);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.RECENT_FILES.ON_CHANGE, handler);
      };
    },
  },

};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
