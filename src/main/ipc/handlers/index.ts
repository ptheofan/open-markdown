/**
 * IPC handler registration
 */
import { registerFileHandlers, unregisterFileHandlers } from './FileHandler';
import { registerThemeHandlers, unregisterThemeHandlers } from './ThemeHandler';
import {
  registerClipboardHandlers,
  unregisterClipboardHandlers,
} from './ClipboardHandler';
import {
  registerContextMenuHandlers,
  unregisterContextMenuHandlers,
} from './ContextMenuHandler';
import {
  registerPreferencesHandlers,
  unregisterPreferencesHandlers,
} from './PreferencesHandler';
import {
  registerFileAssociationHandlers,
  unregisterFileAssociationHandlers,
} from './FileAssociationHandler';
import {
  registerRecentFilesHandlers,
  unregisterRecentFilesHandlers,
} from './RecentFilesHandler';
import {
  registerWindowHandlers,
  unregisterWindowHandlers,
} from './WindowHandler';
import {
  registerGoogleDocsHandlers,
  unregisterGoogleDocsHandlers,
} from './GoogleDocsHandler';

/**
 * Register all IPC handlers
 */
export function registerAllHandlers(): void {
  registerFileHandlers();
  registerThemeHandlers();
  registerClipboardHandlers();
  registerContextMenuHandlers();
  registerPreferencesHandlers();
  registerFileAssociationHandlers();
  registerRecentFilesHandlers();
  registerWindowHandlers();
  registerGoogleDocsHandlers();
}

/**
 * Unregister all IPC handlers
 */
export function unregisterAllHandlers(): void {
  unregisterFileHandlers();
  unregisterThemeHandlers();
  unregisterClipboardHandlers();
  unregisterContextMenuHandlers();
  unregisterPreferencesHandlers();
  unregisterFileAssociationHandlers();
  unregisterRecentFilesHandlers();
  unregisterWindowHandlers();
  unregisterGoogleDocsHandlers();
}

// Re-export individual handlers
export { registerFileHandlers, unregisterFileHandlers } from './FileHandler';
export { registerThemeHandlers, unregisterThemeHandlers } from './ThemeHandler';
export {
  registerClipboardHandlers,
  unregisterClipboardHandlers,
} from './ClipboardHandler';
export {
  registerContextMenuHandlers,
  unregisterContextMenuHandlers,
} from './ContextMenuHandler';
export {
  registerPreferencesHandlers,
  unregisterPreferencesHandlers,
} from './PreferencesHandler';
export {
  registerFileAssociationHandlers,
  unregisterFileAssociationHandlers,
} from './FileAssociationHandler';
export {
  registerRecentFilesHandlers,
  unregisterRecentFilesHandlers,
} from './RecentFilesHandler';
export {
  registerWindowHandlers,
  unregisterWindowHandlers,
} from './WindowHandler';
export {
  registerGoogleDocsHandlers,
  unregisterGoogleDocsHandlers,
} from './GoogleDocsHandler';
