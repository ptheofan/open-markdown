/**
 * ShellHandler - IPC handlers for shell operations (reveal in file manager, open in editor)
 */
import { ipcMain, shell } from 'electron';
import { spawn } from 'child_process';

import { getPreferencesService } from '@main/services/PreferencesService';
import { IPC_CHANNELS } from '@shared/types/api';

import type { ExternalEditorId } from '@shared/types';
import type { OpenInEditorResult } from '@shared/types/api';

/**
 * Map of editor preset IDs to CLI commands
 */
const EDITOR_COMMANDS: Record<Exclude<ExternalEditorId, 'none' | 'custom'>, string> = {
  vscode: 'code',
  cursor: 'cursor',
  webstorm: 'webstorm',
  sublime: 'subl',
  zed: 'zed',
};

/**
 * Register shell IPC handlers
 */
export function registerShellHandlers(): void {
  // Reveal file in native file manager (Finder, Explorer, etc.)
  ipcMain.handle(
    IPC_CHANNELS.SHELL.REVEAL_IN_FILE_MANAGER,
    (_event, filePath: string): void => {
      shell.showItemInFolder(filePath);
    }
  );

  // Open file in configured external editor
  ipcMain.handle(
    IPC_CHANNELS.SHELL.OPEN_IN_EDITOR,
    (_event, filePath: string): OpenInEditorResult => {
      const prefs = getPreferencesService().getPreferences();
      const { editor, customCommand } = prefs.core.externalEditor;

      if (editor === 'none') {
        return { success: false, error: 'No external editor configured' };
      }

      let command: string;
      if (editor === 'custom') {
        command = customCommand.trim();
        if (!command) {
          return { success: false, error: 'No custom editor command configured' };
        }
      } else {
        command = EDITOR_COMMANDS[editor];
      }

      try {
        const child = spawn(command, [filePath], {
          detached: true,
          stdio: 'ignore',
          shell: true,
        });
        child.unref();
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to launch editor';
        return { success: false, error: message };
      }
    }
  );
}

/**
 * Unregister shell IPC handlers
 */
export function unregisterShellHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SHELL.REVEAL_IN_FILE_MANAGER);
  ipcMain.removeHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
}
