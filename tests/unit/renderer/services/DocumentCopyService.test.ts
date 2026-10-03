/**
 * @vitest-environment jsdom
 *
 * Rich-text copies: what goes on the clipboard as HTML and as plain text,
 * and which part of the document each copy takes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentCopyService } from '@renderer/services/DocumentCopyService';
import { NoDocumentError } from '@shared/errors';
import type { PluginManager } from '@plugins/core/PluginManager';
import type { ClipboardAPI } from '@shared/types';

const MARKDOWN = '# Title\n\nHello **world**\n\n```js\nlet a = 1;\n```\n\n## Part\n\nBody\n\n## Other\n\nTail';

describe('DocumentCopyService rich text', () => {
  let content: HTMLElement;
  let clipboard: ClipboardAPI;
  let service: DocumentCopyService;
  const pluginManager = { getPlugin: () => null } as unknown as PluginManager;

  function options(): { contentElement: HTMLElement; scrollContainer: HTMLElement; pluginManager: PluginManager; zoomLevel: number } {
    return {
      contentElement: content,
      scrollContainer: content,
      pluginManager,
      zoomLevel: 1,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="markdown-content">
        <h1 data-source-lines="0-1" id="title">Title</h1>
        <p>Hello <strong>world</strong></p>
        <div class="code-block" data-lang="js">
          <button type="button" class="code-copy-btn" aria-label="Copy code"><svg></svg></button>
          <pre class="hljs"><code class="language-js">let a = 1;</code></pre>
        </div>
        <div class="change-gutter-deleted"></div>
        <h2 data-source-lines="8-9" id="part">Part</h2>
        <p>Body</p>
        <h2 data-source-lines="12-13" id="other">Other</h2>
        <p>Tail</p>
      </div>`;
    content = document.getElementById('markdown-content')!;
    clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
      writeHtml: vi.fn().mockResolvedValue(undefined),
      writeImage: vi.fn().mockResolvedValue(undefined),
      saveFile: vi.fn(),
    };
    service = new DocumentCopyService(clipboard);
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
  });

  function written(): { html: string; text: string | undefined } {
    const call = vi.mocked(clipboard.writeHtml).mock.calls[0];
    return { html: String(call?.[0]), text: call?.[1] };
  }

  describe('copyAsRichText', () => {
    it('copies the whole document with the markdown as plain text', async () => {
      const result = await service.copyAsRichText({ ...options(), markdown: MARKDOWN });

      expect(result).toEqual({ success: true, diagramCount: 0, scope: 'document' });
      const { html, text } = written();
      expect(html).toContain('Title');
      expect(html).toContain('Tail');
      expect(text).toBe(MARKDOWN);
    });

    it('inlines styles and strips the app\'s classes and data attributes', async () => {
      await service.copyAsRichText({ ...options(), markdown: MARKDOWN });
      const { html } = written();

      expect(html).toMatch(/<h1 [^>]*style="[^"]*font-weight: bold/);
      expect(html).not.toContain('class=');
      expect(html).not.toContain('data-source-lines');
      expect(html).not.toContain('data-lang');
    });

    it('leaves out the copy button and change markers', async () => {
      await service.copyAsRichText({ ...options(), markdown: MARKDOWN });
      const { html } = written();

      expect(html).not.toContain('<button');
      expect(html).not.toContain('Copy code');
      expect(html).not.toContain('change-gutter');
      expect(html).toContain('let a = 1;');
    });

    it('copies only the selection when there is one, with its text as plain text', async () => {
      const range = document.createRange();
      range.setStartBefore(content.querySelector('h2')!);
      range.setEndAfter(content.querySelectorAll('p')[1]!);
      vi.spyOn(window, 'getSelection').mockReturnValue({
        rangeCount: 1,
        isCollapsed: false,
        getRangeAt: () => range,
        toString: () => 'Part\nBody',
      } as unknown as Selection);

      const result = await service.copyAsRichText({ ...options(), markdown: MARKDOWN });

      expect(result.scope).toBe('selection');
      const { html, text } = written();
      expect(html).toContain('Part');
      expect(html).toContain('Body');
      expect(html).not.toContain('Title');
      expect(html).not.toContain('Tail');
      expect(text).toBe('Part\nBody');
    });

    it('ignores a collapsed selection and one outside the document', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue({
        rangeCount: 1,
        isCollapsed: true,
        getRangeAt: () => document.createRange(),
        toString: () => '',
      } as unknown as Selection);
      expect((await service.copyAsRichText({ ...options(), markdown: MARKDOWN })).scope).toBe('document');

      vi.mocked(clipboard.writeHtml).mockClear();
      const outside = document.createElement('p');
      outside.textContent = 'toolbar';
      document.body.appendChild(outside);
      const range = document.createRange();
      range.selectNodeContents(outside);
      vi.spyOn(window, 'getSelection').mockReturnValue({
        rangeCount: 1,
        isCollapsed: false,
        getRangeAt: () => range,
        toString: () => 'toolbar',
      } as unknown as Selection);
      expect((await service.copyAsRichText({ ...options(), markdown: MARKDOWN })).scope).toBe('document');
    });

    it('refuses an empty document', async () => {
      content.innerHTML = '';
      await expect(service.copyAsRichText({ ...options(), markdown: '' })).rejects.toBeInstanceOf(NoDocumentError);
    });
  });

  describe('copySectionAsRichText', () => {
    it('copies the heading and everything up to the next heading of its level', async () => {
      const h2 = content.querySelector('h2')!;
      const result = await service.copySectionAsRichText(h2, '## Part\n\nBody', options());

      expect(result.scope).toBe('section');
      const { html, text } = written();
      expect(html).toContain('Part');
      expect(html).toContain('Body');
      expect(html).not.toContain('Other');
      expect(html).not.toContain('Title');
      expect(text).toBe('## Part\n\nBody');
    });

    it('takes deeper headings into a section and stops at a shallower one', () => {
      content.innerHTML = '<h2>A</h2><p>a</p><h3>A.1</h3><p>a1</p><h1>Top</h1><p>t</p>';
      const nodes = service.sectionNodes(content.querySelector('h2')!);
      expect(nodes.map((n) => n.textContent)).toEqual(['A', 'a', 'A.1', 'a1']);
    });

    it('runs to the end for the last section', async () => {
      const last = content.querySelectorAll('h2')[1]!;
      await service.copySectionAsRichText(last, '## Other\n\nTail', options());
      const { html } = written();
      expect(html).toContain('Other');
      expect(html).toContain('Tail');
      expect(html).not.toContain('Body');
    });
  });

  describe('copyForGoogleDocs', () => {
    it('still writes HTML only, letting the service derive the plain text', async () => {
      await service.copyForGoogleDocs(options());
      const call = vi.mocked(clipboard.writeHtml).mock.calls[0]!;
      expect(call).toHaveLength(1);
      expect(String(call[0])).not.toContain('<button');
    });
  });
});
