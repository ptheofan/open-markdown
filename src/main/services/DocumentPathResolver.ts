/**
 * DocumentPathResolver - Turns a typed or pasted path into an absolute path
 *
 * Paths arrive as text from a terminal, a chat, or another document, so the
 * input is cleaned the way a shell would read it before it is resolved: a
 * trailing newline from a copy, quotes around the whole thing, a file:// URL,
 * a leading ~, and backslash-escaped spaces are all accepted.
 */
import path from 'node:path';

import type { PathResolveBase } from '@shared/types';

export interface ResolvedDocumentPath {
  filePath: string;
  resolvedFrom: PathResolveBase;
}

/**
 * Strip the decoration a pasted path tends to carry so that only the path
 * itself is left. Returns an empty string when nothing usable remains.
 */
export function cleanPathInput(raw: string): string {
  let input = raw.trim();

  if (input.startsWith('file://')) {
    try {
      input = decodeURIComponent(new URL(input).pathname);
    } catch {
      input = decodeURIComponent(input.slice('file://'.length));
    }
  }

  // Quotes around the whole path, as a shell or Finder's "Copy as Pathname" leaves them
  const quoted = /^(['"])(.*)\1$/s.exec(input);
  if (quoted?.[2] !== undefined) {
    input = quoted[2].trim();
  }

  // Shell-escaped characters: "My\ Notes" is the folder "My Notes"
  input = input.replace(/\\(.)/g, '$1');

  return input;
}

/**
 * Resolve a typed or pasted path. Absolute paths stand on their own, a
 * leading ~ is the home directory, and anything else is relative to the
 * folder of baseFilePath, or to the home directory when there is no document
 * to be relative to. Returns null for empty input.
 */
export function resolveDocumentPath(
  raw: string,
  baseFilePath: string | null,
  homeDir: string
): ResolvedDocumentPath | null {
  const input = cleanPathInput(raw);
  if (!input) return null;

  if (input === '~' || input.startsWith('~/')) {
    return {
      filePath: path.normalize(path.join(homeDir, input.slice(1))),
      resolvedFrom: 'absolute',
    };
  }

  if (path.isAbsolute(input)) {
    return { filePath: path.normalize(input), resolvedFrom: 'absolute' };
  }

  if (baseFilePath) {
    return {
      filePath: path.resolve(path.dirname(baseFilePath), input),
      resolvedFrom: 'document',
    };
  }

  return { filePath: path.resolve(homeDir, input), resolvedFrom: 'home' };
}
