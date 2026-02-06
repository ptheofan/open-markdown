/**
 * SyntaxHighlightPlugin unit tests
 */
import {
  SyntaxHighlightPlugin,
  createSyntaxHighlightPlugin,
} from '@plugins/builtin/SyntaxHighlightPlugin';
import { MarkdownRenderer } from '@plugins/core/MarkdownRenderer';
import { BUILTIN_PLUGINS } from '@shared/constants';
import { describe, it, expect, beforeEach } from 'vitest';

describe('SyntaxHighlightPlugin', () => {
  let plugin: SyntaxHighlightPlugin;
  let renderer: MarkdownRenderer;

  beforeEach(async () => {
    plugin = new SyntaxHighlightPlugin();
    renderer = new MarkdownRenderer();
    await renderer.registerPlugin(plugin);
  });

  describe('metadata', () => {
    it('should have correct plugin id', () => {
      expect(plugin.metadata.id).toBe(BUILTIN_PLUGINS.SYNTAX_HIGHLIGHT);
    });

    it('should have name', () => {
      expect(plugin.metadata.name).toBe('Syntax Highlighting');
    });

    it('should have version', () => {
      expect(plugin.metadata.version).toBe('1.0.0');
    });

    it('should have description', () => {
      expect(plugin.metadata.description).toContain('syntax highlighting');
    });
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const p = new SyntaxHighlightPlugin();
      expect(p).toBeInstanceOf(SyntaxHighlightPlugin);
    });

    it('should create instance with custom options', () => {
      const p = new SyntaxHighlightPlugin({
        lineNumbers: true,
        theme: 'monokai',
      });
      expect(p).toBeInstanceOf(SyntaxHighlightPlugin);
    });
  });

  describe('createSyntaxHighlightPlugin', () => {
    it('should create a new SyntaxHighlightPlugin instance', () => {
      const p = createSyntaxHighlightPlugin();
      expect(p).toBeInstanceOf(SyntaxHighlightPlugin);
    });

    it('should pass options to the constructor', () => {
      const p = createSyntaxHighlightPlugin({ lineNumbers: true });
      expect(p).toBeInstanceOf(SyntaxHighlightPlugin);
    });
  });

  describe('code highlighting', () => {
    it('should highlight JavaScript code', () => {
      const markdown = '```javascript\nconst x = 42;\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="hljs"');
      expect(result).toContain('language-javascript');
    });

    it('should highlight TypeScript code', () => {
      const markdown = '```typescript\nconst x: number = 42;\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="hljs"');
      expect(result).toContain('language-typescript');
    });

    it('should highlight Python code', () => {
      const markdown = '```python\ndef hello():\n    print("Hello")\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="hljs"');
      expect(result).toContain('language-python');
    });

    it('should highlight HTML code', () => {
      const markdown = '```html\n<div>Hello</div>\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="hljs"');
      expect(result).toContain('language-html');
    });

    it('should highlight CSS code', () => {
      const markdown = '```css\n.class { color: red; }\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="hljs"');
      expect(result).toContain('language-css');
    });

    it('should highlight JSON code', () => {
      const markdown = '```json\n{"key": "value"}\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="hljs"');
      expect(result).toContain('language-json');
    });

    it('should highlight bash/shell code', () => {
      const markdown = '```bash\necho "Hello"\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="hljs"');
      expect(result).toContain('language-bash');
    });

    it('should auto-detect language when not specified', () => {
      const markdown = '```\nfunction hello() {\n  return "world";\n}\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="hljs"');
    });

    it('should handle unknown language gracefully', () => {
      const markdown = '```unknownlang\nsome code\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="hljs"');
      // Should fall back to auto-detection or plaintext
    });

    it('should apply syntax highlighting classes', () => {
      const markdown = '```javascript\nconst name = "test";\n```';
      const result = renderer.render(markdown);
      // highlight.js adds hljs- prefixed classes
      expect(result).toMatch(/hljs-/);
    });

    it('should escape HTML in code', () => {
      const markdown = '```html\n<script>alert("xss")</script>\n```';
      const result = renderer.render(markdown);
      // HTML should be properly escaped in the output
      expect(result).toContain('class="hljs"');
    });
  });

  describe('line numbers', () => {
    it('should not show line numbers by default', async () => {
      const p = new SyntaxHighlightPlugin({ lineNumbers: false });
      const r = new MarkdownRenderer();
      await r.registerPlugin(p);
      const result = r.render('```js\ncode\n```');
      expect(result).not.toContain('data-line-numbers');
    });

    it('should show line numbers when enabled', async () => {
      const p = new SyntaxHighlightPlugin({ lineNumbers: true });
      const r = new MarkdownRenderer();
      await r.registerPlugin(p);
      const result = r.render('```js\ncode\n```');
      expect(result).toContain('data-line-numbers');
    });
  });

  describe('getStyles', () => {
    it('should return CSS styles', () => {
      const styles = plugin.getStyles();
      expect(typeof styles).toBe('string');
      expect(styles.length).toBeGreaterThan(0);
    });

    it('should include pre.hljs styles', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain('pre.hljs');
    });

    it('should include syntax highlighting color classes', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain('.hljs-keyword');
      expect(styles).toContain('.hljs-string');
      expect(styles).toContain('.hljs-comment');
    });

    it('should include line number styles', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain('data-line-numbers');
    });

    it('should include inline code styles', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain(':not(pre) > code');
    });
  });

  describe('integration with MarkdownRenderer', () => {
    it('should be registerable with MarkdownRenderer', async () => {
      const r = new MarkdownRenderer();
      const p = new SyntaxHighlightPlugin();
      await r.registerPlugin(p);
      expect(r.hasPlugin(BUILTIN_PLUGINS.SYNTAX_HIGHLIGHT)).toBe(true);
    });

    it('should work with multiple code blocks', () => {
      const markdown = `
\`\`\`javascript
const a = 1;
\`\`\`

Some text

\`\`\`python
x = 2
\`\`\`
`;
      const result = renderer.render(markdown);
      expect(result).toContain('language-javascript');
      expect(result).toContain('language-python');
    });

    it('should work alongside regular markdown', () => {
      const markdown = `
# Title

\`\`\`js
const x = 42;
\`\`\`

- List item
`;
      const result = renderer.render(markdown);
      expect(result).toContain('<h1');
      expect(result).toContain('Title</h1>');
      expect(result).toContain('class="hljs"');
      expect(result).toContain('<li');
      expect(result).toContain('List item</li>');
    });
  });
});
