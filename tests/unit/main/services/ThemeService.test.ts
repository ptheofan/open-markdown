/**
 * ThemeService unit tests
 *
 * ThemeService is now responsible only for OS-level system theme detection.
 * Theme mode preference storage is handled by PreferencesService.
 */
import {
  ThemeService,
  createThemeService,
  getThemeService,
  resetThemeService,
} from '@main/services/ThemeService';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron modules
vi.mock('electron', () => {
  return {
    nativeTheme: {
      shouldUseDarkColors: false,
      on: vi.fn(),
      off: vi.fn(),
    },
  };
});

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    resetThemeService();
    service = createThemeService();
  });

  afterEach(() => {
    resetThemeService();
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
      const instance1 = createThemeService();
      const instance2 = createThemeService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
