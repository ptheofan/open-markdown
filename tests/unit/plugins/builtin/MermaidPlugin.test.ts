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

// Mock mermaid module
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>Mock SVG</svg>' }),
  },
}));

describe('MermaidPlugin', () => {
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
      expect(result).toContain('<h1>Diagram</h1>');
      expect(result).toContain('mermaid-container');
      expect(result).toContain('Some text below');
    });
  });
});
