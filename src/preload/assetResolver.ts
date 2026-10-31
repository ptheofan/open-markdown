/**
 * Resolves image references found in markdown documents to `om-asset:` URLs
 * that the main process can serve from disk.
 *
 * Runs in the preload context, where Node's `path` module is available to
 * resolve relative references against the document's location.
 */
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ASSET_PROTOCOL_SCHEME, ASSET_PROTOCOL_HOST } from '@shared/constants';

/**
 * Resolve a document reference to an absolute filesystem path.
 *
 * @param baseFilePath - Absolute path to the markdown file being rendered.
 * @param ref - The raw reference from the document (e.g. `./other.md`,
 *   `images/logo.svg`, `/abs/path/file.md`).
 * @returns The absolute path on disk, or `null` when the reference is not a
 *   local file (already a URL, protocol-relative, in-document anchor, or
 *   empty). Query strings and fragments are stripped.
 */
export function resolveLocalPath(baseFilePath: string, ref: string): string | null {
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

  // Pure in-document anchors are not local files.
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

  // ~ is the user's real home; in the macOS sandbox HOME is the app container
  if (decoded === '~' || decoded.startsWith('~/')) {
    return path.join(realHomeDir(), decoded.slice(1));
  }

  return path.isAbsolute(decoded)
    ? decoded
    : path.resolve(path.dirname(baseFilePath), decoded);
}

function realHomeDir(): string {
  try {
    return userInfo().homedir || homedir();
  } catch {
    return homedir();
  }
}

/**
 * Resolve an image reference against the markdown file that contains it.
 *
 * @param baseFilePath - Absolute path to the markdown file being rendered.
 * @param ref - The raw `src`/`srcset` reference from the document.
 * @returns An `om-asset:` URL for local files, or `null` when the reference
 *   should be left untouched (already a URL, protocol-relative, or empty).
 */
export function resolveAssetUrl(baseFilePath: string, ref: string): string | null {
  const resolved = resolveLocalPath(baseFilePath, ref);
  if (!resolved) {
    return null;
  }

  // Embed the (already percent-encoded) file path under a fixed host. A bare
  // `om-asset:///path` URL is mangled by Chromium's standard-scheme parser,
  // which treats the first path segment as the host; a fixed host keeps the
  // full path intact.
  return `${ASSET_PROTOCOL_SCHEME}://${ASSET_PROTOCOL_HOST}${pathToFileURL(resolved).pathname}`;
}
