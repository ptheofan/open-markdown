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
export type CopyDocumentType = 'rich-text' | 'google-docs' | 'image';

/** Which part of the document a rich-text copy takes */
export type RichTextScope = 'document' | 'selection' | 'section';

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
 * Options for a rich-text copy
 */
export interface RichTextCopyOptions extends DocumentCopyOptions {
  /** The markdown source of the whole document, used as the plain-text alternative */
  markdown: string;
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
  /** For rich-text: what was copied */
  scope?: RichTextScope;
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

    const clone = contentElement.cloneNode(true) as HTMLElement;
    const { html, diagramCount } = await this.buildRichHtml(clone, contentElement, pluginManager);

    // Write to clipboard
    try {
      await this.clipboardApi.writeHtml(html);
    } catch (error) {
      throw new ClipboardWriteError('html', error);
    }

    return {
      success: true,
      diagramCount,
    };
  }

  /**
   * Copy the document, or the part of it the user has selected, as rich text
   * for pasting into Slack, mail, Notion, Apple Notes and the like.
   *
   * The clipboard gets both `text/html` and `text/plain`. The plain text is
   * the markdown itself for a whole-document copy and the selected text for a
   * selection: a target that takes no HTML still gets something readable,
   * and markdown is what most chat tools render anyway.
   */
  async copyAsRichText(options: RichTextCopyOptions): Promise<DocumentCopyResult> {
    const { contentElement, pluginManager, markdown } = options;

    if (!contentElement.innerHTML.trim()) {
      throw new NoDocumentError();
    }

    const selection = this.selectionWithin(contentElement);
    let root: HTMLElement;
    let plainText: string;
    let scope: RichTextScope;

    if (selection) {
      root = document.createElement('div');
      root.appendChild(selection.getRangeAt(0).cloneContents());
      plainText = selection.toString();
      scope = 'selection';
    } else {
      root = contentElement.cloneNode(true) as HTMLElement;
      plainText = markdown;
      scope = 'document';
    }

    const { html, diagramCount } = await this.buildRichHtml(root, contentElement, pluginManager);

    try {
      await this.clipboardApi.writeHtml(html, plainText);
    } catch (error) {
      throw new ClipboardWriteError('html', error);
    }

    return { success: true, diagramCount, scope };
  }

  /**
   * Copy one section -- a heading and everything up to the next heading of
   * the same or a higher level -- as rich text, with the section's markdown
   * as the plain-text alternative.
   */
  async copySectionAsRichText(
    heading: HTMLElement,
    sectionMarkdown: string,
    options: DocumentCopyOptions
  ): Promise<DocumentCopyResult> {
    const { contentElement, pluginManager } = options;

    const root = document.createElement('div');
    for (const node of this.sectionNodes(heading)) {
      root.appendChild(node.cloneNode(true));
    }

    const { html, diagramCount } = await this.buildRichHtml(root, contentElement, pluginManager);

    try {
      await this.clipboardApi.writeHtml(html, sectionMarkdown);
    } catch (error) {
      throw new ClipboardWriteError('html', error);
    }

    return { success: true, diagramCount, scope: 'section' };
  }

  /**
   * The rendered nodes of a heading's section: the heading itself and its
   * following siblings up to, not including, the next heading of the same or
   * a higher level.
   */
  sectionNodes(heading: HTMLElement): Node[] {
    const level = this.headingLevel(heading);
    const nodes: Node[] = [heading];
    let node: ChildNode | null = heading.nextSibling;
    while (node) {
      if (node instanceof HTMLElement) {
        const nextLevel = this.headingLevel(node);
        if (nextLevel !== null && level !== null && nextLevel <= level) break;
      }
      nodes.push(node);
      node = node.nextSibling;
    }
    return nodes;
  }

  /** 1-6 for an h1-h6 element, null for anything else */
  private headingLevel(element: HTMLElement): number | null {
    const match = /^h([1-6])$/i.exec(element.tagName);
    return match ? Number(match[1]) : null;
  }

  /**
   * The user's selection when it is non-empty and lies inside the document,
   * null otherwise (no selection, a caret, or a selection in app chrome).
   */
  private selectionWithin(contentElement: HTMLElement): Selection | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!contentElement.contains(range.commonAncestorContainer)) return null;
    if (!range.toString().trim()) return null;
    return selection;
  }

  /**
   * Turn a copy of rendered content into self-contained rich HTML: mermaid
   * diagrams become PNG images with a link back to mermaid.live, every
   * element carries inline styles, and app chrome is stripped out.
   */
  private async buildRichHtml(
    root: HTMLElement,
    contentElement: HTMLElement,
    pluginManager: PluginManager
  ): Promise<{ html: string; diagramCount: number }> {
    // Get the MermaidPlugin for diagram processing
    const mermaidPlugin = pluginManager.getPlugin<MermaidPlugin>(BUILTIN_PLUGINS.MERMAID);

    // Process mermaid diagrams
    let diagramCount = 0;
    const mermaidContainers = root.querySelectorAll('.mermaid-container[data-mermaid-source]');

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
        const liveUrl = await mermaidPlugin.generateMermaidLiveUrl(code);

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

    this.stripChrome(root);
    this.applyGoogleDocsStyles(root);

    return { html: root.innerHTML, diagramCount };
  }

  /**
   * Remove what belongs to the app rather than the document: code-block copy
   * buttons and change markers.
   */
  private stripChrome(root: HTMLElement): void {
    for (const el of root.querySelectorAll('.code-copy-btn, .change-gutter-deleted, .change-gutter-reset-btn')) {
      el.remove();
    }
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

      // Get background color from document preferences, falling back to theme default
      const bgColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--doc-bg-color')
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
      el.removeAttribute('data-source-lines');
      el.removeAttribute('data-lang');
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
