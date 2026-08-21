// @vitest-environment jsdom
/**
 * MermaidPlugin unit tests
 */
import {
  MermaidPlugin,
  createMermaidPlugin,
} from '@plugins/builtin/MermaidPlugin';
import { MarkdownRenderer } from '@plugins/core/MarkdownRenderer';
import { BUILTIN_PLUGINS } from '@shared/constants';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MarkdownSlice } from '@renderer/services/MarkdownSlicer';

// Mock mermaid module
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>Mock SVG</svg>' }),
  },
}));

describe('MermaidPlugin', () => {
  function slice(partial: Partial<MarkdownSlice>): MarkdownSlice {
    return {
      index: 0,
      type: 'code',
      raw: '',
      startLine: 0,
      endLine: 0,
      ...partial,
    };
  }

  let plugin: MermaidPlugin;
  let renderer: MarkdownRenderer;

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin = new MermaidPlugin();
    renderer = new MarkdownRenderer();
    // Initialize plugin (loads mermaid)
    await plugin.initialize();
    await renderer.registerPlugin(plugin);
  });

  describe('metadata', () => {
    it('should have correct plugin id', () => {
      expect(plugin.metadata.id).toBe(BUILTIN_PLUGINS.MERMAID);
    });

    it('should have name', () => {
      expect(plugin.metadata.name).toBe('Mermaid Diagrams');
    });

    it('should have version', () => {
      expect(plugin.metadata.version).toBe('1.0.0');
    });

    it('should have description', () => {
      expect(plugin.metadata.description).toContain('Mermaid');
    });
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const p = new MermaidPlugin();
      expect(p).toBeInstanceOf(MermaidPlugin);
    });

    it('should create instance with custom options', () => {
      const p = new MermaidPlugin({
        theme: 'dark',
        securityLevel: 'strict',
      });
      expect(p).toBeInstanceOf(MermaidPlugin);
    });
  });

  describe('createMermaidPlugin', () => {
    it('should create a new MermaidPlugin instance', () => {
      const p = createMermaidPlugin();
      expect(p).toBeInstanceOf(MermaidPlugin);
    });

    it('should pass options to the constructor', () => {
      const p = createMermaidPlugin({ theme: 'forest' });
      expect(p).toBeInstanceOf(MermaidPlugin);
    });
  });

  describe('initialize', () => {
    it('should initialize mermaid library', async () => {
      const mermaid = await import('mermaid');
      expect(mermaid.default.initialize).toHaveBeenCalled();
    });

    it('should configure mermaid with default options', async () => {
      const mermaid = await import('mermaid');
      expect(mermaid.default.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
        })
      );
    });

    it('should configure mermaid with custom theme', async () => {
      vi.clearAllMocks();
      const p = new MermaidPlugin({ theme: 'dark' });
      await p.initialize();
      const mermaid = await import('mermaid');
      expect(mermaid.default.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: 'dark',
        })
      );
    });
  });

  describe('mermaid code block rendering', () => {
    it('should render mermaid block as placeholder', () => {
      const markdown = '```mermaid\ngraph TD;\nA-->B;\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="mermaid-container"');
      expect(result).toContain('data-mermaid-id');
      expect(result).toContain('data-mermaid-code');
    });

    it('should include loading message in placeholder', () => {
      const markdown = '```mermaid\ngraph TD;\nA-->B;\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('mermaid-loading');
      expect(result).toContain('Loading diagram');
    });

    it('should handle uppercase MERMAID language tag', () => {
      const markdown = '```MERMAID\ngraph TD;\nA-->B;\n```';
      const result = renderer.render(markdown);
      expect(result).toContain('class="mermaid-container"');
    });

    it('should not affect other code blocks', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const result = renderer.render(markdown);
      expect(result).not.toContain('mermaid-container');
      expect(result).toContain('<code');
    });

    it('should encode mermaid code in data attribute', () => {
      const markdown = '```mermaid\ngraph TD;\nA-->B;\n```';
      const result = renderer.render(markdown);
      // Code should be encoded (base64 of URI-encoded string)
      expect(result).toMatch(/data-mermaid-code="[A-Za-z0-9+/=]+"/);
    });

    it('should generate unique IDs for multiple diagrams', () => {
      const markdown = '```mermaid\ngraph TD;\nA-->B;\n```\n\n```mermaid\nsequenceDiagram\nA->>B: Hello\n```';
      const result = renderer.render(markdown);
      const matches = result.match(/data-mermaid-id="mermaid-placeholder-\d+"/g);
      expect(matches).toHaveLength(2);
      expect(matches![0]).not.toBe(matches![1]);
    });
  });

  describe('postRender', () => {
    it('should render diagrams in DOM container', async () => {
      // Mock DOM elements
      const mockPlaceholder = {
        getAttribute: vi.fn((attr: string) => {
          if (attr === 'data-mermaid-id') return 'mermaid-1';
          if (attr === 'data-mermaid-code') return btoa(encodeURIComponent('graph TD;A-->B;'));
          return null;
        }),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        innerHTML: '',
        classList: {
          add: vi.fn(),
        },
      };

      const mockContainer = {
        querySelectorAll: vi.fn().mockReturnValue([mockPlaceholder]),
      } as unknown as HTMLElement;

      await plugin.postRender(mockContainer);

      expect(mockPlaceholder.innerHTML).toContain('Mock SVG');
      expect(mockPlaceholder.classList.add).toHaveBeenCalledWith('mermaid-rendered');
      expect(mockPlaceholder.removeAttribute).toHaveBeenCalledWith('data-mermaid-code');
    });

    it('should handle render errors gracefully', async () => {
      const mermaid = await import('mermaid');
      vi.mocked(mermaid.default.render).mockRejectedValueOnce(new Error('Invalid syntax'));

      const mockPlaceholder = {
        getAttribute: vi.fn((attr: string) => {
          if (attr === 'data-mermaid-id') return 'mermaid-1';
          if (attr === 'data-mermaid-code') return btoa(encodeURIComponent('invalid'));
          return null;
        }),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        innerHTML: '',
        classList: {
          add: vi.fn(),
        },
      };

      const mockContainer = {
        querySelectorAll: vi.fn().mockReturnValue([mockPlaceholder]),
      } as unknown as HTMLElement;

      await plugin.postRender(mockContainer);

      expect(mockPlaceholder.innerHTML).toContain('Mermaid Error');
      expect(mockPlaceholder.innerHTML).toContain('Invalid syntax');
      expect(mockPlaceholder.classList.add).toHaveBeenCalledWith('mermaid-error-container');
    });

    it('should skip placeholders without code', async () => {
      const mockPlaceholder = {
        getAttribute: vi.fn().mockReturnValue(null),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        innerHTML: '',
        classList: {
          add: vi.fn(),
        },
      };

      const mockContainer = {
        querySelectorAll: vi.fn().mockReturnValue([mockPlaceholder]),
      } as unknown as HTMLElement;

      await plugin.postRender(mockContainer);

      expect(mockPlaceholder.innerHTML).toBe('');
    });

    it('should handle empty container', async () => {
      const mockContainer = {
        querySelectorAll: vi.fn().mockReturnValue([]),
      } as unknown as HTMLElement;

      await expect(plugin.postRender(mockContainer)).resolves.not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should reset diagram counter', () => {
      // Render some diagrams to increment counter
      renderer.render('```mermaid\ngraph TD;\nA-->B;\n```');
      renderer.render('```mermaid\nsequenceDiagram\nA->>B: Hi\n```');

      plugin.destroy();

      // Counter should be reset
      const result = renderer.render('```mermaid\ngraph LR;\nX-->Y;\n```');
      expect(result).toContain('mermaid-placeholder-0');
    });
  });

  describe('getStyles', () => {
    it('should return CSS styles', () => {
      const styles = plugin.getStyles();
      expect(typeof styles).toBe('string');
      expect(styles.length).toBeGreaterThan(0);
    });

    it('should include container styles', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain('.mermaid-container');
    });

    it('should include loading styles', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain('.mermaid-loading');
    });

    it('should include error styles', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain('.mermaid-error');
    });
  });

  describe('integration with MarkdownRenderer', () => {
    it('should be registerable with MarkdownRenderer', async () => {
      const r = new MarkdownRenderer();
      const p = new MermaidPlugin();
      await p.initialize();
      await r.registerPlugin(p);
      expect(r.hasPlugin(BUILTIN_PLUGINS.MERMAID)).toBe(true);
    });

    it('should work alongside regular markdown', () => {
      const markdown = `
# Diagram

\`\`\`mermaid
graph TD;
A-->B;
\`\`\`

Some text below.
`;
      const result = renderer.render(markdown);
      expect(result).toContain('<h1');
      expect(result).toContain('Diagram</h1>');
      expect(result).toContain('mermaid-container');
      expect(result).toContain('Some text below');
    });
  });

  describe('matchesSlice', () => {
    it('returns true for a code slice with a ```mermaid opening fence', () => {
      expect(plugin.matchesSlice(slice({ raw: '```mermaid\nA --> B\n```' }))).toBe(true);
    });

    it('returns true when the mermaid fence has an info-string suffix', () => {
      expect(plugin.matchesSlice(slice({ raw: '```mermaid theme=dark\nA --> B\n```' }))).toBe(true);
    });

    it('returns false for a code slice in another language', () => {
      expect(plugin.matchesSlice(slice({ raw: '```js\nconsole.log(1);\n```' }))).toBe(false);
    });

    it('returns false for non-code slice types', () => {
      expect(plugin.matchesSlice(slice({ type: 'paragraph', raw: 'mermaid' }))).toBe(false);
    });

    it('returns false when the slice has no opening fence', () => {
      expect(plugin.matchesSlice(slice({ raw: 'graph TD\nA --> B' }))).toBe(false);
    });

    it('returns true for tilde-fenced mermaid blocks', () => {
      expect(plugin.matchesSlice(slice({ raw: '~~~mermaid\nA --> B\n~~~' }))).toBe(true);
    });
  });

  describe('extractSource', () => {
    it('strips opening ```mermaid fence and closing ``` fence', () => {
      const s = slice({ raw: '```mermaid\ngraph TD\nA --> B\n```' });
      expect(plugin.extractSource(s)).toBe('graph TD\nA --> B');
    });

    it('strips opening fence with info-string suffix', () => {
      const s = slice({ raw: '```mermaid theme=dark\ngraph TD\nA --> B\n```' });
      expect(plugin.extractSource(s)).toBe('graph TD\nA --> B');
    });

    it('strips tilde fences (opening and closing)', () => {
      const s = slice({ raw: '~~~mermaid\ngraph TD\nA --> B\n~~~' });
      expect(plugin.extractSource(s)).toBe('graph TD\nA --> B');
    });

    it('preserves blank lines and trailing whitespace inside the content', () => {
      const s = slice({ raw: '```mermaid\ngraph TD\n\n  A --> B\n```' });
      expect(plugin.extractSource(s)).toBe('graph TD\n\n  A --> B');
    });

    it('returns the raw unchanged when there are no fences', () => {
      const s = slice({ raw: 'graph TD\nA --> B' });
      expect(plugin.extractSource(s)).toBe('graph TD\nA --> B');
    });

    it('strips only the opening fence when the closing fence is missing', () => {
      const s = slice({ raw: '```mermaid\ngraph TD\nA --> B' });
      expect(plugin.extractSource(s)).toBe('graph TD\nA --> B');
    });
  });

  describe('applySourceToRaw', () => {
    it("re-wraps source with the slice's original opening info-string", () => {
      const s = slice({ raw: '```mermaid\nold\n```' });
      expect(plugin.applySourceToRaw(s, 'graph TD\nA --> B')).toBe(
        '```mermaid\ngraph TD\nA --> B\n```',
      );
    });

    it('preserves an info-string suffix on the opening fence', () => {
      const s = slice({ raw: '```mermaid theme=dark\nold\n```' });
      expect(plugin.applySourceToRaw(s, 'graph TD\nA --> B')).toBe(
        '```mermaid theme=dark\ngraph TD\nA --> B\n```',
      );
    });

    it('preserves tilde fences', () => {
      const s = slice({ raw: '~~~mermaid\nold\n~~~' });
      expect(plugin.applySourceToRaw(s, 'graph TD\nA --> B')).toBe(
        '~~~mermaid\ngraph TD\nA --> B\n~~~',
      );
    });

    it('falls back to ```mermaid when slice.raw has no recognisable opening fence', () => {
      const s = slice({ raw: 'no fence' });
      expect(plugin.applySourceToRaw(s, 'graph TD')).toBe('```mermaid\ngraph TD\n```');
    });
  });

  describe('renderPreview', () => {
    it('replaces target contents with rendered SVG on success', async () => {
      const target = document.createElement('div');
      target.textContent = 'placeholder';
      const result = await plugin.renderPreview('graph TD\nA --> B', target);
      expect(result).toEqual({ ok: true });
      expect(target.children.length).toBe(1);
      expect(target.children[0]!.tagName.toLowerCase()).toBe('svg');
      expect(target.textContent).toBe('Mock SVG');
    });

    it('leaves target untouched and returns the error on failure', async () => {
      const mermaid = (await import('mermaid')).default;
      vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('Parse error'));
      const target = document.createElement('div');
      target.textContent = 'previous good preview';
      const result = await plugin.renderPreview('bogus', target);
      expect(result).toEqual({ ok: false, error: 'Parse error' });
      expect(target.textContent).toBe('previous good preview');
    });

    it('returns an error when the mermaid library is not initialised', async () => {
      const uninit = new MermaidPlugin();
      const target = document.createElement('div');
      const result = await uninit.renderPreview('graph TD', target);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not initialised/i);
    });
  });
});

