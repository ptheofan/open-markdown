/**
 * MarkdownRenderer unit tests
 */
import {
  MarkdownRenderer,
  createMarkdownRenderer,
} from '@plugins/core/MarkdownRenderer';
import { PluginInitError } from '@shared/errors';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { MarkdownPlugin, PluginMetadata } from '@shared/types';
import type MarkdownIt from 'markdown-it';

// Mock plugin for testing
function createMockPlugin(
  id: string,
  options?: {
    applyFn?: (md: MarkdownIt) => void;
    initializeFn?: () => Promise<void> | void;
    destroyFn?: () => Promise<void> | void;
    postRenderFn?: (container: HTMLElement) => Promise<void> | void;
    stylesFn?: () => string | string[];
  }
): MarkdownPlugin {
  const metadata: PluginMetadata = {
    id,
    name: `Test Plugin ${id}`,
    version: '1.0.0',
    description: `Test plugin ${id}`,
  };

  const plugin: MarkdownPlugin = {
    metadata,
    apply: options?.applyFn || vi.fn(),
  };

  if (options?.initializeFn) {
    plugin.initialize = options.initializeFn;
  }
  if (options?.destroyFn) {
    plugin.destroy = options.destroyFn;
  }
  if (options?.postRenderFn) {
    plugin.postRender = options.postRenderFn;
  }
  if (options?.stylesFn) {
    plugin.getStyles = options.stylesFn;
  }

  return plugin;
}

