import type {
  FileOpenResult,
  FileReadResult,
  FileChangeEvent,
  FileDeleteEvent,
} from './file';
import type { ThemeMode, ResolvedTheme, ThemeChangeEvent } from './theme';

/**
 * IPC Channel names for type-safe communication
 */
export const IPC_CHANNELS = {
  FILE: {
    OPEN_DIALOG: 'file:open-dialog',
    READ: 'file:read',
    WATCH: 'file:watch',
    UNWATCH: 'file:unwatch',
    ON_CHANGE: 'file:on-change',
    ON_DELETE: 'file:on-delete',
  },
  THEME: {
    GET_CURRENT: 'theme:get-current',
    SET: 'theme:set',
    GET_SYSTEM: 'theme:get-system',
    ON_SYSTEM_CHANGE: 'theme:on-system-change',
  },
  APP: {
    GET_VERSION: 'app:get-version',
    GET_PLATFORM: 'app:get-platform',
  },
  WINDOW: {
    ON_FULLSCREEN_CHANGE: 'window:on-fullscreen-change',
    GET_FULLSCREEN: 'window:get-fullscreen',
  },
} as const;

/**
 * Type for IPC channel names
 */
export type IpcChannel =
  | (typeof IPC_CHANNELS.FILE)[keyof typeof IPC_CHANNELS.FILE]
  | (typeof IPC_CHANNELS.THEME)[keyof typeof IPC_CHANNELS.THEME]
  | (typeof IPC_CHANNELS.APP)[keyof typeof IPC_CHANNELS.APP]
  | (typeof IPC_CHANNELS.WINDOW)[keyof typeof IPC_CHANNELS.WINDOW];

/**
 * Fullscreen change event data
 */
export interface FullscreenChangeEvent {
  isFullscreen: boolean;
}

/**
 * File operations API exposed to renderer
 */
export interface FileAPI {
  openDialog: () => Promise<FileOpenResult>;
  read: (filePath: string) => Promise<FileReadResult>;
  watch: (filePath: string) => Promise<void>;
  unwatch: (filePath: string) => Promise<void>;
  onFileChange: (
    callback: (event: FileChangeEvent) => void
  ) => () => void;
  onFileDelete: (
    callback: (event: FileDeleteEvent) => void
  ) => () => void;
}

/**
 * Theme operations API exposed to renderer
 */
export interface ThemeAPI {
  getCurrent: () => Promise<ThemeMode>;
  set: (theme: ThemeMode) => Promise<void>;
  getSystem: () => Promise<ResolvedTheme>;
  onSystemChange: (
    callback: (event: ThemeChangeEvent) => void
  ) => () => void;
}

/**
 * App information API exposed to renderer
 */
export interface AppAPI {
  getVersion: () => string;
  getPlatform: () => NodeJS.Platform;
}

/**
 * Window state API exposed to renderer
 */
export interface WindowAPI {
  getFullscreen: () => Promise<boolean>;
  onFullscreenChange: (
    callback: (event: FullscreenChangeEvent) => void
  ) => () => void;
}

/**
 * Complete Electron API exposed via contextBridge
 */
export interface ElectronAPI {
  file: FileAPI;
  theme: ThemeAPI;
  app: AppAPI;
  window: WindowAPI;
}

/**
 * Augment global Window interface with electron API
 */
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
