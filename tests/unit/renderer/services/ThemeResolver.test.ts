import { describe, it, expect, vi } from 'vitest';
import { ThemeResolver } from '@renderer/services/ThemeResolver';
import type { ResolvedTheme } from '@shared/types';

/** A getSystem() whose reply the test releases by hand, like a slow IPC round trip. */
function deferredSystemTheme(): {
  getSystem: () => Promise<ResolvedTheme>;
  reply: (theme: ResolvedTheme) => void;
} {
  let release: (theme: ResolvedTheme) => void = () => undefined;
  const getSystem = vi.fn(
    () =>
      new Promise<ResolvedTheme>((resolve) => {
        release = resolve;
      })
  );
  return { getSystem, reply: (theme) => release(theme) };
}

describe('ThemeResolver', () => {
  it('returns explicit modes as they are, without asking the system', async () => {
    const getSystem = vi.fn(() => Promise.resolve<ResolvedTheme>('dark'));
    const resolver = new ThemeResolver(getSystem);

    await expect(resolver.resolve('light')).resolves.toBe('light');
    await expect(resolver.resolve('dark')).resolves.toBe('dark');
    expect(getSystem).not.toHaveBeenCalled();
  });

  it('resolves system mode through getSystem()', async () => {
    const resolver = new ThemeResolver(() => Promise.resolve('dark'));

    await expect(resolver.resolve('system')).resolves.toBe('dark');
  });

  it('falls back to light when getSystem() fails', async () => {
    const resolver = new ThemeResolver(() => Promise.reject(new Error('ipc down')));

    await expect(resolver.resolve('system')).resolves.toBe('light');
  });

  it('drops a system lookup that a later request overtook', async () => {
    // Toggle from system mode in dark: the preferences broadcast asks for 'system'
    // first, then the toggle asks for 'light' while the system lookup is in flight.
    const system = deferredSystemTheme();
    const resolver = new ThemeResolver(system.getSystem);

    const stale = resolver.resolve('system');
    const fresh = resolver.resolve('light');
    system.reply('dark');

    await expect(fresh).resolves.toBe('light');
    await expect(stale).resolves.toBeNull();
  });

  it('keeps the latest system lookup when an earlier explicit request is done', async () => {
    const system = deferredSystemTheme();
    const resolver = new ThemeResolver(system.getSystem);

    const explicit = resolver.resolve('light');
    const latest = resolver.resolve('system');
    system.reply('dark');

    await expect(explicit).resolves.toBe('light');
    await expect(latest).resolves.toBe('dark');
  });
});
