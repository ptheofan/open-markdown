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

/**
 * Register all IPC handlers
 */
export function registerAllHandlers(): void {
  registerFileHandlers();
  registerThemeHandlers();
  registerClipboardHandlers();
  registerContextMenuHandlers();
}

/**
 * Unregister all IPC handlers
 */
export function unregisterAllHandlers(): void {
  unregisterFileHandlers();
  unregisterThemeHandlers();
  unregisterClipboardHandlers();
  unregisterContextMenuHandlers();
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
