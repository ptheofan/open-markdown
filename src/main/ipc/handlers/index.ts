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
