// Domain error base
export {
  DomainError,
  isDomainError,
  isSerializedError,
} from './DomainError';
export type { SerializedError } from './DomainError';

// File errors
export {
  FileNotFoundError,
  FileReadError,
  FileWatchError,
  FileOperationCancelledError,
  InvalidFileTypeError,
  FileEncodingError,
} from './FileError';

// Plugin errors
export {
  PluginLoadError,
  PluginInitError,
  PluginNotFoundError,
  PluginAlreadyRegisteredError,
  PluginRenderError,
  PluginConfigError,
} from './PluginError';

// Preferences errors
export {
  PreferencesErrorCode,
  PreferencesLoadError,
  PreferencesSaveError,
  PreferencesValidationError,
  PreferencesMigrationError,
  ColorFormatError,
  PluginPreferencesError,
} from './PreferencesError';
