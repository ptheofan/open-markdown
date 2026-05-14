/**
 * AssetProtocolService - Serves local image assets referenced by markdown
 * documents through a dedicated custom protocol.
 *
 * Markdown files commonly reference images with relative or absolute
 * filesystem paths (e.g. `docs/images/logo.svg`). Those cannot be loaded
 * directly from the renderer: the document's origin is the app bundle (or the
 * dev server), and the Content-Security-Policy forbids `file:` images. The
 * renderer rewrites such references to `om-asset:` URLs which this handler
 * resolves back to files on disk.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { protocol } from 'electron';

import { ASSET_PROTOCOL_SCHEME } from '@shared/constants';

/**
 * Image extensions the protocol is allowed to serve. Restricting to images
 * keeps the handler from turning into an arbitrary local-file reader.
 */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.apng': 'image/apng',
};

/**
 * Privileged scheme registration. Must run before the app `ready` event.
 */
export function registerAssetProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Register the protocol handler. Must run after the app `ready` event.
 */
export function registerAssetProtocolHandler(): void {
  protocol.handle(ASSET_PROTOCOL_SCHEME, async (request) => {
    let filePath: string;
    try {
      // The renderer encodes the file path as the URL path under a fixed
      // host; reattaching it to a `file:` URL yields the original path.
      const { pathname } = new URL(request.url);
      filePath = fileURLToPath(`file://${pathname}`);
    } catch {
      return new Response('Invalid asset URL', { status: 400 });
    }

    const contentType = IMAGE_CONTENT_TYPES[path.extname(filePath).toLowerCase()];
    if (!contentType) {
      return new Response('Unsupported asset type', { status: 415 });
    }

    try {
      const data = await readFile(filePath);
      return new Response(data, {
        headers: {
          'content-type': contentType,
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return new Response('Asset not found', { status: 404 });
    }
  });
}
