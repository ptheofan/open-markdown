/**
 * UpdateService: when it checks, what it announces, and what it leaves alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UpdateService,
  compareVersions,
  newestEligible,
  INITIAL_CHECK_DELAY_MS,
  MIN_CHECK_INTERVAL_MS,
  type UpdaterLike,
  type UpdateServiceDeps,
  type GitHubRelease,
} from '@main/services/UpdateService';
import type { UpdateStatus } from '@shared/types/updates';

function fakeUpdater(): UpdaterLike & { emit: (event: string, ...args: unknown[]) => void; feed: string | null } {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    feed: null,
    setFeedURL(options) {
      this.feed = options.url;
    },
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return this;
    },
    emit(event, ...args) {
      for (const l of listeners.get(event) ?? []) l(...args);
    },
  };
}

const RELEASES: GitHubRelease[] = [
  { tag_name: 'v1.6.0', html_url: 'https://gh/v1.6.0', body: '# 1.6.0\n\n- things', prerelease: false },
  { tag_name: 'v1.7.0-beta.1', html_url: 'https://gh/v1.7.0-beta.1', body: 'beta', prerelease: true },
  { tag_name: 'v1.5.0', html_url: 'https://gh/v1.5.0', prerelease: false },
  { tag_name: 'v2.0.0', html_url: 'https://gh/v2.0.0', draft: true },
];

describe('compareVersions', () => {
  it('orders numerically and puts pre-releases below their release', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.6.0', '1.6.0')).toBe(0);
    expect(compareVersions('1.6.0-beta.1', '1.6.0')).toBeLessThan(0);
    expect(compareVersions('1.6.0-beta.2', '1.6.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('1.6', '1.6.0')).toBe(0);
  });
});

describe('newestEligible', () => {
  it('skips drafts, pre-releases on stable, and anything not newer', () => {
    expect(newestEligible(RELEASES, '1.5.0', 'stable')?.tag_name).toBe('v1.6.0');
    expect(newestEligible(RELEASES, '1.5.0', 'beta')?.tag_name).toBe('v1.7.0-beta.1');
    expect(newestEligible(RELEASES, '1.6.0', 'stable')).toBeNull();
    expect(newestEligible(RELEASES, '1.6.0', 'beta')?.tag_name).toBe('v1.7.0-beta.1');
  });
});

describe('UpdateService', () => {
  let statuses: UpdateStatus[];
  let fetchJson: ReturnType<typeof vi.fn>;
  let prefs: { automatic: boolean; channel: 'stable' | 'beta' };
  let clock: number;
  let timeouts: Array<{ fn: () => void; ms: number }>;
  let intervals: Array<{ fn: () => void; ms: number }>;

  beforeEach(() => {
    statuses = [];
    fetchJson = vi.fn().mockResolvedValue(RELEASES);
    prefs = { automatic: true, channel: 'stable' };
    clock = 1_000_000_000_000;
    timeouts = [];
    intervals = [];
  });

  function deps(overrides: Partial<UpdateServiceDeps> = {}): UpdateServiceDeps {
    return {
      platform: 'darwin',
      arch: 'arm64',
      isPackaged: true,
      isMas: false,
      currentVersion: '1.5.0',
      repo: 'ptheofan/open-markdown',
      autoUpdater: null,
      fetchJson,
      getPreferences: () => prefs,
      onStatus: (s) => statuses.push(s),
      now: () => clock,
      setTimeout: ((fn: () => void, ms: number) => {
        timeouts.push({ fn, ms });
        return 0;
      }) as unknown as typeof setTimeout,
      setInterval: ((fn: () => void, ms: number) => {
        intervals.push({ fn, ms });
        return 0;
      }) as unknown as typeof setInterval,
      ...overrides,
    };
  }

  it('is unsupported in a development build and in the Mac App Store build', async () => {
    for (const d of [deps({ isPackaged: false }), deps({ isMas: true })]) {
      const service = new UpdateService(d);
      expect(service.getStatus().state).toBe('unsupported');
      service.start();
      expect(timeouts).toHaveLength(0);
      expect((await service.check({ force: true })).state).toBe('unsupported');
      expect(fetchJson).not.toHaveBeenCalled();
    }
  });

  it('on macOS points Squirrel at update.electronjs.org and reports its events', async () => {
    const updater = fakeUpdater();
    const service = new UpdateService(deps({ autoUpdater: updater }));
    service.start();
    expect(updater.feed).toBe('https://update.electronjs.org/ptheofan/open-markdown/darwin-arm64/1.5.0');

    await service.check({ force: true });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(service.getStatus().state).toBe('checking');

    updater.emit('update-available');
    expect(service.getStatus().state).toBe('downloading');
    updater.emit('update-downloaded', {}, 'v1.6.0', 'notes here', new Date(), 'https://x');
    expect(service.getStatus()).toMatchObject({ state: 'downloaded', latestVersion: '1.6.0' });
    expect(await service.getReleaseNotes()).toBe('notes here');

    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalled();
  });

  it('reports up to date and errors from Squirrel', async () => {
    const updater = fakeUpdater();
    const service = new UpdateService(deps({ autoUpdater: updater }));
    service.start();
    await service.check({ force: true });
    updater.emit('update-not-available');
    expect(service.getStatus().state).toBe('up-to-date');
    expect(service.getStatus().checkedAt).not.toBeNull();

    clock += MIN_CHECK_INTERVAL_MS + 1;
    await service.check({ force: true });
    updater.emit('error', new Error('no network'));
    expect(service.getStatus()).toMatchObject({ state: 'error', error: 'no network' });
  });

  it('on Linux announces the newest release from GitHub without installing', async () => {
    const service = new UpdateService(deps({ platform: 'linux', arch: 'x64' }));
    service.start();
    const status = await service.check({ force: true });

    expect(fetchJson).toHaveBeenCalledWith('https://api.github.com/repos/ptheofan/open-markdown/releases?per_page=20');
    expect(status).toMatchObject({ state: 'available', latestVersion: '1.6.0', releaseUrl: 'https://gh/v1.6.0', prerelease: false });
    expect(await service.getReleaseNotes()).toContain('1.6.0');
    service.install();
    expect(statuses.at(-1)?.state).toBe('available');
  });

  it('on Linux says so when nothing is newer', async () => {
    const service = new UpdateService(deps({ platform: 'linux', currentVersion: '1.6.0' }));
    expect((await service.check({ force: true })).state).toBe('up-to-date');
  });

  it('announces pre-releases only on the beta channel, and never installs them', async () => {
    const updater = fakeUpdater();
    prefs.channel = 'beta';
    const service = new UpdateService(deps({ autoUpdater: updater, currentVersion: '1.6.0' }));
    service.start();
    const status = await service.check({ force: true });
    expect(updater.checkForUpdates).toHaveBeenCalled();
    expect(status).toMatchObject({ state: 'available', latestVersion: '1.7.0-beta.1', prerelease: true });

    // Squirrel then finds no stable update; the pre-release stays announced
    updater.emit('update-not-available');
    expect(service.getStatus().state).toBe('available');
    service.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('schedules a delayed first check and periodic ones that honour the preference and the hourly minimum', async () => {
    const service = new UpdateService(deps({ platform: 'linux' }));
    service.start();
    expect(timeouts[0]?.ms).toBe(INITIAL_CHECK_DELAY_MS);
    expect(intervals).toHaveLength(1);

    timeouts[0]!.fn();
    await Promise.resolve();
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(1));

    // Too soon: nothing happens
    intervals[0]!.fn();
    await Promise.resolve();
    expect(fetchJson).toHaveBeenCalledTimes(1);

    // Later, but turned off: nothing happens
    clock += MIN_CHECK_INTERVAL_MS + 1;
    prefs.automatic = false;
    intervals[0]!.fn();
    await Promise.resolve();
    expect(fetchJson).toHaveBeenCalledTimes(1);

    // Later and on: a check
    prefs.automatic = true;
    intervals[0]!.fn();
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
  });

  it('reports a failed GitHub lookup as an error', async () => {
    fetchJson.mockRejectedValue(new Error('offline'));
    const service = new UpdateService(deps({ platform: 'linux' }));
    expect(await service.check({ force: true })).toMatchObject({ state: 'error', error: 'offline' });
  });

  it('does not check again while a download is in progress', async () => {
    const updater = fakeUpdater();
    const service = new UpdateService(deps({ autoUpdater: updater }));
    service.start();
    await service.check({ force: true });
    updater.emit('update-available');
    await service.check({ force: true });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
