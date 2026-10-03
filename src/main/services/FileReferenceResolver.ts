/**
 * FileReferenceResolver - where a path written in a document actually is
 *
 * A reference such as `src/app.ts` is tried from the document's own folder
 * first, then from each parent folder up to the project root. The root is
 * the folder the user named in preferences or, failing that, the nearest
 * ancestor holding a `.git` directory -- the folder Claude Code and friends
 * write paths relative to.
 */
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/** Pluggable filesystem probe, so the walk can be tested without a disk */
export interface ReferenceProbe {
  isFile: (filePath: string) => Promise<boolean>;
  isDirectory: (dirPath: string) => Promise<boolean>;
}

const MAX_ANCESTORS = 12;

export async function fsProbeIsFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function fsProbeIsDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

export const fsProbe: ReferenceProbe = { isFile: fsProbeIsFile, isDirectory: fsProbeIsDirectory };

/**
 * The nearest ancestor of `dir` (itself included) that contains `.git`, or
 * null when none does within a sane number of levels.
 */
export async function findGitRoot(dir: string, probe: ReferenceProbe): Promise<string | null> {
  let current = dir;
  for (let i = 0; i < MAX_ANCESTORS; i++) {
    if (await probe.isDirectory(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * The folders a relative reference is tried from, in order: the document's
 * folder, then each ancestor up to and including the project root. With no
 * root known, only the document's folder is used.
 */
export function candidateBases(documentDir: string, projectRoot: string | null): string[] {
  const bases = [documentDir];
  if (!projectRoot) return bases;

  const root = path.resolve(projectRoot);
  let current = documentDir;
  for (let i = 0; i < MAX_ANCESTORS && current !== root; i++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    bases.push(current);
  }
  if (!bases.includes(root)) bases.push(root);
  return bases;
}

/**
 * Resolve one reference to the absolute path of an existing file, or null.
 */
export async function resolveFileReference(
  ref: string,
  documentPath: string,
  options: { projectRoot?: string | null; home?: string; probe?: ReferenceProbe } = {}
): Promise<string | null> {
  const probe = options.probe ?? fsProbe;
  const home = options.home ?? homedir();
  const documentDir = path.dirname(documentPath);

  let candidates: string[];
  if (ref.startsWith('~/')) {
    candidates = [path.join(home, ref.slice(2))];
  } else if (path.isAbsolute(ref)) {
    candidates = [path.normalize(ref)];
  } else {
    const root = options.projectRoot?.trim()
      ? options.projectRoot.trim()
      : await findGitRoot(documentDir, probe);
    candidates = candidateBases(documentDir, root).map((base) => path.resolve(base, ref));
  }

  for (const candidate of candidates) {
    if (await probe.isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve many references against one document, keyed by the reference as
 * written. The project root is found once.
 */
export async function resolveFileReferences(
  refs: string[],
  documentPath: string,
  options: { projectRoot?: string | null; home?: string; probe?: ReferenceProbe } = {}
): Promise<Record<string, string | null>> {
  const probe = options.probe ?? fsProbe;
  const documentDir = path.dirname(documentPath);
  const projectRoot = options.projectRoot?.trim()
    ? options.projectRoot.trim()
    : await findGitRoot(documentDir, probe);

  const results: Record<string, string | null> = {};
  for (const ref of new Set(refs)) {
    results[ref] = await resolveFileReference(ref, documentPath, { ...options, projectRoot, probe });
  }
  return results;
}

/**
 * The local file a link's href names, relative to the document's folder, or
 * null when it is not a local reference (a URL, an anchor) or does not exist.
 * A `#fragment` and `?query` are ignored; percent-encoding is undone.
 */
export interface LinkTarget {
  /** Absolute path the href names */
  path: string;
  /** Whether a file is there */
  exists: boolean;
}

export async function resolveRelativeLink(
  href: string,
  documentPath: string,
  probe: ReferenceProbe = fsProbe
): Promise<LinkTarget | null> {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

  let target = trimmed.replace(/[?#].*$/, '');
  if (!target) return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep as written
  }

  const candidate = path.isAbsolute(target)
    ? path.normalize(target)
    : path.resolve(path.dirname(documentPath), target);
  return { path: candidate, exists: await probe.isFile(candidate) };
}

/**
 * Resolve many links against one document, keyed by the href as written.
 */
export async function resolveRelativeLinks(
  hrefs: string[],
  documentPath: string,
  probe: ReferenceProbe = fsProbe
): Promise<Record<string, LinkTarget | null>> {
  const results: Record<string, LinkTarget | null> = {};
  for (const href of new Set(hrefs)) {
    results[href] = await resolveRelativeLink(href, documentPath, probe);
  }
  return results;
}
