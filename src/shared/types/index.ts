// File types
export type {
  FileOpenResult,
  FileReadResult,
  FileStats,
  WatchedFile,
  FileChangeEvent,
  FileDeleteEvent,
} from './file';

// Theme types
export type {
  ThemeMode,
  ResolvedTheme,
  Theme,
  ThemeConfig,
  ThemeChangeEvent,
} from './theme';

// Plugin types
export type {
  PluginMetadata,
  PluginOptions,
  MarkdownPlugin,
  PluginManagerConfig,
  PluginLoadResult,
  PluginRegistrationEvent,
  ContextMenuData,
} from './plugin';

// API types
export { IPC_CHANNELS } from './api';
export type {
  IpcChannel,
  FileAPI,
  ThemeAPI,
  AppAPI,
  WindowAPI,
  ContextMenuAPI,
  ClipboardAPI,
  ElectronAPI,
  FullscreenChangeEvent,
  ContextMenuItem,
  ContextMenuShowRequest,
  SaveFileResult,
} from './api';
