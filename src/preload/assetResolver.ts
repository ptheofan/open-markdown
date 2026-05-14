/**
 * Resolves image references found in markdown documents to `om-asset:` URLs
 * that the main process can serve from disk.
 *
 * Runs in the preload context, where Node's `path` module is available to
 * resolve relative references against the document's location.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ASSET_PROTOCOL_SCHEME } from '@shared/constants';

/**
 * Resolve an image reference against the markdown file that contains it.
 *
 * @param baseFilePath - Absolute path to the markdown file being rendered.
 * @param ref - The raw `src`/`srcset` reference from the document.
 * @returns An `om-asset:` URL for local files, or `null` when the reference
 *   should be left untouched (already a URL, protocol-relative, or empty).
 */
export function resolveAssetUrl(baseFilePath: string, ref: string): string | null {
  if (!baseFilePath || !ref) {
    return null;
  }

  const trimmed = ref.trim();
  if (!trimmed) {
    return null;
  }

  // Already an absolute URL (http:, https:, data:, blob:, file:, mailto:, ...).
  // A single-character "scheme" is actually a Windows drive letter, so the
  // scheme is required to be at least two characters long.
  if (/^[a-z][a-z0-9+.-]+:/i.test(trimmed) || trimmed.startsWith('//')) {
    return null;
  }

  // Pure in-document anchors are not assets.
  if (trimmed.startsWith('#')) {
    return null;
  }

  // Filesystem paths carry neither query strings nor fragments.
  const cleaned = trimmed.replace(/[?#].*$/, '');
  if (!cleaned) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    decoded = cleaned;
  }

  const resolved = path.isAbsolute(decoded)
    ? decoded
    : path.resolve(path.dirname(baseFilePath), decoded);

  return pathToFileURL(resolved).href.replace(
    /^file:/,
    `${ASSET_PROTOCOL_SCHEME}:`
  );
}
