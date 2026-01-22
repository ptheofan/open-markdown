/**
 * DocumentCopyService - Handles copying document content to clipboard
 */
import { toPng } from 'html-to-image';

import {
  NoDocumentError,
  ImageCaptureError,
  ClipboardWriteError,
} from '@shared/errors';
import { BUILTIN_PLUGINS } from '@shared/constants';

import type { PluginManager } from '@plugins/core/PluginManager';
import type { MermaidPlugin } from '@plugins/builtin/MermaidPlugin';
import type { ClipboardAPI } from '@shared/types';

/**
 * Types of document copy operations
 */
export type CopyDocumentType = 'google-docs' | 'image';

/**
 * Options for copy operations
 */
export interface DocumentCopyOptions {
  /** The markdown content container element */
  contentElement: HTMLElement;
  /** The scroll container for full-page capture */
  scrollContainer: HTMLElement;
  /** Plugin manager to access MermaidPlugin */
  pluginManager: PluginManager;
  /** Current zoom level (1.0 = 100%) */
  zoomLevel: number;
}

/**
 * Result of document copy operation
 */
export interface DocumentCopyResult {
  success: boolean;
  error?: string;
  /** For google-docs: number of mermaid diagrams processed */
  diagramCount?: number;
  /** For image: dimensions of captured image */
  dimensions?: { width: number; height: number };
}

/**
 * Google Docs compatible inline styles for HTML elements
 */
const GOOGLE_DOCS_STYLES = {
  h1: 'font-size: 20pt; font-weight: bold; margin: 16pt 0 8pt 0;',
  h2: 'font-size: 16pt; font-weight: bold; margin: 14pt 0 6pt 0;',
  h3: 'font-size: 14pt; font-weight: bold; margin: 12pt 0 4pt 0;',
  h4: 'font-size: 12pt; font-weight: bold; margin: 10pt 0 4pt 0;',
  h5: 'font-size: 11pt; font-weight: bold; margin: 8pt 0 4pt 0;',
  h6: 'font-size: 10pt; font-weight: bold; margin: 8pt 0 4pt 0;',
  p: 'font-size: 11pt; margin: 0 0 8pt 0;',
  strong: 'font-weight: bold;',
  em: 'font-style: italic;',
  code: "font-family: 'Courier New', monospace; background-color: #f5f5f5; padding: 2px 4px; border-radius: 2px; font-size: 10pt;",
  pre: "font-family: 'Courier New', monospace; font-size: 10pt; background-color: #f5f5f5; padding: 12px; border-radius: 4px; margin: 8pt 0; white-space: pre-wrap;",
  ul: 'margin: 8pt 0; padding-left: 24pt;',
  ol: 'margin: 8pt 0; padding-left: 24pt;',
  li: 'font-size: 11pt; margin: 4pt 0;',
  a: 'color: #1a73e8; text-decoration: underline;',
  table: 'border-collapse: collapse; margin: 8pt 0;',
  th: 'border: 1px solid #dadce0; padding: 8px 12px; background-color: #f8f9fa; font-weight: bold; text-align: left;',
  td: 'border: 1px solid #dadce0; padding: 8px 12px;',
  blockquote: 'border-left: 4px solid #dadce0; margin: 8pt 0; padding: 8pt 16pt; color: #5f6368;',
  hr: 'border: none; border-top: 1px solid #dadce0; margin: 16pt 0;',
  img: 'max-width: 100%;',
};

/**
 * Service for copying document content to clipboard
 */
export class DocumentCopyService {
  constructor(private clipboardApi: ClipboardAPI) {}

