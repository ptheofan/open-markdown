/**
 * PreferencesService: an update that changes nothing is not written or
 * broadcast. Every broadcast re-renders the open documents, so a no-op save
 * is not free (#90).
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => os.tmpdir()) } }));

import { PreferencesService } from '@main/services/PreferencesService';

describe('PreferencesService.updatePreferences', () => {
  let dir: string;
  let service: PreferencesService;
  let listener: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prefs-test-'));
    service = new PreferencesService(dir);
    await service.initialize();
    listener = vi.fn();
    service.onPreferencesChange(listener);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes and notifies when a value changes', async () => {
    await service.updatePreferences({ plugins: { 'front-matter': { expanded: false } } });

    expect(listener).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await fs.readFile(service.getPreferencesPath(), 'utf-8'));
    expect(saved.plugins['front-matter'].expanded).toBe(false);
  });

  it('neither writes nor notifies when the merge changes nothing', async () => {
    await service.updatePreferences({ plugins: { 'front-matter': { expanded: false } } });
    listener.mockClear();
    const writeFile = vi.spyOn(fs, 'writeFile');

    await service.updatePreferences({ plugins: { 'front-matter': { expanded: false } } });
    await service.updatePreferences({ windowState: service.getPreferences().windowState });

    expect(writeFile).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  // A failed write must not leave the change looking saved, or retrying the
  // same change would be skipped as a no-op and never reach disk or other windows
  it('saves the same change again after a failed write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    const change = { plugins: { 'front-matter': { expanded: false } } };

    await expect(service.updatePreferences(change)).rejects.toThrow('disk full');
    expect(listener).not.toHaveBeenCalled();

    await service.updatePreferences(change);

    expect(listener).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await fs.readFile(service.getPreferencesPath(), 'utf-8'));
    expect(saved.plugins['front-matter'].expanded).toBe(false);
  });
});

describe('PreferencesService.setPluginPreferences', () => {
  let dir: string;
  let service: PreferencesService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prefs-test-'));
    service = new PreferencesService(dir);
    await service.initialize();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('neither writes nor notifies when the plugin preferences are unchanged', async () => {
    await service.setPluginPreferences('front-matter', { expanded: false });
    const listener = vi.fn();
    service.onPreferencesChange(listener);
    const writeFile = vi.spyOn(fs, 'writeFile');

    await service.setPluginPreferences('front-matter', { expanded: false });

    expect(writeFile).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('writes and notifies when they change', async () => {
    const listener = vi.fn();
    service.onPreferencesChange(listener);

    await service.setPluginPreferences('front-matter', { expanded: false });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(service.getPluginPreferences('front-matter')).toEqual({ expanded: false });
  });
});
