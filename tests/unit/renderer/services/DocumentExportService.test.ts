/**
 * @vitest-environment jsdom
 *
 * The standalone page an export is built from.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentExportService } from '@renderer/services/DocumentExportService';
import type { PluginManager } from '@plugins/core/PluginManager';
import type { ExportAPI } from '@shared/types/export';

describe('DocumentExportService.buildStandaloneHtml', () => {
  let content: HTMLElement;
  let api: ExportAPI;
  let service: DocumentExportService;
  const pluginManager = { getPlugin: () => null } as unknown as PluginManager;

  beforeEach(() => {
    document.head.innerHTML = `
      <style id="theme-variables">:root { --bg-color: #000; }</style>
      <style id="app-css">
        .markdown-body { max-width: 900px; }
        @font-face { font-family: "KaTeX_Main"; src: url(file:///app/renderer/assets/KaTeX_Main.woff2) format("woff2"); }
        @font-face { font-family: "Other"; src: url(https://fonts.example/o.woff2); }
      </style>
      <style id="plugin-styles">.task-list-item { list-style: none; }</style>`;
    document.body.innerHTML = `
      <div id="markdown-content" class="markdown-body">
        <h1 data-source-lines="0-1" id="title">Title &amp; more</h1>
        <p>See <a href="/repo/src/a.ts" class="file-ref" data-file-ref="src/a.ts" data-file-path="/repo/src/a.ts"><code>src/a.ts</code></a>.</p>
        <div class="code-block" data-lang="js" data-source-lines="3-6"><button class="code-copy-btn">x</button><pre class="hljs"><code>let a;</code></pre></div>
        <div class="change-gutter-deleted"></div>
        <img src="om-asset://local/docs/pic.png" alt="pic">
        <img src="om-asset://local/docs/missing.png" alt="gone">
        <img src="https://example.com/web.png" alt="web">
        <div class="mermaid-container" data-plugin-id="mermaid" data-mermaid-source="abc"><svg><text>diagram</text></svg></div>
        <script>alert(1)</script>
        <ul><li class="task-list-item"><input type="checkbox" class="task-list-checkbox"> task</li></ul>
      </div>`;
    content = document.getElementById('markdown-content')!;
    api = {
      savePdf: vi.fn(),
      saveHtml: vi.fn(),
      print: vi.fn(),
      inlineAssets: vi.fn((urls: string[]) => {
        const out: Record<string, string | null> = {};
        for (const url of urls) {
          out[url] = url.endsWith('pic.png')
            ? 'data:image/png;base64,PIC'
            : url.endsWith('KaTeX_Main.woff2')
              ? 'data:font/woff2;base64,FONT'
              : null;
        }
        return Promise.resolve(out);
      }),
    };
    service = new DocumentExportService(api);
  });

  function build(overrides: Partial<Parameters<DocumentExportService['buildStandaloneHtml']>[0]> = {}) {
    return service.buildStandaloneHtml({
      contentElement: content,
      title: 'plan.md',
      theme: 'light',
      currentTheme: 'light',
      pluginManager,
      pluginDeclarations: {},
      preferences: null,
      ...overrides,
    });
  }

  it('is a complete page with the title, theme and a no-script policy', async () => {
    const { html } = await build();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en" data-theme="light">');
    expect(html).toContain('<title>plan.md</title>');
    expect(html).toMatch(/Content-Security-Policy" content="default-src 'none'/);
    expect(html).toContain('<article class="markdown-body">');
    expect(html).toContain('Title &amp; more');
  });

  it('draws in the asked-for theme and keeps the document untouched', async () => {
    const { html } = await build({ theme: 'dark' });
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('--bg: #0d1117');
    expect(content.querySelector('.code-copy-btn')).not.toBeNull();
    expect(content.querySelector('a.file-ref')).not.toBeNull();
  });

  it('strips the app chrome, scripts and internal attributes', async () => {
    const { html } = await build();
    expect(html).not.toContain('code-copy-btn');
    expect(html).not.toContain('change-gutter');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('data-source-lines');
    expect(html).not.toContain('data-mermaid-source');
    expect(html).not.toContain('data-file-ref');
  });

  it('turns file references into plain text', async () => {
    const { html } = await build();
    expect(html).not.toContain('file-ref');
    expect(html).toContain('<span><code>src/a.ts</code></span>');
  });

  it('inlines local images and counts the ones it could not', async () => {
    const { html, skippedImages } = await build();
    expect(html).toContain('src="data:image/png;base64,PIC"');
    expect(html).toContain('src="om-asset://local/docs/missing.png"');
    expect(html).toContain('src="https://example.com/web.png"');
    expect(skippedImages).toBe(1);
    expect(api.inlineAssets).toHaveBeenCalledWith([
      'om-asset://local/docs/pic.png',
      'om-asset://local/docs/missing.png',
    ]);
  });

  it('keeps diagrams as their SVG', async () => {
    const { html } = await build();
    expect(html).toContain('<svg><text>diagram</text></svg>');
  });

  it('inlines the app stylesheet and plugin styles, generating the theme variables afresh', async () => {
    const { html } = await build();
    expect(html).toMatch(/\.markdown-body \{ ?max-width: 900px; ?\}/);
    expect(html).toContain('.task-list-item');
    expect(html).toContain(':root {');
    expect(html).not.toContain('--bg-color: #000;');
    expect(html).toContain('@media print');
  });

  it('leaves KaTeX fonts out when there is no math and inlines them when there is', async () => {
    const without = await build();
    expect(without.html).not.toContain('KaTeX_Main');

    content.insertAdjacentHTML('beforeend', '<span class="math-inline"><span class="katex">x</span></span>');
    const withMath = await build();
    expect(withMath.html).toContain('data:font/woff2;base64,FONT');
    expect(withMath.html).not.toContain('file:///app/renderer/assets/KaTeX_Main.woff2');
  });

  it('never references scripts or stylesheets on the network', async () => {
    content.insertAdjacentHTML('beforeend', '<span class="katex">x</span>');
    const { html } = await build();
    expect(html).not.toMatch(/<script[^>]*src=/);
    expect(html).not.toMatch(/<link[^>]*href="https?:/);
    // The one web font the app stylesheet names is dropped, not fetched
    expect(html).not.toContain('fonts.example');
  });

  it('survives a failing asset lookup', async () => {
    (api.inlineAssets as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'));
    const { html, skippedImages } = await build();
    expect(html).toContain('<article');
    expect(skippedImages).toBe(2);
  });
});

describe('DocumentExportService.exportFileName', () => {
  it('swaps the extension of the document name', () => {
    expect(DocumentExportService.exportFileName('/docs/my plan.md', 'pdf')).toBe('my plan.pdf');
    expect(DocumentExportService.exportFileName('C:\\docs\\notes.markdown', 'html')).toBe('notes.html');
    expect(DocumentExportService.exportFileName(null, 'pdf')).toBe('document.pdf');
  });
});
