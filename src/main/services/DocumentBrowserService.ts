/**
 * DocumentBrowserService - Builds what the document browser shows
 *
 * For every window with a file loaded, asks its renderer where the document
 * view sits, captures just that area, and scales it to a thumbnail. Recent
 * files that are not open anywhere are listed after the open documents.
 */
import type { BrowserWindow, NativeImage, Rectangle } from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '@shared/types/api';
import type {
  DocumentBrowserSnapshot,
  OpenDocumentEntry,
  RecentFileEntry,
  ViewerDescription,
} from '@shared/types';

/** How long a renderer gets to answer before its window is listed without a capture */
const DESCRIBE_TIMEOUT_MS = 750;
/** Thumbnails are downscaled to this width (device pixels) before crossing IPC */
const THUMBNAIL_WIDTH = 800;
const THUMBNAIL_JPEG_QUALITY = 80;

export interface DocumentBrowserWindowSource {
  getAllWindows(): BrowserWindow[];
  getWindowFilePath(windowId: number): string | null;
}

export interface DocumentBrowserDeps {
  windows: DocumentBrowserWindowSource;
  getRecentFiles: () => RecentFileEntry[];
  /** Ask a window's renderer for its document view. Defaults to an IPC round trip. */
  describe?: (win: BrowserWindow) => Promise<ViewerDescription | null>;
  /** Capture an area of a window. Defaults to `webContents.capturePage`. */
  capture?: (win: BrowserWindow, rect: Rectangle) => Promise<NativeImage>;
}

let describeSeq = 0;

/**
 * Ask a window's renderer where its document view is. Resolves null when the
 * renderer does not answer in time, so one stuck window never blocks the
 * browser from opening.
 */
export function describeWindow(
  win: BrowserWindow,
  timeoutMs = DESCRIBE_TIMEOUT_MS
): Promise<ViewerDescription | null> {
  return new Promise((resolve) => {
    if (win.isDestroyed()) {
      resolve(null);
      return;
    }

    const requestId = ++describeSeq;
    const ipc = win.webContents.ipc;

    const handler = (
      _event: Electron.IpcMainEvent,
      id: number,
      description: ViewerDescription
    ): void => {
      if (id === requestId) finish(description);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    const finish = (value: ViewerDescription | null): void => {
      clearTimeout(timer);
      ipc.removeListener(
        IPC_CHANNELS.DOCUMENT_BROWSER.DESCRIBE_RESPONSE,
        handler
      );
      resolve(value);
    };

    ipc.on(IPC_CHANNELS.DOCUMENT_BROWSER.DESCRIBE_RESPONSE, handler);
    win.webContents.send(
      IPC_CHANNELS.DOCUMENT_BROWSER.DESCRIBE_REQUEST,
      requestId
    );
  });
}

function capturePage(
  win: BrowserWindow,
  rect: Rectangle
): Promise<NativeImage> {
  return win.webContents.capturePage(rect);
}

/**
 * Turn a reported bounding box into an integer rectangle, or null when there
 * is nothing to capture.
 */
export function toCaptureRect(
  rect: ViewerDescription['rect']
): Rectangle | null {
  if (!rect) return null;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

export class DocumentBrowserService {
  private readonly windows: DocumentBrowserWindowSource;
  private readonly getRecentFiles: () => RecentFileEntry[];
  private readonly describe: (
    win: BrowserWindow
  ) => Promise<ViewerDescription | null>;
  private readonly capture: (
    win: BrowserWindow,
    rect: Rectangle
  ) => Promise<NativeImage>;

  /**
   * Last good thumbnail per window. A hidden or occluded window may capture
   * blank; showing what it looked like last time beats showing nothing.
   */
  private readonly thumbnailCache = new Map<number, string>();

  constructor(deps: DocumentBrowserDeps) {
    this.windows = deps.windows;
    this.getRecentFiles = deps.getRecentFiles;
    this.describe = deps.describe ?? ((win) => describeWindow(win));
    this.capture = deps.capture ?? capturePage;
  }

  /**
   * Capture every open document and list recent files that are not open.
   * Windows are captured in parallel so the wait is one capture, not N.
   */
  async buildSnapshot(
    currentWindowId: number | null
  ): Promise<DocumentBrowserSnapshot> {
    const candidates = this.windows
      .getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map((win) => ({ win, filePath: this.windows.getWindowFilePath(win.id) }))
      .filter(
        (entry): entry is { win: BrowserWindow; filePath: string } =>
          entry.filePath !== null
      );

    const open = await Promise.all(
      candidates.map(({ win, filePath }) =>
        this.describeEntry(win, filePath, currentWindowId)
      )
    );

    const openPaths = new Set(open.map((entry) => entry.filePath));
    const recent = this.getRecentFiles().filter(
      (entry) => !openPaths.has(entry.filePath)
    );

    return { open, recent };
  }

  /** Drop the cached thumbnail of a window that no longer exists. */
  forgetWindow(windowId: number): void {
    this.thumbnailCache.delete(windowId);
  }

  private async describeEntry(
    win: BrowserWindow,
    filePath: string,
    currentWindowId: number | null
  ): Promise<OpenDocumentEntry> {
    let description: ViewerDescription | null = null;
    try {
      description = await this.describe(win);
    } catch {
      description = null;
    }

    const thumbnail = await this.captureThumbnail(
      win,
      description?.rect ?? null
    );

    return {
      windowId: win.id,
      filePath,
      fileName: path.basename(filePath),
      thumbnail,
      isCurrent: win.id === currentWindowId,
      text: description?.text ?? '',
    };
  }

  private async captureThumbnail(
    win: BrowserWindow,
    rect: ViewerDescription['rect']
  ): Promise<string | null> {
    const captureRect = toCaptureRect(rect);
    if (captureRect && !win.isDestroyed()) {
      try {
        const image = await this.capture(win, captureRect);
        if (!image.isEmpty()) {
          const thumbnail = toThumbnailDataUrl(image);
          this.remember(win, thumbnail);
          return thumbnail;
        }
      } catch {
        // Fall through to the cached thumbnail, if any
      }
    }
    return this.thumbnailCache.get(win.id) ?? null;
  }

  private remember(win: BrowserWindow, thumbnail: string): void {
    if (!this.thumbnailCache.has(win.id)) {
      const id = win.id;
      win.once('closed', () => this.forgetWindow(id));
    }
    this.thumbnailCache.set(win.id, thumbnail);
  }
}

function toThumbnailDataUrl(image: NativeImage): string {
  const { width } = image.getSize();
  const scaled =
    width > THUMBNAIL_WIDTH
      ? image.resize({ width: THUMBNAIL_WIDTH, quality: 'good' })
      : image;
  return `data:image/jpeg;base64,${scaled.toJPEG(THUMBNAIL_JPEG_QUALITY).toString('base64')}`;
}

let instance: DocumentBrowserService | null = null;

export function getDocumentBrowserService(): DocumentBrowserService {
  if (!instance) {
    throw new Error('DocumentBrowserService has not been created');
  }
  return instance;
}

export function createDocumentBrowserService(
  deps: DocumentBrowserDeps
): DocumentBrowserService {
  instance = new DocumentBrowserService(deps);
  return instance;
}

export function resetDocumentBrowserService(): void {
  instance = null;
}
