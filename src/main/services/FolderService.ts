/**
 * FolderService - what the folder sidebar lists
 *
 * Directories are read one at a time, when the user expands them, so a
 * folder with thousands of files costs nothing until it is looked at. Names
 * no reader wants to see (`.git`, `node_modules`, build output, hidden
 * entries) are left out, and `.gitignore` files between the opened folder
 * and the listed directory are honoured.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { MARKDOWN_EXTENSIONS } from '@shared/constants';
import type { FolderEntry } from '@shared/types/folder';

/** Directories never shown, whatever the toggle says */
export const DEFAULT_IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.vite',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.DS_Store',
]);

/** Extensions the sidebar treats as documents */
export const FOLDER_MARKDOWN_EXTENSIONS: readonly string[] = [...MARKDOWN_EXTENSIONS, '.mdx'];

/** Names tried, in order, when a folder opens into an empty window */
const DEFAULT_DOCUMENT_NAMES = ['readme.md', 'readme.markdown', 'index.md', 'index.markdown'];

/** Walks stop here so a huge tree never pins the main process */
export const WALK_LIMIT = 20_000;

export interface DirectoryEntryInfo {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

/** Pluggable filesystem, so the rules can be tested without a disk */
export interface FolderProbe {
  readDirectory: (dirPath: string) => Promise<DirectoryEntryInfo[]>;
  /** Contents of a text file, or null when there is none */
  readText: (filePath: string) => Promise<string | null>;
}

export const fsFolderProbe: FolderProbe = {
  async readDirectory(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const result: DirectoryEntryInfo[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        // Follow the link once so a linked folder still lists, but never loop
        try {
          const target = await stat(path.join(dirPath, entry.name));
          result.push({ name: entry.name, isDirectory: target.isDirectory(), isFile: target.isFile() });
        } catch {
          // Dangling link: leave it out
        }
        continue;
      }
      result.push({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile() });
    }
    return result;
  },
  async readText(filePath) {
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  },
};

export function isMarkdownName(name: string): boolean {
  return FOLDER_MARKDOWN_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

export function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

// ---------------------------------------------------------------------------
// .gitignore

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
  /** Pattern had a slash, so it is matched against the whole relative path */
  anchored: boolean;
}

