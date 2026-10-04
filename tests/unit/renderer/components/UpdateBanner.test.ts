/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUpdateBanner } from '@renderer/components/UpdateBanner';
import type { UpdateStatus } from '@shared/types/updates';

function status(patch: Partial<UpdateStatus>): UpdateStatus {
  return {
    state: 'idle',
    currentVersion: '1.5.0',
    latestVersion: null,
    releaseUrl: null,
    prerelease: false,
    checkedAt: null,
    error: null,
    ...patch,
  };
}

describe('UpdateBanner', () => {
  let onInstall: ReturnType<typeof vi.fn>;
  let onDownload: ReturnType<typeof vi.fn>;
  let onShowNotes: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    onInstall = vi.fn();
    onDownload = vi.fn();
    onShowNotes = vi.fn();
  });

  function create() {
    return createUpdateBanner(document.body, { onInstall, onDownload, onShowNotes });
  }

  it('stays hidden until something is ready', () => {
    const banner = create();
    expect(banner.isVisible()).toBe(false);
    banner.update(status({ state: 'checking' }));
    banner.update(status({ state: 'up-to-date' }));
    banner.update(status({ state: 'error', error: 'x' }));
    expect(banner.isVisible()).toBe(false);
  });

  it('offers Restart for a downloaded update', () => {
    const banner = create();
    banner.update(status({ state: 'downloaded', latestVersion: '1.6.0' }));
    expect(banner.isVisible()).toBe(true);
    expect(document.querySelector('.update-banner-text')?.textContent).toBe('Open Markdown 1.6.0 is ready to install.');
    document.querySelector<HTMLButtonElement>('[data-update-primary]')!.click();
    expect(onInstall).toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-update-notes]')!.click();
    expect(onShowNotes).toHaveBeenCalled();
  });

  it('offers Download for a release that has to be fetched by hand', () => {
    const banner = create();
    banner.update(status({ state: 'available', latestVersion: '1.7.0-beta.1', releaseUrl: 'https://gh/x', prerelease: true }));
    expect(document.querySelector('.update-banner-text')?.textContent).toBe('Open Markdown pre-release 1.7.0-beta.1 is available.');
    document.querySelector<HTMLButtonElement>('[data-update-primary]')!.click();
    expect(onDownload).toHaveBeenCalledWith('https://gh/x');
  });

  it('Later hides it until a different version comes along', () => {
    const banner = create();
    banner.update(status({ state: 'downloaded', latestVersion: '1.6.0' }));
    document.querySelector<HTMLButtonElement>('[data-update-later]')!.click();
    expect(banner.isVisible()).toBe(false);

    banner.update(status({ state: 'downloaded', latestVersion: '1.6.0' }));
    expect(banner.isVisible()).toBe(false);
    banner.update(status({ state: 'downloaded', latestVersion: '1.6.1' }));
    expect(banner.isVisible()).toBe(true);
  });
});
