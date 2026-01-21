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
} from './plugin';

// API types
export { IPC_CHANNELS } from './api';
export type {
  IpcChannel,
  FileAPI,
  ThemeAPI,
  AppAPI,
  WindowAPI,
  ElectronAPI,
  FullscreenChangeEvent,
} from './api';
