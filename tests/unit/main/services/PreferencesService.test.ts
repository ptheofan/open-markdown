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
    writeFile.mockRestore();
  });
});