/**
 * mermaid.live decodes the `#pako:` fragment with pako.inflate. We compress
 * with the platform's CompressionStream instead of bundling pako, so the one
 * thing worth pinning is that the two agree on the format: 'deflate' is
 * zlib-wrapped and round-trips, 'deflate-raw' does not and throws there.
 *
 * pako stays a devDependency purely as the reference decoder for this test.
 */
describe('generateMermaidLiveUrl', () => {
  it('produces a fragment pako can inflate back to the original state', async () => {
    const plugin = new MermaidPlugin();
    const code = 'graph TD\n  A-->B';

    const url = await plugin.generateMermaidLiveUrl(code);

    expect(url.startsWith('https://mermaid.live/edit#pako:')).toBe(true);
    const base64 = url.slice('https://mermaid.live/edit#pako:'.length);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const { inflate } = await import('pako');
    const state = JSON.parse(inflate(bytes, { to: 'string' })) as {
      code: string;
    };
    expect(state.code).toBe(code);
  });

  it('interpolates the resolved url, not a pending promise, into the copied html', async () => {
    // generateMermaidLiveUrl is async; a missed await at this call site still
    // typechecks in a template literal and silently ships href="[object Promise]".
    const plugin = new MermaidPlugin();
    const code = 'graph TD\n  A-->B';
    const container = document.createElement('div');
    container.className = 'mermaid-container';
    container.setAttribute('data-mermaid-source', btoa(encodeURIComponent(code)));

    const data = await plugin.getContextMenuData(container, 'copy-mermaid-live');

    expect(data.content).toContain('href="https://mermaid.live/edit#pako:');
    expect(data.content).not.toContain('[object Promise]');
  });
});

