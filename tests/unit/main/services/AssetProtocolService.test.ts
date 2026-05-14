import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { protocol } from 'electron';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  registerAssetProtocolScheme,
  registerAssetProtocolHandler,
} from '../../../../src/main/services/AssetProtocolService';

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

type ProtocolHandler = (request: Request) => Promise<Response>;

function getRegisteredHandler(): ProtocolHandler {
  registerAssetProtocolHandler();
  const calls = vi.mocked(protocol.handle).mock.calls;
  const lastCall = calls[calls.length - 1];
  expect(lastCall?.[0]).toBe('om-asset');
  return lastCall?.[1] as ProtocolHandler;
}

function assetUrl(absolutePath: string): string {
  return pathToFileURL(absolutePath).href.replace(/^file:/, 'om-asset:');
}

describe('AssetProtocolService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerAssetProtocolScheme', () => {
    it('registers the om-asset scheme as privileged', () => {
      registerAssetProtocolScheme();
      expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
        {
          scheme: 'om-asset',
          privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            stream: true,
          },
        },
      ]);
    });
  });

  describe('protocol handler', () => {
    it('serves an existing image with the correct content type', async () => {
      vi.mocked(readFile).mockResolvedValue(Buffer.from('PNGDATA'));
      const handler = getRegisteredHandler();

      const response = await handler(
        new Request(assetUrl('/assets/logo.png'))
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(await response.text()).toBe('PNGDATA');
    });

    it('serves SVG files as image/svg+xml', async () => {
      vi.mocked(readFile).mockResolvedValue(Buffer.from('<svg/>'));
      const handler = getRegisteredHandler();

      const response = await handler(
        new Request(assetUrl('/assets/logo.svg'))
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/svg+xml');
    });

    it('rejects non-image extensions with 415', async () => {
      const handler = getRegisteredHandler();

      const response = await handler(
        new Request(assetUrl('/assets/notes.txt'))
      );

      expect(response.status).toBe(415);
      expect(readFile).not.toHaveBeenCalled();
    });

    it('returns 404 when the file cannot be read', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      const handler = getRegisteredHandler();

      const response = await handler(
        new Request(assetUrl('/assets/missing.png'))
      );

      expect(response.status).toBe(404);
    });
  });
});
