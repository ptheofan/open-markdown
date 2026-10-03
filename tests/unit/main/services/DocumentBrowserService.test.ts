/**
 * DocumentBrowserService unit tests
 *
 * The service lists windows with a file loaded, captures the document view
 * each renderer reports, and lists recent files that are not open anywhere.
 */
import type { BrowserWindow, NativeImage, Rectangle } from 'electron';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  DocumentBrowserService,
  describeWindow,
  toCaptureRect,
} from '@main/services/DocumentBrowserService';
import { IPC_CHANNELS } from '@shared/types/api';
import type { RecentFileEntry, ViewerDescription } from '@shared/types';

interface FakeWindow {
  id: number;
  isDestroyed: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  webContents: {
    send: ReturnType<typeof vi.fn>;
    capturePage: ReturnType<typeof vi.fn>;
    ipc: {
      on: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
      _emit: (channel: string, ...args: unknown[]) => void;
    };
  };
}

function fakeWindow(id: number): FakeWindow {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    id,
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    webContents: {
      send: vi.fn(),
      capturePage: vi.fn(),
      ipc: {
        on: vi.fn((channel: string, cb: (...args: unknown[]) => void) => {
          listeners.set(channel, [...(listeners.get(channel) ?? []), cb]);
        }),
        removeListener: vi.fn((channel: string, cb: (...args: unknown[]) => void) => {
          listeners.set(channel, (listeners.get(channel) ?? []).filter((l) => l !== cb));
        }),
        _emit: (channel: string, ...args: unknown[]) => {
          for (const cb of listeners.get(channel) ?? []) cb({}, ...args);
        },
      },
    },
  };
}

function fakeImage(width: number, empty = false): NativeImage {
  const image = {
    isEmpty: () => empty,
    getSize: () => ({ width, height: Math.round(width * 0.75) }),
    resize: vi.fn(() => image),
    toJPEG: vi.fn(() => Buffer.from(`jpeg-${width}`)),
  };
  return image as unknown as NativeImage;
}

const describedRect: ViewerDescription = {
  rect: { x: 10, y: 60, width: 800, height: 600 },
  text: 'Hello world',
};

const recent: RecentFileEntry[] = [
  { filePath: '/docs/a.md', fileName: 'a.md', openedAt: '2026-10-01T00:00:00Z' },
  { filePath: '/docs/old.md', fileName: 'old.md', openedAt: '2026-09-01T00:00:00Z' },
];

function makeService(
  windows: FakeWindow[],
  filePaths: Record<number, string | null>,
  overrides: {
    describe?: (win: BrowserWindow) => Promise<ViewerDescription | null>;
    capture?: (win: BrowserWindow, rect: Rectangle) => Promise<NativeImage>;
  } = {}
): DocumentBrowserService {
  return new DocumentBrowserService({
    windows: {
      getAllWindows: () => windows as unknown as BrowserWindow[],
      getWindowFilePath: (id) => filePaths[id] ?? null,
    },
    getRecentFiles: () => recent,
    describe: overrides.describe ?? (() => Promise.resolve(describedRect)),
    capture: overrides.capture ?? (() => Promise.resolve(fakeImage(1600))),
  });
}

describe('toCaptureRect', () => {
  it('should return null when nothing was reported', () => {
    expect(toCaptureRect(null)).toBeNull();
  });

  it('should return null for an empty area', () => {
    expect(toCaptureRect({ x: 0, y: 0, width: 0, height: 100 })).toBeNull();
  });

  it('should floor fractional coordinates and never go negative', () => {
    expect(toCaptureRect({ x: -3.2, y: 52.7, width: 799.9, height: 600.1 })).toEqual({
      x: 0,
      y: 52,
      width: 799,
      height: 600,
    });
  });
});

