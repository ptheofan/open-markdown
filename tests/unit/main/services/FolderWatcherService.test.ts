/**
 * FolderWatcherService: one shallow watcher per listed directory, shared
 * between windows, with bursts collapsed into one notice
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  FolderWatcherService,
  FOLDER_CHANGE_DEBOUNCE_MS,
} from '@main/services/FolderWatcherService';

interface MockWatcher {
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  handlers: Map<string, (p: string) => void>;
}

let watchers: MockWatcher[] = [];
let lastOptions: Record<string, unknown> | undefined;

vi.mock('chokidar', () => ({
  watch: vi.fn((_path: string, options: Record<string, unknown>) => {
    lastOptions = options;
    const watcher: MockWatcher = {
      handlers: new Map(),
      on: vi.fn((event: string, handler: (p: string) => void) => {
        watcher.handlers.set(event, handler);
        return watcher;
      }),
      once: vi.fn((event: string, callback: () => void) => {
        if (event === 'ready') setTimeout(callback, 0);
        return watcher;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    watchers.push(watcher);
    return watcher;
  }),
}));

describe('FolderWatcherService', () => {
  let service: FolderWatcherService;

  beforeEach(() => {
    watchers = [];
    service = new FolderWatcherService();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await service.destroy();
    vi.useRealTimers();
  });

  async function watchFor(dir: string, windowId: number): Promise<void> {
    const promise = service.watch(dir, windowId);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
  }

  it('watches a directory shallowly and leaves build folders alone', async () => {
    await watchFor('/repo/docs', 1);
    expect(watchers).toHaveLength(1);
    expect(lastOptions?.['depth']).toBe(0);
    const ignored = lastOptions?.['ignored'] as (p: string) => boolean;
    expect(ignored('/repo/docs/node_modules')).toBe(true);
    expect(ignored('/repo/docs/guide.md')).toBe(false);
    expect(ignored('/repo/docs')).toBe(false);
    expect(service.isWatching('/repo/docs')).toBe(true);
  });

  it('shares one watcher between windows and closes it with the last one', async () => {
    await watchFor('/repo', 1);
    await watchFor('/repo', 2);
    expect(watchers).toHaveLength(1);

    await service.unwatch('/repo', 1);
    expect(watchers[0]!.close).not.toHaveBeenCalled();
    await service.unwatch('/repo', 2);
    expect(watchers[0]!.close).toHaveBeenCalledTimes(1);
    expect(service.isWatching('/repo')).toBe(false);
  });

  it('collapses a burst of events into one notice per window that watches it', async () => {
    const seenByOne = vi.fn();
    const seenByTwo = vi.fn();
    service.onChange(1, seenByOne);
    service.onChange(2, seenByTwo);
    await watchFor('/repo', 1);

    const w = watchers[0]!;
    w.handlers.get('add')!('/repo/new.md');
    w.handlers.get('unlink')!('/repo/old.md');
    w.handlers.get('addDir')!('/repo/sub');
    expect(seenByOne).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_DEBOUNCE_MS + 1);
    expect(seenByOne).toHaveBeenCalledTimes(1);
    expect(seenByOne).toHaveBeenCalledWith('/repo');
    expect(seenByTwo).not.toHaveBeenCalled();
  });

  it('drops everything a window watched when it goes away', async () => {
    await watchFor('/repo', 1);
    await watchFor('/repo/docs', 1);
    await service.unwatchAll(1);
    expect(service.isWatching('/repo')).toBe(false);
    expect(service.isWatching('/repo/docs')).toBe(false);
    expect(watchers.every((w) => w.close.mock.calls.length === 1)).toBe(true);
  });
});
