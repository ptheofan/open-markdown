/**
 * ClipboardService - Handles clipboard operations in the main process
 */
import { clipboard, dialog, nativeImage, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';

import type { SaveFileResult } from '@shared/types';

/**
 * Service for handling clipboard operations
 */
export class ClipboardService {
  /**
   * Write plain text to clipboard
   */
  writeText(text: string): void {
    clipboard.writeText(text);
  }

  /**
   * Write HTML to clipboard
   * Also writes plain text fallback
   */
  writeHtml(html: string): void {
    clipboard.write({
      html,
      text: html.replace(/<[^>]*>/g, ''), // Strip HTML for plain text fallback
    });
  }

  /**
   * Write PNG image to clipboard from base64 data
   */
  writeImage(base64: string): void {
    // Handle data URL format or raw base64
    const base64Data = base64.startsWith('data:')
      ? base64.split(',')[1] ?? ''
      : base64;

    const buffer = Buffer.from(base64Data, 'base64');
    const image = nativeImage.createFromBuffer(buffer);

    if (image.isEmpty()) {
      throw new Error('Failed to create image from base64 data');
    }

    clipboard.writeImage(image);
  }

  /**
   * Save image to file with save dialog
   */
  async saveFile(
    base64: string,
    defaultFilename: string,
    parentWindow?: BrowserWindow
  ): Promise<SaveFileResult> {
    const options: Electron.SaveDialogOptions = {
      title: 'Save Image',
      defaultPath: defaultFilename,
      filters: [{ name: 'PNG Images', extensions: ['png'] }],
    };

    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return {
        success: false,
        cancelled: true,
      };
    }

    try {
      // Handle data URL format or raw base64
      const base64Data = base64.startsWith('data:')
        ? base64.split(',')[1] ?? ''
        : base64;

      const buffer = Buffer.from(base64Data, 'base64');
      await writeFile(result.filePath, buffer);

      return {
        success: true,
        filePath: result.filePath,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save file',
      };
    }
  }
}

/**
 * Singleton instance
 */
let clipboardServiceInstance: ClipboardService | null = null;

/**
 * Get the ClipboardService singleton instance
 */
export function getClipboardService(): ClipboardService {
  if (!clipboardServiceInstance) {
    clipboardServiceInstance = new ClipboardService();
  }
  return clipboardServiceInstance;
}
