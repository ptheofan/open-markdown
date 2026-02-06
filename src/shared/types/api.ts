import type {
  FileOpenResult,
  FileReadResult,
  FileChangeEvent,
  FileDeleteEvent,
} from './file';
import type { ThemeMode, ResolvedTheme, ThemeChangeEvent } from './theme';
import type { AppPreferences, DeepPartial } from './preferences';
import type {
  FileAssociationStatus,
  FileAssociationResult,
  ExternalFileOpenEvent,
} from './fileAssociation';

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
  CONTEXT_MENU: {
    SHOW: 'context-menu:show',
  },
  CLIPBOARD: {
    WRITE_TEXT: 'clipboard:write-text',
    WRITE_HTML: 'clipboard:write-html',
    WRITE_IMAGE: 'clipboard:write-image',
    SAVE_FILE: 'clipboard:save-file',
  },
  PREFERENCES: {
    GET: 'preferences:get',
    SET: 'preferences:set',
    RESET: 'preferences:reset',
    GET_PLUGIN: 'preferences:get-plugin',
    SET_PLUGIN: 'preferences:set-plugin',
    ON_CHANGE: 'preferences:on-change',
  },
  FILE_ASSOCIATION: {
    GET_STATUS: 'file-association:get-status',
    SET_AS_DEFAULT: 'file-association:set-as-default',
    ON_EXTERNAL_OPEN: 'file-association:on-external-open',
  },
} as const;

/**
 * Type for IPC channel names
 */
export type IpcChannel =
  | (typeof IPC_CHANNELS.FILE)[keyof typeof IPC_CHANNELS.FILE]
  | (typeof IPC_CHANNELS.THEME)[keyof typeof IPC_CHANNELS.THEME]
  | (typeof IPC_CHANNELS.APP)[keyof typeof IPC_CHANNELS.APP]
  | (typeof IPC_CHANNELS.WINDOW)[keyof typeof IPC_CHANNELS.WINDOW]
  | (typeof IPC_CHANNELS.CONTEXT_MENU)[keyof typeof IPC_CHANNELS.CONTEXT_MENU]
  | (typeof IPC_CHANNELS.CLIPBOARD)[keyof typeof IPC_CHANNELS.CLIPBOARD]
  | (typeof IPC_CHANNELS.PREFERENCES)[keyof typeof IPC_CHANNELS.PREFERENCES]
  | (typeof IPC_CHANNELS.FILE_ASSOCIATION)[keyof typeof IPC_CHANNELS.FILE_ASSOCIATION];

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
 * Context menu item definition
 */
export interface ContextMenuItem {
  id: string;
  label: string;
  enabled: boolean;
}

/**
 * Context menu show request
 */
export interface ContextMenuShowRequest {
  items: ContextMenuItem[];
  x: number;
  y: number;
}

/**
 * Result of save file operation
 */
export interface SaveFileResult {
  success: boolean;
  filePath?: string;
  cancelled?: boolean;
  error?: string;
}

/**
 * Context menu API exposed to renderer
 */
export interface ContextMenuAPI {
  show: (request: ContextMenuShowRequest) => Promise<string | null>;
}

/**
 * Clipboard operations API exposed to renderer
 */
export interface ClipboardAPI {
  writeText: (text: string) => Promise<void>;
  writeHtml: (html: string) => Promise<void>;
  writeImage: (base64: string) => Promise<void>;
  saveFile: (base64: string, filename: string) => Promise<SaveFileResult>;
}

/**
 * Preferences operations API exposed to renderer
 */
export interface PreferencesAPI {
  get: () => Promise<AppPreferences>;
  set: (updates: DeepPartial<AppPreferences>) => Promise<AppPreferences>;
  reset: () => Promise<AppPreferences>;
  getPluginPreferences: <T>(pluginId: string) => Promise<T | null>;
  setPluginPreferences: <T>(pluginId: string, preferences: T) => Promise<void>;
  onChange: (callback: (preferences: AppPreferences) => void) => () => void;
}

/**
 * File association API exposed to renderer
 */
export interface FileAssociationAPI {
  getStatus: () => Promise<FileAssociationStatus>;
  setAsDefault: () => Promise<FileAssociationResult>;
  onExternalOpen: (
    callback: (event: ExternalFileOpenEvent) => void
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
  contextMenu: ContextMenuAPI;
  clipboard: ClipboardAPI;
  preferences: PreferencesAPI;
  fileAssociation: FileAssociationAPI;
}

/**
 * Augment global Window interface with electron API
 */
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
