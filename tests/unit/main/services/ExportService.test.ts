/**
 * ExportService: the parts that do not need a window -- which assets may be
 * inlined, from where, and how big.
 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/downloads') },
  BrowserWindow: class {},
  dialog: { showSaveDialog: vi.fn() },
}));

import {
  ExportService,
  assetFilePath,
  mimeForAsset,
  toDataUri,
  MAX_ASSET_BYTES,
} from '@main/services/ExportService';

describe('mimeForAsset', () => {
  it('knows images and fonts and nothing else', () => {
    expect(mimeForAsset('/a/b.PNG')).toBe('image/png');
    expect(mimeForAsset('/a/b.woff2')).toBe('font/woff2');
    expect(mimeForAsset('/a/b.exe')).toBeNull();
    expect(mimeForAsset('/a/b')).toBeNull();
  });
});

describe('assetFilePath', () => {
  const renderer = '/app/.vite/renderer/main_window';

  it('decodes om-asset URLs the way the protocol handler does', () => {
    expect(assetFilePath('om-asset://local/Users/me/docs/pic.png', renderer)).toBe('/Users/me/docs/pic.png');
    expect(assetFilePath('om-asset://local/Users/me/my%20docs/pic.png', renderer)).toBe('/Users/me/my docs/pic.png');
  });

  it('accepts file URLs only for fonts inside the renderer folder', () => {
    expect(assetFilePath(`file://${renderer}/assets/KaTeX_Main.woff2`, renderer)).toBe(`${renderer}/assets/KaTeX_Main.woff2`);
    expect(assetFilePath('file:///etc/passwd', renderer)).toBeNull();
    expect(assetFilePath('file:///etc/evil.woff2', renderer)).toBeNull();
    expect(assetFilePath(`file://${renderer}/../../../etc/x.woff2`, renderer)).toBeNull();
    expect(assetFilePath(`file://${renderer}/assets/KaTeX_Main.woff2`, null)).toBeNull();
  });

  it('refuses other schemes and garbage', () => {
    expect(assetFilePath('https://example.com/a.png', renderer)).toBeNull();
    expect(assetFilePath('not a url', renderer)).toBeNull();
    expect(assetFilePath('data:image/png;base64,AAAA', renderer)).toBeNull();
  });
});

describe('toDataUri', () => {
  it('encodes bytes with the mime type', () => {
    expect(toDataUri(Buffer.from('hi'), 'text/plain')).toBe('data:text/plain;base64,aGk=');
  });
});

describe('ExportService.inlineAssets', () => {
  let dir: string;
  let service: ExportService;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'om-export-'));
    await writeFile(path.join(dir, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(path.join(dir, 'big.png'), Buffer.alloc(MAX_ASSET_BYTES + 1));
    await writeFile(path.join(dir, 'notes.txt'), 'x');
    await writeFile(path.join(dir, 'f.woff2'), Buffer.from('font'));
    service = new ExportService({ rendererDir: dir });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const omUrl = (name: string): string => `om-asset://local${path.join(dir, name)}`;

  it('reads images as data URIs, keyed by the URL as given', async () => {
    const result = await service.inlineAssets([omUrl('a.png'), omUrl('a.png')]);
    expect(result).toEqual({ [omUrl('a.png')]: 'data:image/png;base64,iVBORw==' });
  });

  it('maps missing, oversized and unsupported assets to null', async () => {
    const result = await service.inlineAssets([omUrl('missing.png'), omUrl('big.png'), omUrl('notes.txt')]);
    expect(result[omUrl('missing.png')]).toBeNull();
    expect(result[omUrl('big.png')]).toBeNull();
    expect(result[omUrl('notes.txt')]).toBeNull();
  });

  it('inlines the app fonts from the renderer folder', async () => {
    const url = pathToFileURL(path.join(dir, 'f.woff2')).href;
    const result = await service.inlineAssets([url]);
    expect(result[url]).toBe('data:font/woff2;base64,Zm9udA==');
  });
});
