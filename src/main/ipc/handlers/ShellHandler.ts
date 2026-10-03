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
 * Quote one argument for the shell the command runs through.
 */
function shellQuote(arg: string): string {
  if (process.platform === 'win32') {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command line that opens a file in an editor, at a position when one is
 * given. Each editor has its own way of taking a line. A custom command may
 * use {file}, {line} and {column} placeholders; without them the file is
 * appended.
 */
export function buildEditorCommand(
  editor: ExternalEditorId,
  customCommand: string,
  filePath: string,
  line?: number,
  column?: number
): string | null {
  const position = line ? `${filePath}:${line}${column ? `:${column}` : ''}` : filePath;

  switch (editor) {
    case 'none':
      return null;
    case 'custom': {
      const command = customCommand.trim();
      if (!command) return null;
      if (/\{file\}/.test(command)) {
        return command
          .replace(/\{file\}/g, shellQuote(filePath))
          .replace(/\{line\}/g, line ? String(line) : '')
          .replace(/\{column\}/g, column ? String(column) : '');
      }
      return `${command} ${shellQuote(filePath)}`;
    }
    case 'vscode':
    case 'cursor':
      return line
        ? `${EDITOR_COMMANDS[editor]} -g ${shellQuote(position)}`
        : `${EDITOR_COMMANDS[editor]} ${shellQuote(filePath)}`;
    case 'webstorm':
      return line
        ? `${EDITOR_COMMANDS[editor]} --line ${line}${column ? ` --column ${column}` : ''} ${shellQuote(filePath)}`
        : `${EDITOR_COMMANDS[editor]} ${shellQuote(filePath)}`;
    case 'sublime':
    case 'zed':
      return `${EDITOR_COMMANDS[editor]} ${shellQuote(position)}`;
    default:
      return null;
  }
}

/**
 * Protocols allowed to be opened in the default system browser/handler
 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
]);

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
    (_event, filePath: string, line?: number, column?: number): OpenInEditorResult => {
      const prefs = getPreferencesService().getPreferences();
      const { editor, customCommand } = prefs.core.externalEditor;

      if (editor === 'none') {
        return { success: false, error: 'No external editor configured' };
      }

      const safeLine = Number.isInteger(line) && line! > 0 ? line : undefined;
      const safeColumn = Number.isInteger(column) && column! > 0 ? column : undefined;
      const command = buildEditorCommand(editor, customCommand, filePath, safeLine, safeColumn);
      if (!command) {
        return { success: false, error: 'No custom editor command configured' };
      }

      try {
        const child = spawn(command, [], {
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

  // Open an external URL in the default system browser/handler
  ipcMain.handle(
    IPC_CHANNELS.SHELL.OPEN_EXTERNAL,
    async (_event, url: string): Promise<void> => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }

      if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
        return;
      }

      await shell.openExternal(parsed.toString());
    }
  );
}

/**
 * Unregister shell IPC handlers
 */
export function unregisterShellHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SHELL.REVEAL_IN_FILE_MANAGER);
  ipcMain.removeHandler(IPC_CHANNELS.SHELL.OPEN_IN_EDITOR);
  ipcMain.removeHandler(IPC_CHANNELS.SHELL.OPEN_EXTERNAL);
}
