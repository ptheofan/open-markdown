/**
 * File references in prose and code spans: `src/foo.ts:42`, `README.md`,
 * `path/to/file.ts#L42`, `file.ts:42:7`.
 *
 * Generated markdown is full of these, and a reader wants to click them.
 * Finding them is pure text work shared by the renderer plugin that links
 * them and the tests that pin down what counts. Resolving them against the
 * disk happens in the main process.
 */

export interface FileReference {
  /** The path as written, without any line suffix */
  path: string;
  /** 1-based line, when the reference carries one */
  line: number | null;
  /** 1-based column, when the reference carries one */
  column: number | null;
}

export interface FileReferenceMatch extends FileReference {
  /** Offset of the reference in the scanned text */
  start: number;
  /** Offset just past the reference */
  end: number;
}

/**
 * Extensions a slash-less, line-less name may carry and still read as a file
 * (`README.md`, `package.json`). Without this, `array.map` in a code span
 * would become a link.
 */
const FILE_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'rst',
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift', 'm', 'mm',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cxx', 'cs', 'fs', 'php', 'pl', 'lua', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'zig',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  'sql', 'graphql', 'gql', 'proto', 'xml', 'csv', 'tsv', 'lock', 'ipynb',
  'dockerfile', 'makefile', 'gradle', 'tf', 'hcl', 'nix', 'plist', 'svg',
]);

/**
 * A path: optional `./`, `../`, `~/` or `/` prefix, directories, and a name
 * with an extension, then an optional `:line[:col]` or `#Lline[-Lline]`.
 */
const PATH_PATTERN =
  '((?:\\.{1,2}\\/|~\\/|\\/)?(?:[\\w.@-]+\\/)*[\\w@-][\\w.@-]*\\.([A-Za-z0-9]{1,10}))' +
  '(?::(\\d{1,7})(?::(\\d{1,5}))?|#L(\\d{1,7})(?:-L?\\d{1,7})?)?';

const WHOLE_RE = new RegExp(`^${PATH_PATTERN}$`);
const SCAN_RE = new RegExp(`(?<![\\w./\\\\@:~-])${PATH_PATTERN}(?![\\w/@-])`, 'g');

interface Groups {
  path: string;
  ext: string;
  line: string | undefined;
  column: string | undefined;
  hashLine: string | undefined;
}

function groupsOf(match: RegExpMatchArray): Groups {
  return {
    path: match[1] ?? '',
    ext: match[2] ?? '',
    line: match[3],
    column: match[4],
    hashLine: match[5],
  };
}

function toReference(groups: Groups): FileReference {
  const lineText = groups.line ?? groups.hashLine;
  return {
    path: groups.path,
    line: lineText ? Number(lineText) : null,
    column: groups.column ? Number(groups.column) : null,
  };
}

/**
 * Whether a candidate is plausible as a file: it has a directory part, a
 * line number, or an extension files actually have.
 */
function plausible(groups: Groups): boolean {
  if (groups.path.includes('/')) return true;
  if (groups.line !== undefined || groups.hashLine !== undefined) return true;
  return FILE_EXTENSIONS.has(groups.ext.toLowerCase());
}

/**
 * Read a whole string -- a code span's content -- as one file reference, or
 * null when it is not one.
 */
export function parseFileReference(text: string): FileReference | null {
  const match = WHOLE_RE.exec(text.trim());
  if (!match) return null;
  const groups = groupsOf(match);
  if (!plausible(groups)) return null;
  // A bare version-like token (v1.2) is not a file
  if (/^\d+(\.\d+)+$/.test(groups.path)) return null;
  return toReference(groups);
}

/**
 * Find file references in running text. Stricter than a code span: a
 * reference in prose needs a directory part or a line number, since a word
 * followed by a dot and another word is how sentences end.
 */
export function findFileReferences(text: string): FileReferenceMatch[] {
  const matches: FileReferenceMatch[] = [];
  for (const match of text.matchAll(SCAN_RE)) {
    const groups = groupsOf(match);
    const hasLine = groups.line !== undefined || groups.hashLine !== undefined;
    if (!groups.path.includes('/') && !hasLine) continue;
    // Sentence punctuation right after is fine; a path that is all dots is not
    if (/^\.+$/.test(groups.path)) continue;
    const start = match.index;
    matches.push({ ...toReference(groups), start, end: start + match[0].length });
  }
  return matches;
}
