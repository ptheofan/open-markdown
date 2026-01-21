/**
 * PluginManager unit tests
 */
import { MarkdownRenderer } from '@plugins/core/MarkdownRenderer';
import {
  PluginManager,
  createPluginManager,
  type PluginFactory,
} from '@plugins/core/PluginManager';
import { PluginAlreadyRegisteredError } from '@shared/errors';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { MarkdownPlugin, PluginMetadata, PluginOptions } from '@shared/types';
import type MarkdownIt from 'markdown-it';

// Mock plugin factory for testing
function createMockPluginFactory(
  id: string,
  options?: {
    applyFn?: (md: MarkdownIt) => void;
    initializeFn?: () => Promise<void> | void;
    destroyFn?: () => Promise<void> | void;
    throwOnInit?: boolean;
  }
): PluginFactory {
  return (_pluginOptions?: PluginOptions): MarkdownPlugin => {
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
    if (options?.throwOnInit) {
      plugin.initialize = () => {
        throw new Error('Init failed');
      };
    }

    return plugin;
  };
}

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const m = new PluginManager();
      expect(m).toBeInstanceOf(PluginManager);
      expect(m.getAvailablePlugins()).toEqual([]);
      expect(m.getEnabledPlugins()).toEqual([]);
    });

    it('should create instance with renderer options', () => {
      const m = new PluginManager({ html: false });
      expect(m).toBeInstanceOf(PluginManager);
    });
  });

  describe('createPluginManager', () => {
    it('should create a new PluginManager instance', () => {
      const m = createPluginManager();
      expect(m).toBeInstanceOf(PluginManager);
    });

    it('should pass renderer options to the constructor', () => {
      const m = createPluginManager({ html: false });
      expect(m).toBeInstanceOf(PluginManager);
    });
  });

  describe('registerPluginFactory', () => {
    it('should register a plugin factory', () => {
      const factory = createMockPluginFactory('test-plugin');
      manager.registerPluginFactory('test-plugin', factory);
      expect(manager.isPluginAvailable('test-plugin')).toBe(true);
    });

    it('should throw for duplicate registration', () => {
      const factory = createMockPluginFactory('test-plugin');
      manager.registerPluginFactory('test-plugin', factory);
      expect(() => {
        manager.registerPluginFactory('test-plugin', factory);
      }).toThrow(PluginAlreadyRegisteredError);
    });
  });

  describe('enablePlugin', () => {
    it('should enable a registered plugin', async () => {
      const factory = createMockPluginFactory('test-plugin');
      manager.registerPluginFactory('test-plugin', factory);
      const result = await manager.enablePlugin('test-plugin');
      expect(result.success).toBe(true);
      expect(result.pluginId).toBe('test-plugin');
      expect(manager.isPluginEnabled('test-plugin')).toBe(true);
    });

    it('should return success for already enabled plugin', async () => {
      const factory = createMockPluginFactory('test-plugin');
      manager.registerPluginFactory('test-plugin', factory);
      await manager.enablePlugin('test-plugin');
      const result = await manager.enablePlugin('test-plugin');
      expect(result.success).toBe(true);
    });

    it('should return error for non-existent plugin', async () => {
      const result = await manager.enablePlugin('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should pass options to plugin factory', async () => {
      const factoryFn = vi.fn((_options?: PluginOptions): MarkdownPlugin => ({
        metadata: { id: 'test', name: 'Test', version: '1.0.0', description: 'Test' },
        apply: vi.fn(),
      }));
      manager.registerPluginFactory('test-plugin', factoryFn);
      await manager.enablePlugin('test-plugin', { theme: 'dark' });
      expect(factoryFn).toHaveBeenCalledWith({ theme: 'dark' });
    });

    it('should return error if plugin initialization fails', async () => {
      const factory = createMockPluginFactory('test-plugin', { throwOnInit: true });
      manager.registerPluginFactory('test-plugin', factory);
      const result = await manager.enablePlugin('test-plugin');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('disablePlugin', () => {
    it('should disable an enabled plugin', async () => {
      const factory = createMockPluginFactory('test-plugin');
      manager.registerPluginFactory('test-plugin', factory);
      await manager.enablePlugin('test-plugin');
      await manager.disablePlugin('test-plugin');
      expect(manager.isPluginEnabled('test-plugin')).toBe(false);
    });

    it('should not throw for non-enabled plugin', async () => {
      await expect(manager.disablePlugin('non-existent')).resolves.not.toThrow();
    });
  });

  describe('enablePlugins', () => {
    it('should enable multiple plugins at once', async () => {
      manager.registerPluginFactory('plugin-1', createMockPluginFactory('plugin-1'));
      manager.registerPluginFactory('plugin-2', createMockPluginFactory('plugin-2'));

      const results = await manager.enablePlugins(['plugin-1', 'plugin-2']);
      expect(results).toHaveLength(2);
      expect(results[0]?.success).toBe(true);
      expect(results[1]?.success).toBe(true);
      expect(manager.isPluginEnabled('plugin-1')).toBe(true);
      expect(manager.isPluginEnabled('plugin-2')).toBe(true);
    });

    it('should pass options to respective plugins', async () => {
      const factory1 = vi.fn((_options?: PluginOptions): MarkdownPlugin => ({
        metadata: { id: 'plugin-1', name: 'P1', version: '1.0.0', description: 'P1' },
        apply: vi.fn(),
      }));
      const factory2 = vi.fn((_options?: PluginOptions): MarkdownPlugin => ({
        metadata: { id: 'plugin-2', name: 'P2', version: '1.0.0', description: 'P2' },
        apply: vi.fn(),
      }));
      manager.registerPluginFactory('plugin-1', factory1);
      manager.registerPluginFactory('plugin-2', factory2);

      await manager.enablePlugins(['plugin-1', 'plugin-2'], {
        'plugin-1': { theme: 'light' },
        'plugin-2': { theme: 'dark' },
      });

      expect(factory1).toHaveBeenCalledWith({ theme: 'light' });
      expect(factory2).toHaveBeenCalledWith({ theme: 'dark' });
    });
  });

  describe('render', () => {
    it('should render markdown using the underlying renderer', () => {
      const result = manager.render('# Hello');
      expect(result).toContain('<h1>Hello</h1>');
    });

    it('should render with plugins applied', async () => {
      const applyFn = vi.fn((md: MarkdownIt) => {
        md.renderer.rules['custom'] = () => '<custom />';
      });
      manager.registerPluginFactory('test-plugin', createMockPluginFactory('test-plugin', { applyFn }));
      await manager.enablePlugin('test-plugin');
      // Plugin applied even though no custom tokens in input
      const result = manager.render('# Hello');
      expect(result).toContain('<h1>Hello</h1>');
      expect(applyFn).toHaveBeenCalled();
    });
  });

  describe('renderInline', () => {
    it('should render inline markdown', () => {
      const result = manager.renderInline('**bold**');
      expect(result).toContain('<strong>bold</strong>');
      expect(result).not.toContain('<p>');
    });
  });

  describe('postRender', () => {
    it('should call postRender on the renderer', async () => {
      const mockContainer = {} as HTMLElement;
      const postRenderFn = vi.fn();
      manager.registerPluginFactory('test-plugin', () => ({
        metadata: { id: 'test-plugin', name: 'Test', version: '1.0.0', description: 'Test' },
        apply: vi.fn(),
        postRender: postRenderFn,
      }));
      await manager.enablePlugin('test-plugin');
      await manager.postRender(mockContainer);
      expect(postRenderFn).toHaveBeenCalledWith(mockContainer);
    });
  });

  describe('getPluginStyles', () => {
    it('should return empty array when no plugins', () => {
      expect(manager.getPluginStyles()).toEqual([]);
    });

    it('should return styles from enabled plugins', async () => {
      manager.registerPluginFactory('test-plugin', () => ({
        metadata: { id: 'test-plugin', name: 'Test', version: '1.0.0', description: 'Test' },
        apply: vi.fn(),
        getStyles: () => '.test {}',
      }));
      await manager.enablePlugin('test-plugin');
      expect(manager.getPluginStyles()).toContain('.test {}');
    });
  });

  describe('getAvailablePlugins', () => {
    it('should return empty array when no plugins registered', () => {
      expect(manager.getAvailablePlugins()).toEqual([]);
    });

    it('should return list of registered plugin IDs', () => {
      manager.registerPluginFactory('plugin-1', createMockPluginFactory('plugin-1'));
      manager.registerPluginFactory('plugin-2', createMockPluginFactory('plugin-2'));
      const available = manager.getAvailablePlugins();
      expect(available).toContain('plugin-1');
      expect(available).toContain('plugin-2');
    });
  });

  describe('getEnabledPlugins', () => {
    it('should return empty array when no plugins enabled', () => {
      expect(manager.getEnabledPlugins()).toEqual([]);
    });

    it('should return list of enabled plugin IDs', async () => {
      manager.registerPluginFactory('plugin-1', createMockPluginFactory('plugin-1'));
      manager.registerPluginFactory('plugin-2', createMockPluginFactory('plugin-2'));
      await manager.enablePlugin('plugin-1');
      const enabled = manager.getEnabledPlugins();
      expect(enabled).toContain('plugin-1');
      expect(enabled).not.toContain('plugin-2');
    });
  });

  describe('getEnabledPluginMetadata', () => {
    it('should return metadata for enabled plugins', async () => {
      manager.registerPluginFactory('test-plugin', createMockPluginFactory('test-plugin'));
      await manager.enablePlugin('test-plugin');
      const metadata = manager.getEnabledPluginMetadata();
      expect(metadata).toHaveLength(1);
      expect(metadata[0]?.id).toBe('test-plugin');
    });
  });

  describe('isPluginEnabled', () => {
    it('should return false for non-enabled plugin', () => {
      expect(manager.isPluginEnabled('test')).toBe(false);
    });

    it('should return true for enabled plugin', async () => {
      manager.registerPluginFactory('test-plugin', createMockPluginFactory('test-plugin'));
      await manager.enablePlugin('test-plugin');
      expect(manager.isPluginEnabled('test-plugin')).toBe(true);
    });
  });

  describe('isPluginAvailable', () => {
    it('should return false for non-registered plugin', () => {
      expect(manager.isPluginAvailable('test')).toBe(false);
    });

    it('should return true for registered plugin', () => {
      manager.registerPluginFactory('test-plugin', createMockPluginFactory('test-plugin'));
      expect(manager.isPluginAvailable('test-plugin')).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', async () => {
      manager.registerPluginFactory('test-plugin', createMockPluginFactory('test-plugin'));
      await manager.enablePlugin('test-plugin', { theme: 'dark' });
      const config = manager.getConfig();
      expect(config.enabledPlugins).toContain('test-plugin');
      expect(config.pluginOptions['test-plugin']).toEqual({ theme: 'dark' });
    });

    it('should return empty config when no plugins enabled', () => {
      const config = manager.getConfig();
      expect(config.enabledPlugins).toEqual([]);
      expect(config.pluginOptions).toEqual({});
    });
  });

  describe('loadConfig', () => {
    it('should enable plugins from config', async () => {
      manager.registerPluginFactory('plugin-1', createMockPluginFactory('plugin-1'));
      manager.registerPluginFactory('plugin-2', createMockPluginFactory('plugin-2'));

      const results = await manager.loadConfig({
        enabledPlugins: ['plugin-1', 'plugin-2'],
        pluginOptions: {
          'plugin-1': { theme: 'light' },
        },
      });

      expect(results).toHaveLength(2);
      expect(results[0]?.success).toBe(true);
      expect(results[1]?.success).toBe(true);
      expect(manager.isPluginEnabled('plugin-1')).toBe(true);
      expect(manager.isPluginEnabled('plugin-2')).toBe(true);
    });

    it('should disable existing plugins before loading config', async () => {
      manager.registerPluginFactory('plugin-1', createMockPluginFactory('plugin-1'));
      manager.registerPluginFactory('plugin-2', createMockPluginFactory('plugin-2'));

      await manager.enablePlugin('plugin-1');
      expect(manager.isPluginEnabled('plugin-1')).toBe(true);

      await manager.loadConfig({
        enabledPlugins: ['plugin-2'],
        pluginOptions: {},
      });

      expect(manager.isPluginEnabled('plugin-1')).toBe(false);
      expect(manager.isPluginEnabled('plugin-2')).toBe(true);
    });
  });

  describe('getRenderer', () => {
    it('should return the underlying MarkdownRenderer', () => {
      const renderer = manager.getRenderer();
      expect(renderer).toBeInstanceOf(MarkdownRenderer);
    });
  });
});