describe('DocumentBrowserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSnapshot', () => {
    it('should list only windows with a file loaded', async () => {
      const windows = [fakeWindow(1), fakeWindow(2), fakeWindow(3)];
      const service = makeService(windows, { 1: '/docs/a.md', 2: null, 3: '/docs/b.md' });

      const snapshot = await service.buildSnapshot(1);

      expect(snapshot.open.map((e) => e.windowId)).toEqual([1, 3]);
      expect(snapshot.open[0]).toMatchObject({
        filePath: '/docs/a.md',
        fileName: 'a.md',
        isCurrent: true,
        text: 'Hello world',
      });
      expect(snapshot.open[1]?.isCurrent).toBe(false);
    });

    it('should skip destroyed windows', async () => {
      const windows = [fakeWindow(1), fakeWindow(2)];
      windows[1]!.isDestroyed.mockReturnValue(true);
      const service = makeService(windows, { 1: '/docs/a.md', 2: '/docs/b.md' });

      const snapshot = await service.buildSnapshot(null);

      expect(snapshot.open.map((e) => e.windowId)).toEqual([1]);
    });

    it('should leave out recent files that are open in a window', async () => {
      const service = makeService([fakeWindow(1)], { 1: '/docs/a.md' });

      const snapshot = await service.buildSnapshot(1);

      expect(snapshot.recent.map((e) => e.filePath)).toEqual(['/docs/old.md']);
    });

    it('should capture the reported rectangle and scale it to a JPEG data URL', async () => {
      const image = fakeImage(1600);
      const capture = vi.fn(() => Promise.resolve(image));
      const service = makeService([fakeWindow(1)], { 1: '/docs/a.md' }, { capture });

      const snapshot = await service.buildSnapshot(1);

      expect(capture).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), {
        x: 10,
        y: 60,
        width: 800,
        height: 600,
      });
      expect(image.resize).toHaveBeenCalledWith({ width: 800, quality: 'good' });
      expect(snapshot.open[0]?.thumbnail).toBe(
        `data:image/jpeg;base64,${Buffer.from('jpeg-1600').toString('base64')}`
      );
    });

    it('should not upscale a capture narrower than the thumbnail width', async () => {
      const image = fakeImage(500);
      const service = makeService([fakeWindow(1)], { 1: '/docs/a.md' }, {
        capture: () => Promise.resolve(image),
      });

      await service.buildSnapshot(1);

      expect(image.resize).not.toHaveBeenCalled();
    });

    it('should list a window without a thumbnail when its renderer reports no view', async () => {
      const capture = vi.fn();
      const service = makeService([fakeWindow(1)], { 1: '/docs/a.md' }, {
        describe: () => Promise.resolve({ rect: null, text: '' }),
        capture,
      });

      const snapshot = await service.buildSnapshot(1);

      expect(capture).not.toHaveBeenCalled();
      expect(snapshot.open[0]?.thumbnail).toBeNull();
    });

    it('should list a window without a thumbnail when its renderer does not answer', async () => {
      const service = makeService([fakeWindow(1)], { 1: '/docs/a.md' }, {
        describe: () => Promise.resolve(null),
      });

      const snapshot = await service.buildSnapshot(1);

      expect(snapshot.open[0]).toMatchObject({ thumbnail: null, text: '' });
    });

    it('should fall back to the last good thumbnail when a capture comes back empty', async () => {
      const captures = [fakeImage(1600), fakeImage(1600, true)];
      const service = makeService([fakeWindow(1)], { 1: '/docs/a.md' }, {
        capture: () => Promise.resolve(captures.shift()!),
      });

      const first = await service.buildSnapshot(1);
      const second = await service.buildSnapshot(1);

      expect(second.open[0]?.thumbnail).toBe(first.open[0]?.thumbnail);
    });

    it('should fall back to the last good thumbnail when a capture throws', async () => {
      let calls = 0;
      const service = makeService([fakeWindow(1)], { 1: '/docs/a.md' }, {
        capture: () => {
          calls++;
          if (calls > 1) return Promise.reject(new Error('window gone'));
          return Promise.resolve(fakeImage(1600));
        },
      });

      const first = await service.buildSnapshot(1);
      const second = await service.buildSnapshot(1);

      expect(second.open[0]?.thumbnail).toBe(first.open[0]?.thumbnail);
    });

    it('should survive a describe that throws', async () => {
      const service = makeService([fakeWindow(1)], { 1: '/docs/a.md' }, {
        describe: () => Promise.reject(new Error('boom')),
      });

      const snapshot = await service.buildSnapshot(1);

      expect(snapshot.open).toHaveLength(1);
      expect(snapshot.open[0]?.thumbnail).toBeNull();
    });

    it('should forget the cached thumbnail when the window closes', async () => {
      const win = fakeWindow(1);
      const captures = [fakeImage(1600), fakeImage(1600, true)];
      const service = makeService([win], { 1: '/docs/a.md' }, {
        capture: () => Promise.resolve(captures.shift()!),
      });

      await service.buildSnapshot(1);
      expect(win.once).toHaveBeenCalledWith('closed', expect.any(Function));
      const onClosed = win.once.mock.calls[0]?.[1] as () => void;
      onClosed();

      const after = await service.buildSnapshot(1);
      expect(after.open[0]?.thumbnail).toBeNull();
    });
  });
});

describe('describeWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should ask the renderer and resolve with its answer', async () => {
    const win = fakeWindow(1);

    const pending = describeWindow(win as unknown as BrowserWindow, 1000);

    expect(win.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.DOCUMENT_BROWSER.DESCRIBE_REQUEST,
      expect.any(Number)
    );
    const requestId = win.webContents.send.mock.calls[0]?.[1] as number;
    win.webContents.ipc._emit(
      IPC_CHANNELS.DOCUMENT_BROWSER.DESCRIBE_RESPONSE,
      requestId,
      describedRect
    );

    await expect(pending).resolves.toEqual(describedRect);
    expect(win.webContents.ipc.removeListener).toHaveBeenCalled();
  });

  it('should ignore an answer to a different request', async () => {
    const win = fakeWindow(1);

    const pending = describeWindow(win as unknown as BrowserWindow, 1000);
    win.webContents.ipc._emit(IPC_CHANNELS.DOCUMENT_BROWSER.DESCRIBE_RESPONSE, -1, describedRect);
    vi.advanceTimersByTime(1000);

    await expect(pending).resolves.toBeNull();
  });

  it('should resolve null when the renderer does not answer in time', async () => {
    const win = fakeWindow(1);

    const pending = describeWindow(win as unknown as BrowserWindow, 500);
    vi.advanceTimersByTime(500);

    await expect(pending).resolves.toBeNull();
    expect(win.webContents.ipc.removeListener).toHaveBeenCalled();
  });

  it('should resolve null for a destroyed window without asking', async () => {
    const win = fakeWindow(1);
    win.isDestroyed.mockReturnValue(true);

    await expect(describeWindow(win as unknown as BrowserWindow, 500)).resolves.toBeNull();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
