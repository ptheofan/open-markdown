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

// Preferences types
export type {
  OklchColor,
  ColorPair,
  TypographyStyle,
  ListStyle,
  CorePreferences,
  PluginPreferencesMap,
  AppPreferences,
  PreferencesChangeEvent,
  DeepPartial,
  PreferenceFieldType,
  PreferenceFieldBase,
  BooleanPreferenceField,
  StringPreferenceField,
  SelectPreferenceField,
  ColorPreferenceField,
  ColorPairPreferenceField,
  NumberPreferenceField,
  PreferenceField,
  PreferencesSection,
  PluginPreferencesSchema,
} from './preferences';

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
  PreferencesAPI,
  ElectronAPI,
  FullscreenChangeEvent,
  ContextMenuItem,
  ContextMenuShowRequest,
  SaveFileResult,
} from './api';