  /**
   * Copy document as Google Docs-compatible rich text HTML
   * - Clones rendered content
   * - Converts mermaid diagrams to PNG + mermaid.live links
   * - Applies inline styles matching Google Docs markdown import
   */
  async copyForGoogleDocs(options: DocumentCopyOptions): Promise<DocumentCopyResult> {
    const { contentElement, pluginManager } = options;

    if (!contentElement.innerHTML.trim()) {
      throw new NoDocumentError();
    }

    // Clone the content for manipulation
    const clone = contentElement.cloneNode(true) as HTMLElement;

    // Get the MermaidPlugin for diagram processing
    const mermaidPlugin = pluginManager.getPlugin<MermaidPlugin>(BUILTIN_PLUGINS.MERMAID);

    // Process mermaid diagrams
    let diagramCount = 0;
    const mermaidContainers = clone.querySelectorAll('.mermaid-container[data-mermaid-source]');

    for (const container of mermaidContainers) {
      const originalContainer = this.findMatchingOriginalContainer(
        contentElement,
        container as HTMLElement
      );

      if (!originalContainer || !mermaidPlugin) {
        continue;
      }

      const encodedSource = container.getAttribute('data-mermaid-source');
      if (!encodedSource) continue;

      try {
        const code = mermaidPlugin.decodeFromAttribute(encodedSource);
        const pngBase64 = await mermaidPlugin.renderToPng(originalContainer);
        const liveUrl = mermaidPlugin.generateMermaidLiveUrl(code);

        // Replace container with image + link (image as block, no spacing between)
        const replacement = document.createElement('div');
        replacement.style.cssText = 'margin: 16pt 0;';
        replacement.innerHTML = `<img src="data:image/png;base64,${pngBase64}" alt="Mermaid diagram" style="display: block; max-width: 100%; margin: 0;"/><a href="${liveUrl}" style="${GOOGLE_DOCS_STYLES.a}; font-size: 10pt;">Edit in Mermaid Live</a>`;
        container.replaceWith(replacement);
        diagramCount++;
      } catch (error) {
        console.warn(`Failed to process mermaid diagram ${diagramCount}:`, error);
      }
    }

    // Apply Google Docs compatible inline styles
    this.applyGoogleDocsStyles(clone);

    // Write to clipboard
    try {
      await this.clipboardApi.writeHtml(clone.innerHTML);
    } catch (error) {
      throw new ClipboardWriteError('html', error);
    }

    return {
      success: true,
      diagramCount,
    };
  }

  /**
   * Copy document as a full-page PNG image
   * - Captures entire scrollable content at current zoom level
   * - Trims whitespace and adds uniform padding (like mermaid export)
   * - Uses html-to-image library
   */
  async copyAsImage(options: DocumentCopyOptions): Promise<DocumentCopyResult> {
    const { contentElement, scrollContainer, zoomLevel } = options;

    if (!contentElement.innerHTML.trim()) {
      throw new NoDocumentError();
    }

    try {
      const padding = 40; // Same padding as mermaid export

      // Get the full scrollable dimensions
      const fullWidth = scrollContainer.scrollWidth;
      const fullHeight = scrollContainer.scrollHeight;

      // Get background color from theme
      const bgColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg')
        .trim() || getComputedStyle(document.documentElement)
        .getPropertyValue('--bg-color')
        .trim() || '#ffffff';

      // Temporarily reset transform for accurate capture
      const originalTransform = contentElement.style.transform;
      const originalTransformOrigin = contentElement.style.transformOrigin;

      // First capture with transparent background to find content bounds
      const dataUrl = await toPng(contentElement, {
        width: fullWidth,
        height: fullHeight,
        pixelRatio: 2 * zoomLevel,
        backgroundColor: 'rgba(0,0,0,0)', // Transparent for bounds detection
        style: {
          transform: originalTransform,
          transformOrigin: originalTransformOrigin,
        },
      });

      // Load as image to get pixel data
      const img = await this.loadImage(dataUrl);

      // Create canvas to analyze pixels
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }
      ctx.drawImage(img, 0, 0);

      // Find content bounds by scanning for non-transparent pixels
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const bounds = this.findContentBounds(imageData);

      let finalBase64: string;
      let finalWidth: number;
      let finalHeight: number;

      if (!bounds) {
        // No content found, use original
        finalBase64 = dataUrl.split(',')[1] ?? '';
        finalWidth = img.width;
        finalHeight = img.height;
      } else {
        // Create final canvas with padding
        finalWidth = bounds.width + padding * 2;
        finalHeight = bounds.height + padding * 2;

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = finalWidth;
        finalCanvas.height = finalHeight;
        const finalCtx = finalCanvas.getContext('2d');
        if (!finalCtx) {
          throw new Error('Failed to get final canvas context');
        }

        // Fill with background color
        finalCtx.fillStyle = bgColor;
        finalCtx.fillRect(0, 0, finalWidth, finalHeight);

        // Draw cropped content with padding
        finalCtx.drawImage(
          canvas,
          bounds.x, bounds.y, bounds.width, bounds.height,
          padding, padding, bounds.width, bounds.height
        );

        // Export as PNG
        const finalDataUrl = finalCanvas.toDataURL('image/png');
        finalBase64 = finalDataUrl.split(',')[1] ?? '';
      }

      if (!finalBase64) {
        throw new Error('Failed to extract base64 from image data URL');
      }

      await this.clipboardApi.writeImage(finalBase64);

      return {
        success: true,
        dimensions: {
          width: finalWidth,
          height: finalHeight,
        },
      };
    } catch (error) {
      if (error instanceof ClipboardWriteError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ImageCaptureError(message, error);
    }
  }

