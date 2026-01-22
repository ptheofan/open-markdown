/**
 * ContextMenuService - Handles native context menu operations in the main process
 */
import { Menu, BrowserWindow } from 'electron';

import type { ContextMenuItem } from '@shared/types';

/**
 * Service for handling context menu operations
 */
export class ContextMenuService {
  /**
   * Show a native context menu and return the selected item ID
   * @param items - Menu items to display
   * @param _x - Unused (menu appears at mouse position)
   * @param _y - Unused (menu appears at mouse position)
   * @param window - The window to show the menu in
   * @returns Promise resolving to selected item ID, or null if dismissed
   */
  show(
    items: ContextMenuItem[],
    _x: number,
    _y: number,
    window: BrowserWindow
  ): Promise<string | null> {
    return new Promise((resolve) => {
      let resolved = false;

      const menuItems = items.map((item) => ({
        id: item.id,
        label: item.label,
        enabled: item.enabled,
        click: () => {
          if (!resolved) {
            resolved = true;
            resolve(item.id);
          }
        },
      }));

      const menu = Menu.buildFromTemplate(menuItems);

      // Handle menu close without selection
      menu.on('menu-will-close', () => {
        // Use setImmediate to ensure click handler runs first
        setImmediate(() => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        });
      });

      // Don't pass x,y - let Electron use the current mouse cursor position
      // This avoids coordinate system issues between renderer and main process
      menu.popup({ window });
    });
  }
}

/**
 * Singleton instance
 */
let contextMenuServiceInstance: ContextMenuService | null = null;

/**
 * Get the ContextMenuService singleton instance
 */
export function getContextMenuService(): ContextMenuService {
  if (!contextMenuServiceInstance) {
    contextMenuServiceInstance = new ContextMenuService();
  }
  return contextMenuServiceInstance;
}
