/**
 * DocumentExportService - a self-contained HTML page of the rendered document
 *
 * Print, PDF and HTML export all start from the same page: the rendered
 * document as it stands, with the app's stylesheet and theme variables
 * inlined, diagrams as the SVG they already are, local images and the
 * KaTeX fonts as data URIs, and the app's chrome stripped out. Opened on its
 * own it needs nothing from the network and runs no script, which its own
 * Content-Security-Policy enforces.
 */
import { BUILTIN_PLUGINS } from '@shared/constants';
import { generateCompleteThemeCSS } from '../../themes';

import type { PluginManager } from '@plugins/core/PluginManager';
import type { MermaidPlugin } from '@plugins/builtin/MermaidPlugin';
import type { CorePreferences } from '@shared/types';
import type { ExportAPI } from '@shared/types/export';
import type { PluginThemeDeclaration, ResolvedTheme } from '../../themes/types';

export interface StandaloneHtmlOptions {
  /** The rendered document */
  contentElement: HTMLElement;
  /** Shown as the page title */
  title: string;
  /** Palette the page is drawn in */
  theme: ResolvedTheme;
  /** The theme the app is showing now; diagrams are re-drawn when it differs */
  currentTheme: ResolvedTheme;
  pluginManager: PluginManager;
  pluginDeclarations: PluginThemeDeclaration;
  preferences: CorePreferences | null;
}

export interface StandaloneHtmlResult {
  html: string;
  /** Images that could not be inlined (missing, too large) and were left referencing their file */
  skippedImages: number;
}

/** Selectors for things that belong to the app, not the document */
const CHROME_SELECTOR =
  '.code-copy-btn, .change-gutter-deleted, .change-gutter-reset-btn, [data-change-gutter-deleted], script, .slice-handle';

const ATTRIBUTES_TO_DROP = [
  'data-source-lines',
  'data-plugin-id',
  'data-mermaid-id',
  'data-mermaid-source',
  'data-mermaid-code',
  'data-file-ref',
  'data-file-line',
  'data-file-column',
  'data-file-path',
  'contenteditable',
];

/**
 * Styles the exported page adds on top of the app's: a plain body around the
 * document, and print rules so pages break sensibly.
 */
const EXPORT_CSS = `
html, body {
  height: auto;
  overflow: visible;
}

body {
  background-color: var(--doc-bg-color, var(--bg-color));
}

.markdown-body {
  padding: 32px;
}

.markdown-body .task-list-checkbox {
  pointer-events: none;
}

@page {
  margin: 18mm 16mm;
}

@media print {
  body {
    background-color: #ffffff;
  }

  .markdown-body {
    max-width: none;
    padding: 0;
  }

  .markdown-body pre {
    white-space: pre-wrap;
    word-break: break-word;
    overflow: visible;
  }

  .markdown-body pre,
  .markdown-body table,
  .markdown-body img,
  .markdown-body .mermaid-container,
  .markdown-body .math-block,
  .markdown-body .markdown-alert,
  .markdown-body .front-matter {
    break-inside: avoid;
  }

  .markdown-body h1,
  .markdown-body h2,
  .markdown-body h3,
  .markdown-body h4 {
    break-after: avoid;
  }

  .markdown-body a {
    color: inherit;
  }

  .markdown-body details > summary {
    cursor: default;
  }
}
`;

/** Scripts and styles may not come from anywhere; images may still be web images the author linked */
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:;";

/**
 * Service that builds the standalone page and hands it to main
 */
export class DocumentExportService {
  constructor(private readonly exportApi: ExportAPI) {}

  /**
   * Build the page.
   */
  async buildStandaloneHtml(options: StandaloneHtmlOptions): Promise<StandaloneHtmlResult> {
    const { contentElement, title, theme, currentTheme, pluginManager } = options;

    const root = contentElement.cloneNode(true) as HTMLElement;
    this.stripChrome(root);
    this.flattenFileReferences(root);

    if (theme !== currentTheme) {
      await this.redrawDiagrams(root, pluginManager, theme);
    }
    this.dropAttributes(root);

    const skippedImages = await this.inlineImages(root);
    const hasMath = root.querySelector('.katex') !== null;

    const css = [
      generateCompleteThemeCSS(theme, options.pluginDeclarations, options.preferences ?? undefined),
      await this.collectStylesheets(hasMath),
      document.getElementById('plugin-styles')?.textContent ?? '',
      EXPORT_CSS,
    ].join('\n\n');

    const html =
      '<!DOCTYPE html>\n' +
      `<html lang="en" data-theme="${theme}">\n` +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">\n` +
      `<meta name="generator" content="Open Markdown">\n` +
      `<title>${escapeHtml(title)}</title>\n` +
      `<style>\n${css}\n</style>\n` +
      '</head>\n' +
      '<body>\n' +
      `<article class="markdown-body">\n${root.innerHTML}\n</article>\n` +
      '</body>\n' +
      '</html>\n';

    return { html, skippedImages };
  }

