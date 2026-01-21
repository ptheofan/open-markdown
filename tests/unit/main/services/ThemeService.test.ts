/**
 * ThemeService unit tests
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  ThemeService,
  createThemeService,
  getThemeService,
  resetThemeService,
} from '@main/services/ThemeService';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use a platform-agnostic mock path
const MOCK_USER_DATA = path.join('mock', 'user', 'data');

// Mock Electron modules
vi.mock('electron', async () => {
  const pathModule = await import('path');
  return {
    nativeTheme: {
      shouldUseDarkColors: false,
      on: vi.fn(),
      off: vi.fn(),
    },
    app: {
      getPath: vi.fn(() => pathModule.join('mock', 'user', 'data')),
    },
  };
});

describe('ThemeService', () => {
  let tempDir: string;
  let service: ThemeService;

  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = path.join(os.tmpdir(), `theme-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Reset singleton
    resetThemeService();

    // Create fresh service for each test
    service = createThemeService(tempDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create service with custom preferences directory', () => {
      const customPath = path.join('custom', 'path');
      const customService = createThemeService(customPath);
      expect(customService.getPreferencesPath()).toBe(path.join(customPath, 'theme-preferences.json'));
    });

    it('should create service with default directory when not provided', () => {
      const defaultService = new ThemeService();
      expect(defaultService.getPreferencesPath()).toBe(path.join(MOCK_USER_DATA, 'theme-preferences.json'));
    });
  });

  describe('initialize', () => {
    it('should initialize with default theme when no preferences exist', async () => {
      await service.initialize();
      expect(service.getCurrentTheme()).toBe('system');
    });

    it('should load saved preferences on initialize', async () => {
      // Write preferences file
      const prefsPath = path.join(tempDir, 'theme-preferences.json');
      await fs.writeFile(prefsPath, JSON.stringify({ theme: 'dark' }));

      await service.initialize();
      expect(service.getCurrentTheme()).toBe('dark');
    });

    it('should handle corrupted preferences file gracefully', async () => {
      // Write invalid JSON
      const prefsPath = path.join(tempDir, 'theme-preferences.json');
      await fs.writeFile(prefsPath, 'invalid json {{{');

      await service.initialize();
      expect(service.getCurrentTheme()).toBe('system');
    });

    it('should handle invalid theme value in preferences', async () => {
      // Write preferences with invalid theme
      const prefsPath = path.join(tempDir, 'theme-preferences.json');
      await fs.writeFile(prefsPath, JSON.stringify({ theme: 'invalid' }));

      await service.initialize();
      expect(service.getCurrentTheme()).toBe('system');
    });

    it('should only initialize once', async () => {
      const prefsPath = path.join(tempDir, 'theme-preferences.json');
      await fs.writeFile(prefsPath, JSON.stringify({ theme: 'dark' }));

      await service.initialize();
      expect(service.getCurrentTheme()).toBe('dark');

      // Change file
      await fs.writeFile(prefsPath, JSON.stringify({ theme: 'light' }));

      // Initialize again - should not reload
      await service.initialize();
      expect(service.getCurrentTheme()).toBe('dark');
    });
  });

  describe('getCurrentTheme', () => {
    it('should return system as default', async () => {
      await service.initialize();
      expect(service.getCurrentTheme()).toBe('system');
    });

    it('should return the set theme after setTheme', async () => {
      await service.initialize();
      await service.setTheme('dark');
      expect(service.getCurrentTheme()).toBe('dark');
    });
  });

  describe('setTheme', () => {
    it('should save light theme', async () => {
      await service.initialize();
      await service.setTheme('light');

      expect(service.getCurrentTheme()).toBe('light');

      // Verify file was written
      const prefsPath = path.join(tempDir, 'theme-preferences.json');
      const content = await fs.readFile(prefsPath, 'utf-8');
      const prefs = JSON.parse(content);
      expect(prefs.theme).toBe('light');
    });

    it('should save dark theme', async () => {
      await service.initialize();
      await service.setTheme('dark');

      expect(service.getCurrentTheme()).toBe('dark');
    });

    it('should save system theme', async () => {
      await service.initialize();
      await service.setTheme('dark');
      await service.setTheme('system');

      expect(service.getCurrentTheme()).toBe('system');
    });

    it('should persist theme across service instances', async () => {
      await service.initialize();
      await service.setTheme('dark');

      // Create new service instance
      const service2 = createThemeService(tempDir);
      await service2.initialize();

      expect(service2.getCurrentTheme()).toBe('dark');
    });

    it('should create directory if it does not exist', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'deep', 'path');
      const nestedService = createThemeService(nestedDir);
      await nestedService.initialize();
      await nestedService.setTheme('dark');

      const prefsPath = path.join(nestedDir, 'theme-preferences.json');
      const content = await fs.readFile(prefsPath, 'utf-8');
      expect(JSON.parse(content).theme).toBe('dark');
    });
  });

  describe('getSystemTheme', () => {
    it('should return light when system uses light colors', async () => {
      const { nativeTheme } = await import('electron');
      (nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = false;

      expect(service.getSystemTheme()).toBe('light');
    });

    it('should return dark when system uses dark colors', async () => {
      const { nativeTheme } = await import('electron');
      (nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = true;

      expect(service.getSystemTheme()).toBe('dark');
    });
  });

  describe('onSystemThemeChange', () => {
    it('should subscribe to native theme changes', async () => {
      const { nativeTheme } = await import('electron');
      const callback = vi.fn();

      service.onSystemThemeChange(callback);

      expect(nativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function));
    });

    it('should return cleanup function that unsubscribes', async () => {
      const { nativeTheme } = await import('electron');
      const callback = vi.fn();

      const cleanup = service.onSystemThemeChange(callback);
      cleanup();

      expect(nativeTheme.off).toHaveBeenCalledWith('updated', expect.any(Function));
    });

    it('should call callback with current theme when native theme updates', async () => {
      const { nativeTheme } = await import('electron');
      const callback = vi.fn();
      let handler: (() => void) | undefined;

      // Capture the handler
      vi.mocked(nativeTheme.on).mockImplementation((_event: string, fn: () => void) => {
        handler = fn;
        return nativeTheme;
      });

      service.onSystemThemeChange(callback);

      // Simulate theme change to dark
      (nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = true;
      handler?.();

      expect(callback).toHaveBeenCalledWith('dark');
    });
  });

  describe('getPreferencesPath', () => {
    it('should return the preferences file path', () => {
      const expectedPath = path.join(tempDir, 'theme-preferences.json');
      expect(service.getPreferencesPath()).toBe(expectedPath);
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    resetThemeService();
  });

  afterEach(() => {
    resetThemeService();
  });

  describe('getThemeService', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getThemeService();
      const instance2 = getThemeService();

      expect(instance1).toBe(instance2);
    });

    it('should create a new instance with default path', () => {
      const instance = getThemeService();
      expect(instance.getPreferencesPath()).toBe(path.join(MOCK_USER_DATA, 'theme-preferences.json'));
    });
  });

  describe('resetThemeService', () => {
    it('should reset the singleton allowing new instance creation', () => {
      const instance1 = getThemeService();
      resetThemeService();
      const instance2 = getThemeService();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('createThemeService', () => {
    it('should create independent instances', () => {
      const path1 = path.join('path', '1');
      const path2 = path.join('path', '2');
      const instance1 = createThemeService(path1);
      const instance2 = createThemeService(path2);

      expect(instance1).not.toBe(instance2);
      expect(instance1.getPreferencesPath()).toBe(path.join(path1, 'theme-preferences.json'));
      expect(instance2.getPreferencesPath()).toBe(path.join(path2, 'theme-preferences.json'));
    });
  });
});
