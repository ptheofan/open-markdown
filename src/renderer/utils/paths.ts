/**
 * Path helpers for the renderer, which has no node:path. File paths come from
 * the main process in the platform's own form, so both / and \ separate
 * segments: on Windows a path holds only backslashes.
 */

function lastSeparator(filePath: string): number {
  return Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
}

/** The last segment of a path: the file's name */
export function fileNameOf(filePath: string): string {
  return filePath.slice(lastSeparator(filePath) + 1);
}

/** Everything before the last segment, or '' when nothing sits above it */
export function parentDirOf(filePath: string): string {
  const separator = lastSeparator(filePath);
  return separator > 0 ? filePath.slice(0, separator) : '';
}