describe('rendering a diagram for a document with a white page', () => {
  it('renders in the light theme and puts the app theme back afterwards', async () => {
    // The on-screen SVG carries whatever theme the app is in. A dark diagram
    // dropped into a Google Doc is unreadable, so the export re-renders the
    // source in mermaid's light theme -- and must not leave the app there.
    const mermaid = await import('mermaid');
    const plugin = new MermaidPlugin();
    await plugin.initialize();
    plugin.setTheme('dark');

    vi.mocked(mermaid.default.initialize).mockClear();
    const host = document.createElement('div');
    // The canvas conversion cannot run under jsdom; the theme handling is
    // what this covers, and it lives in a finally so it runs either way.
    await plugin.renderToPngForExport('graph TD; A-->B;', host).catch(() => undefined);

    const themes = vi.mocked(mermaid.default.initialize).mock.calls
      .map((call) => (call[0] as { theme?: string }).theme);
    expect(themes[0]).toBe('default');
    expect(themes.at(-1)).toBe('dark');
  });

  it('renders the source it was given, not whatever is on screen', async () => {
    const mermaid = await import('mermaid');
    const plugin = new MermaidPlugin();
    await plugin.initialize();

    vi.mocked(mermaid.default.render).mockClear();
    await plugin.renderToPngForExport('graph LR; X-->Y;', document.createElement('div'))
      .catch(() => undefined);

    expect(vi.mocked(mermaid.default.render).mock.calls[0]?.[1]).toBe('graph LR; X-->Y;');
  });
});
