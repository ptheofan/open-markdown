/**
 * DocumentPathResolver turns pasted text into the absolute path it names.
 */
import { describe, it, expect } from 'vitest';

import {
  cleanPathInput,
  resolveDocumentPath,
} from '@main/services/DocumentPathResolver';

const HOME = '/Users/me';
const DOC = '/Users/me/notes/project/todo.md';

describe('cleanPathInput', () => {
  it('trims whitespace and a trailing newline from a copy', () => {
    expect(cleanPathInput('  /a/b.md\n')).toBe('/a/b.md');
  });

  it('strips quotes wrapped around the whole path', () => {
    expect(cleanPathInput('"/a/my notes/b.md"')).toBe('/a/my notes/b.md');
    expect(cleanPathInput("'/a/b.md'")).toBe('/a/b.md');
  });

  it('leaves a quote that does not wrap the whole path alone', () => {
    expect(cleanPathInput("/a/it's.md")).toBe("/a/it's.md");
  });

  it('unescapes shell-escaped characters', () => {
    expect(cleanPathInput('/a/My\\ Notes/b\\ c.md')).toBe('/a/My Notes/b c.md');
  });

  it('turns a file:// URL into a path', () => {
    expect(cleanPathInput('file:///Users/me/my%20notes/b.md')).toBe(
      '/Users/me/my notes/b.md'
    );
  });

  it('returns an empty string for blank input', () => {
    expect(cleanPathInput('   ')).toBe('');
    expect(cleanPathInput('""')).toBe('');
  });
});

describe('resolveDocumentPath', () => {
  it('returns null for empty input', () => {
    expect(resolveDocumentPath('', DOC, HOME)).toBeNull();
    expect(resolveDocumentPath('  \n', DOC, HOME)).toBeNull();
  });

  it('keeps an absolute path as it is', () => {
    expect(resolveDocumentPath('/x/y/z.md', DOC, HOME)).toEqual({
      filePath: '/x/y/z.md',
      resolvedFrom: 'absolute',
    });
  });

  it('normalizes an absolute path with dot segments', () => {
    expect(resolveDocumentPath('/x/./y/../z.md', DOC, HOME)?.filePath).toBe(
      '/x/z.md'
    );
  });

  it('expands a leading ~ to the home directory', () => {
    expect(resolveDocumentPath('~/docs/a.md', DOC, HOME)).toEqual({
      filePath: '/Users/me/docs/a.md',
      resolvedFrom: 'absolute',
    });
    expect(resolveDocumentPath('~', DOC, HOME)?.filePath).toBe('/Users/me');
  });

  it('does not treat ~user as the home directory', () => {
    expect(resolveDocumentPath('~other/a.md', DOC, HOME)).toEqual({
      filePath: '/Users/me/notes/project/~other/a.md',
      resolvedFrom: 'document',
    });
  });

  it('resolves a relative path from the folder of the current document', () => {
    expect(resolveDocumentPath('sub/spec.md', DOC, HOME)).toEqual({
      filePath: '/Users/me/notes/project/sub/spec.md',
      resolvedFrom: 'document',
    });
    expect(resolveDocumentPath('../design/spec.md', DOC, HOME)).toEqual({
      filePath: '/Users/me/notes/design/spec.md',
      resolvedFrom: 'document',
    });
    expect(resolveDocumentPath('./README.md', DOC, HOME)?.filePath).toBe(
      '/Users/me/notes/project/README.md'
    );
  });

  it('resolves a relative path from home when no document is open', () => {
    expect(resolveDocumentPath('notes/a.md', null, HOME)).toEqual({
      filePath: '/Users/me/notes/a.md',
      resolvedFrom: 'home',
    });
  });

  it('cleans the input before resolving it', () => {
    expect(
      resolveDocumentPath('"../My\\ Docs/a.md"\n', DOC, HOME)?.filePath
    ).toBe('/Users/me/notes/My Docs/a.md');
    expect(resolveDocumentPath('file:///tmp/a.md', DOC, HOME)?.filePath).toBe(
      '/tmp/a.md'
    );
  });
});