describe('MarkdownRenderer', () => {
  let renderer: MarkdownRenderer;

  beforeEach(() => {
    renderer = new MarkdownRenderer();
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const r = new MarkdownRenderer();
      expect(r).toBeInstanceOf(MarkdownRenderer);
      expect(r.pluginCount).toBe(0);
    });

    it('should create instance with custom options', () => {
      const r = new MarkdownRenderer({
        html: false,
        linkify: false,
        typographer: false,
        breaks: true,
      });
      expect(r).toBeInstanceOf(MarkdownRenderer);
    });
  });

  describe('createMarkdownRenderer', () => {
    it('should create a new MarkdownRenderer instance', () => {
      const r = createMarkdownRenderer();
      expect(r).toBeInstanceOf(MarkdownRenderer);
    });

    it('should pass options to the constructor', () => {
      const r = createMarkdownRenderer({ html: false });
      expect(r).toBeInstanceOf(MarkdownRenderer);
    });
  });

  describe('render', () => {
    it('should render markdown to HTML', () => {
      const result = renderer.render('# Hello World');
      expect(result).toContain('<h1');
      expect(result).toContain('Hello World</h1>');
    });

    it('should render paragraphs', () => {
      const result = renderer.render('This is a paragraph.');
      expect(result).toContain('<p');
      expect(result).toContain('This is a paragraph.</p>');
    });

    it('should render bold text', () => {
      const result = renderer.render('**bold**');
      expect(result).toContain('<strong>bold</strong>');
    });

    it('should render italic text', () => {
      const result = renderer.render('*italic*');
      expect(result).toContain('<em>italic</em>');
    });

    it('should render links', () => {
      const result = renderer.render('[link](https://example.com)');
      expect(result).toContain('<a href="https://example.com">link</a>');
    });

    it('should render code blocks', () => {
      const result = renderer.render('```\ncode\n```');
      expect(result).toContain('<code>');
      expect(result).toContain('code');
    });

    it('should render lists', () => {
      const result = renderer.render('- item 1\n- item 2');
      expect(result).toContain('<ul');
      expect(result).toContain('item 1</li>');
      expect(result).toContain('item 2</li>');
    });

    it('should render blockquotes', () => {
      const result = renderer.render('> quote');
      expect(result).toContain('<blockquote');
      expect(result).toContain('quote');
    });

    it('should handle empty input', () => {
      const result = renderer.render('');
      expect(result).toBe('');
    });
  });

  describe('renderInline', () => {
    it('should render inline markdown without paragraph wrapper', () => {
      const result = renderer.renderInline('**bold** and *italic*');
      expect(result).toContain('<strong>bold</strong>');
      expect(result).toContain('<em>italic</em>');
      expect(result).not.toContain('<p>');
    });

    it('should handle empty input', () => {
      const result = renderer.renderInline('');
      expect(result).toBe('');
    });
  });

  describe('registerPlugin', () => {
    it('should register a plugin', async () => {
      const plugin = createMockPlugin('test-plugin');
      await renderer.registerPlugin(plugin);
      expect(renderer.hasPlugin('test-plugin')).toBe(true);
      expect(renderer.pluginCount).toBe(1);
    });

    it('should call plugin apply method', async () => {
      const applyFn = vi.fn();
      const plugin = createMockPlugin('test-plugin', { applyFn });
      await renderer.registerPlugin(plugin);
      expect(applyFn).toHaveBeenCalled();
    });

    it('should call plugin initialize method if present', async () => {
      const initializeFn = vi.fn();
      const plugin = createMockPlugin('test-plugin', { initializeFn });
      await renderer.registerPlugin(plugin);
      expect(initializeFn).toHaveBeenCalled();
    });

    it('should throw PluginInitError for duplicate registration', async () => {
      const plugin = createMockPlugin('test-plugin');
      await renderer.registerPlugin(plugin);
      await expect(renderer.registerPlugin(plugin)).rejects.toThrow(
        PluginInitError
      );
    });

    it('should throw PluginInitError if initialization fails', async () => {
      const plugin = createMockPlugin('test-plugin', {
        initializeFn: () => {
          throw new Error('Init failed');
        },
      });
      await expect(renderer.registerPlugin(plugin)).rejects.toThrow(
        PluginInitError
      );
    });

    it('should throw PluginInitError if apply fails', async () => {
      const plugin = createMockPlugin('test-plugin', {
        applyFn: () => {
          throw new Error('Apply failed');
        },
      });
      await expect(renderer.registerPlugin(plugin)).rejects.toThrow(
        PluginInitError
      );
    });

    it('should handle async initialize', async () => {
      const initializeFn = vi.fn().mockResolvedValue(undefined);
      const plugin = createMockPlugin('test-plugin', { initializeFn });
      await renderer.registerPlugin(plugin);
      expect(initializeFn).toHaveBeenCalled();
    });
  });

  describe('unregisterPlugin', () => {
    it('should unregister a plugin', async () => {
      const plugin = createMockPlugin('test-plugin');
      await renderer.registerPlugin(plugin);
      expect(renderer.hasPlugin('test-plugin')).toBe(true);
      await renderer.unregisterPlugin('test-plugin');
      expect(renderer.hasPlugin('test-plugin')).toBe(false);
    });

    it('should call plugin destroy method if present', async () => {
      const destroyFn = vi.fn();
      const plugin = createMockPlugin('test-plugin', { destroyFn });
      await renderer.registerPlugin(plugin);
      await renderer.unregisterPlugin('test-plugin');
      expect(destroyFn).toHaveBeenCalled();
    });

    it('should not throw for non-existent plugin', async () => {
      await expect(
        renderer.unregisterPlugin('non-existent')
      ).resolves.not.toThrow();
    });

    it('should still unregister even if destroy throws', async () => {
      const destroyFn = vi.fn().mockRejectedValue(new Error('Destroy failed'));
      const plugin = createMockPlugin('test-plugin', { destroyFn });
      await renderer.registerPlugin(plugin);
      // The error propagates but plugin is still deleted in finally block
      await expect(renderer.unregisterPlugin('test-plugin')).rejects.toThrow('Destroy failed');
      // Plugin should still be removed due to finally block
      expect(renderer.hasPlugin('test-plugin')).toBe(false);
    });
  });

  describe('postRender', () => {
    it('should call postRender on all registered plugins', async () => {
      const postRenderFn1 = vi.fn();
      const postRenderFn2 = vi.fn();
      const plugin1 = createMockPlugin('plugin-1', { postRenderFn: postRenderFn1 });
      const plugin2 = createMockPlugin('plugin-2', { postRenderFn: postRenderFn2 });

      await renderer.registerPlugin(plugin1);
      await renderer.registerPlugin(plugin2);

      // Mock HTMLElement for Node.js environment
      const mockContainer = {} as HTMLElement;
      await renderer.postRender(mockContainer);

      expect(postRenderFn1).toHaveBeenCalledWith(mockContainer);
      expect(postRenderFn2).toHaveBeenCalledWith(mockContainer);
    });

    it('should continue with other plugins if one throws', async () => {
      const postRenderFn1 = vi.fn().mockRejectedValue(new Error('Error'));
      const postRenderFn2 = vi.fn();
      const plugin1 = createMockPlugin('plugin-1', { postRenderFn: postRenderFn1 });
      const plugin2 = createMockPlugin('plugin-2', { postRenderFn: postRenderFn2 });

      await renderer.registerPlugin(plugin1);
      await renderer.registerPlugin(plugin2);

      // Mock HTMLElement for Node.js environment
      const mockContainer = {} as HTMLElement;
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      await renderer.postRender(mockContainer);
      consoleError.mockRestore();

      expect(postRenderFn2).toHaveBeenCalledWith(mockContainer);
    });
  });

  describe('getPluginStyles', () => {
    it('should return empty array when no plugins', () => {
      const styles = renderer.getPluginStyles();
      expect(styles).toEqual([]);
    });

    it('should return styles from plugins', async () => {
      const plugin = createMockPlugin('test-plugin', {
        stylesFn: () => '.test { color: red; }',
      });
      await renderer.registerPlugin(plugin);
      const styles = renderer.getPluginStyles();
      expect(styles).toContain('.test { color: red; }');
    });

    it('should handle plugins returning array of styles', async () => {
      const plugin = createMockPlugin('test-plugin', {
        stylesFn: () => ['.test1 {}', '.test2 {}'],
      });
      await renderer.registerPlugin(plugin);
      const styles = renderer.getPluginStyles();
      expect(styles).toContain('.test1 {}');
      expect(styles).toContain('.test2 {}');
    });

    it('should aggregate styles from multiple plugins', async () => {
      const plugin1 = createMockPlugin('plugin-1', {
        stylesFn: () => '.plugin1 {}',
      });
      const plugin2 = createMockPlugin('plugin-2', {
        stylesFn: () => '.plugin2 {}',
      });
      await renderer.registerPlugin(plugin1);
      await renderer.registerPlugin(plugin2);
      const styles = renderer.getPluginStyles();
      expect(styles).toHaveLength(2);
      expect(styles).toContain('.plugin1 {}');
      expect(styles).toContain('.plugin2 {}');
    });
  });

  describe('getRegisteredPlugins', () => {
    it('should return empty array when no plugins', () => {
      const plugins = renderer.getRegisteredPlugins();
      expect(plugins).toEqual([]);
    });

    it('should return metadata for registered plugins', async () => {
      const plugin1 = createMockPlugin('plugin-1');
      const plugin2 = createMockPlugin('plugin-2');
      await renderer.registerPlugin(plugin1);
      await renderer.registerPlugin(plugin2);

      const plugins = renderer.getRegisteredPlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins.map((p) => p.id)).toContain('plugin-1');
      expect(plugins.map((p) => p.id)).toContain('plugin-2');
    });
  });

  describe('hasPlugin', () => {
    it('should return false for non-existent plugin', () => {
      expect(renderer.hasPlugin('non-existent')).toBe(false);
    });

    it('should return true for registered plugin', async () => {
      const plugin = createMockPlugin('test-plugin');
      await renderer.registerPlugin(plugin);
      expect(renderer.hasPlugin('test-plugin')).toBe(true);
    });
  });

  describe('getMarkdownIt', () => {
    it('should return the underlying markdown-it instance', () => {
      const md = renderer.getMarkdownIt();
      expect(md).toBeDefined();
      expect(typeof md.render).toBe('function');
    });
  });

  describe('pluginCount', () => {
    it('should return 0 when no plugins', () => {
      expect(renderer.pluginCount).toBe(0);
    });

    it('should return correct count after adding plugins', async () => {
      await renderer.registerPlugin(createMockPlugin('plugin-1'));
      expect(renderer.pluginCount).toBe(1);
      await renderer.registerPlugin(createMockPlugin('plugin-2'));
      expect(renderer.pluginCount).toBe(2);
    });

    it('should return correct count after removing plugins', async () => {
      await renderer.registerPlugin(createMockPlugin('plugin-1'));
      await renderer.registerPlugin(createMockPlugin('plugin-2'));
      await renderer.unregisterPlugin('plugin-1');
      expect(renderer.pluginCount).toBe(1);
    });
  });
});