  /**
   * Load an image from a data URL
   */
  private loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Find the bounding box of non-transparent content in an image
   */
  private findContentBounds(imageData: ImageData): { x: number; y: number; width: number; height: number } | null {
    const { data, width, height } = imageData;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let hasContent = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const alpha = data[i + 3];

        // Consider pixel as content if it has any opacity
        if (alpha !== undefined && alpha > 0) {
          hasContent = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!hasContent) {
      return null;
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }

  /**
   * Find the matching original container element by data-mermaid-id
   */
  private findMatchingOriginalContainer(
    originalContent: HTMLElement,
    clonedContainer: HTMLElement
  ): HTMLElement | null {
    const mermaidId = clonedContainer.getAttribute('data-mermaid-id');
    if (mermaidId) {
      return originalContent.querySelector<HTMLElement>(
        `.mermaid-container[data-mermaid-id="${mermaidId}"]`
      );
    }

    // Fallback: try to match by data-mermaid-source
    const source = clonedContainer.getAttribute('data-mermaid-source');
    if (source) {
      return originalContent.querySelector<HTMLElement>(
        `.mermaid-container[data-mermaid-source="${source}"]`
      );
    }

    return null;
  }

  /**
   * Apply Google Docs compatible inline styles to all elements
   */
  private applyGoogleDocsStyles(container: HTMLElement): void {
    // Apply styles to each element type
    for (const [tag, style] of Object.entries(GOOGLE_DOCS_STYLES)) {
      const elements = container.querySelectorAll(tag);
      for (const el of elements) {
        const element = el as HTMLElement;
        // Preserve existing inline styles and add Google Docs styles
        const existingStyle = element.getAttribute('style') || '';
        element.setAttribute('style', `${style} ${existingStyle}`);
      }
    }

    // Handle nested lists
    const nestedLists = container.querySelectorAll('li > ul, li > ol');
    for (const list of nestedLists) {
      const element = list as HTMLElement;
      element.style.marginTop = '4pt';
      element.style.marginBottom = '4pt';
    }

    // Clean up unwanted attributes and classes
    const allElements = container.querySelectorAll('*');
    for (const el of allElements) {
      el.removeAttribute('class');
      el.removeAttribute('data-plugin-id');
      el.removeAttribute('data-mermaid-id');
      el.removeAttribute('data-mermaid-source');
      el.removeAttribute('data-mermaid-code');
    }
  }
}

/**
 * Factory function to create a DocumentCopyService
 */
export function createDocumentCopyService(
  clipboardApi: ClipboardAPI
): DocumentCopyService {
  return new DocumentCopyService(clipboardApi);
}
