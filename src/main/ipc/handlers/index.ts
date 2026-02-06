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
  registerFindHandlers,
  unregisterFindHandlers,
} from './FindHandler';

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
  registerFindHandlers();
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
  unregisterFindHandlers();
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
  registerFindHandlers,
  unregisterFindHandlers,
} from './FindHandler';
