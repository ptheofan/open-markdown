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
  registerShellHandlers,
  unregisterShellHandlers,
} from './ShellHandler';

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
  registerShellHandlers();
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
  unregisterShellHandlers();
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
  registerShellHandlers,
  unregisterShellHandlers,
} from './ShellHandler';
