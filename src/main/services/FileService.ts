/**
 * FileService - Handles file operations in the main process
 */
import { dialog, BrowserWindow } from 'electron';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { MARKDOWN_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '@shared/constants';
import {
  FileNotFoundError,
  FileReadError,
  InvalidFileTypeError,
} from '@shared/errors';

import { resolveDocumentPath } from './DocumentPathResolver';

import type {
  FileOpenResult,
  FileReadResult,
  FileWriteResult,
  FileStats,
  PathResolveResult,
} from '@shared/types';

/**
 * Service for handling file operations
 */
export class FileService {
  /**
   * Show native file open dialog and read selected markdown file
   */
  async openFileDialog(
    parentWindow?: BrowserWindow
  ): Promise<FileOpenResult> {
    const options: Electron.OpenDialogOptions = {
      title: 'Open Markdown File',
      filters: [
        {
          name: 'Markdown Files',
          extensions: ['md', 'markdown', 'mdown', 'mkd'],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    };

    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return {
        success: false,
        cancelled: true,
      };
    }

    const filePath = result.filePaths[0];
    if (!filePath) {
      return {
        success: false,
        cancelled: true,
      };
    }

    // Validate file extension
    const ext = path.extname(filePath).toLowerCase();
    if (!this.isMarkdownFile(ext)) {
      const error = new InvalidFileTypeError(filePath, [...MARKDOWN_EXTENSIONS]);
      return {
        success: false,
        error: error.toUserMessage(),
      };
    }

    // Read the file content
    const readResult = await this.readFile(filePath);
    if (!readResult.success) {
      return {
        success: false,
        filePath,
        error: readResult.error,
      };
    }

    return {
      success: true,
      filePath,
      content: readResult.content,
    };
  }

  /**
   * Resolve a typed or pasted path to a markdown file on disk. A relative
   * path is taken from the folder of baseFilePath (the document the window
   * shows), or from the home directory when the window is empty.
   */
  async resolvePath(
    input: string,
    baseFilePath: string | null,
    homeDir: string = homedir()
  ): Promise<PathResolveResult> {
    const resolved = resolveDocumentPath(input, baseFilePath, homeDir);
    if (!resolved) {
      return { success: false, error: 'Enter a path to a markdown file.' };
    }

    const { filePath, resolvedFrom } = resolved;

    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(filePath);
    } catch {
      return {
        success: false,
        filePath,
        resolvedFrom,
        error: 'No such file.',
      };
    }

    if (stats.isDirectory()) {
      return {
        success: false,
        filePath,
        resolvedFrom,
        error: 'That is a folder, not a markdown file.',
      };
    }

    if (!this.isMarkdownFile(path.extname(filePath))) {
      return {
        success: false,
        filePath,
        resolvedFrom,
        error: `Not a markdown file (${MARKDOWN_EXTENSIONS.join(', ')}).`,
      };
    }

    return { success: true, filePath, resolvedFrom };
  }

  /**
   * Read a file from the filesystem
   */
  async readFile(filePath: string): Promise<FileReadResult> {
    try {
      // Check if file exists and get stats
      const stats = await this.getFileStats(filePath);
      if (!stats) {
        const error = new FileNotFoundError(filePath);
        return {
          success: false,
          error: error.toUserMessage(),
        };
      }

      // Check file size
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        return {
          success: false,
          error: `File is too large (${this.formatFileSize(stats.size)}). Maximum size is ${this.formatFileSize(MAX_FILE_SIZE_BYTES)}.`,
        };
      }

      // Read file content
      const content = await readFile(filePath, 'utf-8');

      return {
        success: true,
        content,
        stats,
      };
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          const notFoundError = new FileNotFoundError(filePath);
          return {
            success: false,
            error: notFoundError.toUserMessage(),
          };
        }
        if (nodeError.code === 'EACCES') {
          const readError = new FileReadError(filePath, 'Permission denied');
          return {
            success: false,
            error: readError.toUserMessage(),
          };
        }
      }

      const readError = new FileReadError(
        filePath,
        error instanceof Error ? error.message : 'Unknown error'
      );
      return {
        success: false,
        error: readError.toUserMessage(),
      };
    }
  }

  /**
   * Write content to a file
   */
  async writeFile(filePath: string, content: string): Promise<FileWriteResult> {
    try {
      await writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Get file statistics
   */
  async getFileStats(filePath: string): Promise<FileStats | null> {
    try {
      const stats = await stat(filePath);
      return {
        size: stats.size,
        modifiedAt: stats.mtime,
        createdAt: stats.birthtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if file extension is a markdown file
   */
  isMarkdownFile(extension: string): boolean {
    const normalizedExt = extension.startsWith('.')
      ? extension.toLowerCase()
      : `.${extension.toLowerCase()}`;
    return (MARKDOWN_EXTENSIONS as readonly string[]).includes(normalizedExt);
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

/**
 * Singleton instance
 */
let fileServiceInstance: FileService | null = null;

/**
 * Get the FileService singleton instance
 */
export function getFileService(): FileService {
  if (!fileServiceInstance) {
    fileServiceInstance = new FileService();
  }
  return fileServiceInstance;
}
