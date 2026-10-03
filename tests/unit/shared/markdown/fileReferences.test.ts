/**
 * Spotting file references in code spans and prose.
 */
import { describe, it, expect } from 'vitest';
import { findFileReferences, parseFileReference } from '@shared/markdown/fileReferences';

describe('parseFileReference (whole code span)', () => {
  it('reads a path with a line and column', () => {
    expect(parseFileReference('src/foo.ts:42:7')).toEqual({ path: 'src/foo.ts', line: 42, column: 7 });
  });

  it('reads GitHub-style #L lines, ignoring a range end', () => {
    expect(parseFileReference('path/to/file.ts#L42')).toEqual({ path: 'path/to/file.ts', line: 42, column: null });
    expect(parseFileReference('path/to/file.ts#L42-L50')).toEqual({ path: 'path/to/file.ts', line: 42, column: null });
  });

  it('accepts ./, ../, ~/ and absolute prefixes', () => {
    expect(parseFileReference('./a.md')?.path).toBe('./a.md');
    expect(parseFileReference('../docs/plan.md')?.path).toBe('../docs/plan.md');
    expect(parseFileReference('~/notes/x.md')?.path).toBe('~/notes/x.md');
    expect(parseFileReference('/etc/hosts.conf')?.path).toBe('/etc/hosts.conf');
  });

  it('accepts a bare name with a file-like extension', () => {
    expect(parseFileReference('README.md')).toEqual({ path: 'README.md', line: null, column: null });
    expect(parseFileReference('package.json')?.path).toBe('package.json');
    expect(parseFileReference('.env')).toBeNull();
  });

  it('rejects things that merely contain a dot', () => {
    expect(parseFileReference('array.map')).toBeNull();
    expect(parseFileReference('foo.bar')).toBeNull();
    expect(parseFileReference('e.g.')).toBeNull();
    expect(parseFileReference('1.2.3')).toBeNull();
    expect(parseFileReference('console.log(x)')).toBeNull();
    expect(parseFileReference('a b.md')).toBeNull();
  });

  it('accepts an unknown extension when a line number makes it a file', () => {
    expect(parseFileReference('weird.xyz:3')).toEqual({ path: 'weird.xyz', line: 3, column: null });
  });
});

describe('findFileReferences (prose)', () => {
  it('finds paths with a directory part', () => {
    const matches = findFileReferences('See src/foo.ts:42 and docs/plan.md for details.');
    expect(matches.map((m) => [m.path, m.line])).toEqual([
      ['src/foo.ts', 42],
      ['docs/plan.md', null],
    ]);
    expect('See src/foo.ts:42 and docs/plan.md for details.'.slice(matches[0]!.start, matches[0]!.end)).toBe('src/foo.ts:42');
  });

  it('needs a directory or a line for a bare name', () => {
    expect(findFileReferences('Edit README.md first.')).toEqual([]);
    expect(findFileReferences('Edit README.md:3 first.')).toHaveLength(1);
  });

  it('ignores URLs, emails and version numbers', () => {
    expect(findFileReferences('https://example.com/a/b.ts and me@host.io and v1.2.3')).toEqual([]);
    expect(findFileReferences('npm:lodash/fp.js')).toEqual([]);
  });

  it('stops before sentence punctuation', () => {
    const [m] = findFileReferences('Open src/a.ts.');
    expect(m?.path).toBe('src/a.ts');
  });

  it('does not start a match right after a colon', () => {
    expect(findFileReferences('ref:src/a.ts')).toEqual([]);
  });
});