  /** The default file name for an export of this document */
  static exportFileName(documentPath: string | null, extension: 'pdf' | 'html'): string {
    const base = documentPath ? documentPath.split(/[\\/]/).pop() ?? 'document' : 'document';
    const stem = base.replace(/\.[^.]+$/, '') || 'document';
    return `${stem}.${extension}`;
  }

  private stripChrome(root: HTMLElement): void {
    for (const el of root.querySelectorAll(CHROME_SELECTOR)) el.remove();
  }

  /**
   * A file reference is a link only inside the app; outside it is the path.
   */
  private flattenFileReferences(root: HTMLElement): void {
    for (const anchor of root.querySelectorAll('a.file-ref')) {
      const span = document.createElement('span');
      while (anchor.firstChild) span.appendChild(anchor.firstChild);
      anchor.replaceWith(span);
    }
  }

  private dropAttributes(root: HTMLElement): void {
    for (const el of root.querySelectorAll('*')) {
      for (const attr of ATTRIBUTES_TO_DROP) el.removeAttribute(attr);
    }
  }

  /**
   * Diagrams bake the palette they were drawn with into their SVG, so a
   * light export of a dark window draws them again in the light palette.
   */
  private async redrawDiagrams(
    root: HTMLElement,
    pluginManager: PluginManager,
    theme: ResolvedTheme
  ): Promise<void> {
    const mermaid = pluginManager.getPlugin<MermaidPlugin>(BUILTIN_PLUGINS.MERMAID);
    if (!mermaid?.renderSvgForExport) return;

    for (const container of root.querySelectorAll<HTMLElement>('.mermaid-container[data-mermaid-source]')) {
      const encoded = container.getAttribute('data-mermaid-source');
      if (!encoded) continue;
      try {
        const code = mermaid.decodeFromAttribute(encoded);
        container.innerHTML = await mermaid.renderSvgForExport(code, theme);
      } catch {
        // Keep the diagram as drawn on screen
      }
    }
  }

  /**
   * Local images become data URIs. Returns how many could not be.
   */
  private async inlineImages(root: HTMLElement): Promise<number> {
    const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]')).filter((img) => {
      const src = img.getAttribute('src') ?? '';
      return src.startsWith('om-asset:') || src.startsWith('file:');
    });
    if (images.length === 0) return 0;

    const urls = Array.from(new Set(images.map((img) => img.getAttribute('src') ?? '')));
    const inlined = await this.safeInline(urls);

    let skipped = 0;
    for (const img of images) {
      const src = img.getAttribute('src') ?? '';
      const data = inlined[src];
      if (data) {
        img.setAttribute('src', data);
      } else {
        skipped++;
      }
    }
    return skipped;
  }

  /**
   * The app's stylesheets as text. The KaTeX font faces are inlined when the
   * document has math and left out when it does not, since they are most of
   * the size.
   */
  private async collectStylesheets(hasMath: boolean): Promise<string> {
    const rules: string[] = [];
    const fontUrls = new Set<string>();

    const nodes = document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
      'style, link[rel="stylesheet"]'
    );
    for (const node of Array.from(nodes)) {
      // The theme variables are generated afresh above and the plugin styles
      // are read as text below; the rest is read here
      if (node.id === 'theme-variables' || node.id === 'plugin-styles') continue;

      let cssRules: CSSRuleList;
      try {
        const sheet = node.sheet;
        if (!sheet) continue;
        cssRules = sheet.cssRules;
      } catch {
        continue;
      }

      for (const rule of Array.from(cssRules)) {
        const text = rule.cssText;
        if (text.trimStart().startsWith('@font-face')) {
          const family = /font-family:\s*["']?([^;"'}]+)/.exec(text)?.[1]?.trim() ?? '';
          if (family.startsWith('KaTeX') && !hasMath) continue;
          const urls = this.fontUrlsIn(text);
          // A font the page would have to fetch is left out; only local ones are inlined
          if (urls.some((url) => /^https?:/.test(url))) continue;
          for (const url of urls) fontUrls.add(url);
        }
        rules.push(text);
      }
    }

    let css = rules.join('\n');
    if (fontUrls.size > 0) {
      const inlined = await this.safeInline(Array.from(fontUrls));
      for (const [url, data] of Object.entries(inlined)) {
        if (data) css = css.split(url).join(data);
      }
    }
    return css;
  }

  private fontUrlsIn(cssText: string): string[] {
    const urls: string[] = [];
    for (const match of cssText.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const url = match[1];
      if (url && /^(file:|https?:|om-asset:)/.test(url)) urls.push(url);
    }
    return urls;
  }

  private async safeInline(urls: string[]): Promise<Record<string, string | null>> {
    try {
      return await this.exportApi.inlineAssets(urls);
    } catch {
      return {};
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Factory function to create a DocumentExportService
 */
export function createDocumentExportService(exportApi: ExportAPI): DocumentExportService {
  return new DocumentExportService(exportApi);
}
