/**
 * sandboxPaths - Filesystem facts that differ inside the macOS App Sandbox
 *
 * The Mac App Store build runs sandboxed: HOME points at the app's container
 * and files the user has not picked are refused with EPERM rather than
 * reported missing.
 */
import { homedir, userInfo } from 'node:os';

/**
 * The user's real home folder. Inside the sandbox HOME is
 * ~/Library/Containers/<id>/Data, which is not where a written ~ is meant to
 * go; the account record still has the real one.
 */
export function realHomeDir(): string {
  try {
    return userInfo().homedir || homedir();
  } catch {
    return homedir();
  }
}

/** The file is there but the sandbox (or permissions) refuse it */
export function isAccessDenied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EACCES';
}