/** Turn one gitignore glob into a regular expression over a posix path */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` any depth including none; trailing `**` anything
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) {
        re += '\\[';
      } else {
        let cls = glob.slice(i + 1, end);
        if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
        re += `[${cls.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else if (ch === '\\' && i + 1 < glob.length) {
      re += glob[i + 1]!.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      i += 1;
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * The rules of one `.gitignore`, matched against paths relative to the
 * folder that holds it. Later rules win over earlier ones, and a `!` rule
 * un-ignores. A pattern without a slash matches a name at any depth; one
 * with a slash is anchored to the folder.
 */
export class IgnoreRules {
  private readonly rules: IgnoreRule[];

  constructor(rules: IgnoreRule[]) {
    this.rules = rules;
  }

  static parse(text: string): IgnoreRules {
    const rules: IgnoreRule[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      let line = rawLine.replace(/(?<!\\)\s+$/, '');
      if (!line || line.startsWith('#')) continue;

      let negated = false;
      if (line.startsWith('!')) {
        negated = true;
        line = line.slice(1);
      } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
        line = line.slice(1);
      }

      let directoryOnly = false;
      if (line.endsWith('/')) {
        directoryOnly = true;
        line = line.slice(0, -1);
      }

      let anchored = false;
      if (line.startsWith('/')) {
        anchored = true;
        line = line.slice(1);
      } else if (line.includes('/')) {
        anchored = true;
      }
      if (!line) continue;

      rules.push({ regex: globToRegExp(line), negated, directoryOnly, anchored });
    }
    return new IgnoreRules(rules);
  }

  get size(): number {
    return this.rules.length;
  }

  /**
   * Whether `relPath` (posix, relative to the ignore file's folder) is
   * ignored: true, false (explicitly un-ignored), or null when no rule
   * mentions it.
   */
  decide(relPath: string, isDirectory: boolean): boolean | null {
    const name = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
    let verdict: boolean | null = null;
    for (const rule of this.rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      const matches = rule.anchored ? rule.regex.test(relPath) : rule.regex.test(name);
      if (matches) verdict = !rule.negated;
    }
    return verdict;
  }
}

/**
 * The `.gitignore` files that apply inside `dirPath`: the one in the root and
 * in each folder down to `dirPath`, deepest first so it takes precedence.
 */
export async function loadIgnoreChain(
  root: string,
  dirPath: string,
  probe: FolderProbe
): Promise<Array<{ base: string; rules: IgnoreRules }>> {
  const chain: Array<{ base: string; rules: IgnoreRules }> = [];
  const rel = path.relative(root, dirPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    // Outside the root: only its own .gitignore applies
    const text = await probe.readText(path.join(dirPath, '.gitignore'));
    if (text) chain.push({ base: dirPath, rules: IgnoreRules.parse(text) });
    return chain;
  }

  const dirs = [root];
  let current = root;
  for (const segment of rel ? rel.split(path.sep) : []) {
    current = path.join(current, segment);
    dirs.push(current);
  }
  for (const dir of dirs.reverse()) {
    const text = await probe.readText(path.join(dir, '.gitignore'));
    if (text) chain.push({ base: dir, rules: IgnoreRules.parse(text) });
  }
  return chain;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Whether an entry is hidden by a `.gitignore` in the chain */
export function ignoredByChain(
  chain: ReadonlyArray<{ base: string; rules: IgnoreRules }>,
  absPath: string,
  isDirectory: boolean
): boolean {
  for (const { base, rules } of chain) {
    const verdict = rules.decide(toPosix(path.relative(base, absPath)), isDirectory);
    if (verdict !== null) return verdict;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Listing

export interface ListDirectoryOptions {
  root: string;
  showAll: boolean;
  probe?: FolderProbe;
}

function compareEntries(a: FolderEntry, b: FolderEntry): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * The entries of one directory the sidebar should show: directories first,
 * then files, each sorted by name. Markdown files only, unless `showAll`.
 */
export async function listDirectory(
  dirPath: string,
  options: ListDirectoryOptions
): Promise<FolderEntry[]> {
  const probe = options.probe ?? fsFolderProbe;
  const chain = await loadIgnoreChain(options.root, dirPath, probe);
  const raw = await probe.readDirectory(dirPath);

  const entries: FolderEntry[] = [];
  for (const info of raw) {
    if (!info.isDirectory && !info.isFile) continue;
    if (DEFAULT_IGNORED_DIRS.has(info.name)) continue;
    if (!options.showAll && isHiddenName(info.name)) continue;
    const absPath = path.join(dirPath, info.name);
    if (ignoredByChain(chain, absPath, info.isDirectory)) continue;

    if (info.isDirectory) {
      entries.push({ name: info.name, path: absPath, kind: 'directory', isMarkdown: false });
    } else {
      const isMarkdown = isMarkdownName(info.name);
      if (!isMarkdown && !options.showAll) continue;
      entries.push({ name: info.name, path: absPath, kind: 'file', isMarkdown });
    }
  }
  return entries.sort(compareEntries);
}

/**
 * Every file under `root` the sidebar would show, as posix paths relative
 * to it, breadth first and capped at `limit` so a huge tree stops early.
 */
export async function walkFolder(
  root: string,
  options: { showAll: boolean; limit?: number; probe?: FolderProbe }
): Promise<string[]> {
  const limit = options.limit ?? WALK_LIMIT;
  const files: string[] = [];
  const queue = [root];
  let visited = 0;

  while (queue.length > 0 && files.length < limit && visited < limit) {
    const dir = queue.shift()!;
    visited++;
    let entries: FolderEntry[];
    try {
      entries = await listDirectory(dir, { root, showAll: options.showAll, probe: options.probe });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        queue.push(entry.path);
      } else {
        files.push(toPosix(path.relative(root, entry.path)));
        if (files.length >= limit) break;
      }
    }
  }
  return files;
}

/**
 * The document a folder opens with: README.md, then index.md (any case),
 * else the first markdown file in the folder itself, else null.
 */
export async function defaultDocument(root: string, probe: FolderProbe = fsFolderProbe): Promise<string | null> {
  const entries = await listDirectory(root, { root, showAll: false, probe });
  const files = entries.filter((entry) => entry.kind === 'file' && entry.isMarkdown);
  for (const wanted of DEFAULT_DOCUMENT_NAMES) {
    const hit = files.find((entry) => entry.name.toLowerCase() === wanted);
    if (hit) return hit.path;
  }
  return files[0]?.path ?? null;
}

export async function isDirectoryPath(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}
