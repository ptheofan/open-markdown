/**
 * Where a path written in a document is looked for.
 */
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  candidateBases,
  findGitRoot,
  resolveFileReference,
  resolveFileReferences,
  type ReferenceProbe,
} from '@main/services/FileReferenceResolver';

function fakeFs(files: string[], dirs: string[]): ReferenceProbe {
  const fileSet = new Set(files.map((f) => path.normalize(f)));
  const dirSet = new Set(dirs.map((d) => path.normalize(d)));
  return {
    isFile: (p) => Promise.resolve(fileSet.has(path.normalize(p))),
    isDirectory: (p) => Promise.resolve(dirSet.has(path.normalize(p))),
  };
}

const DOC = '/repo/docs/plans/plan.md';

describe('findGitRoot', () => {
  it('walks up to the folder holding .git', async () => {
    const probe = fakeFs([], ['/repo/.git']);
    expect(await findGitRoot('/repo/docs/plans', probe)).toBe('/repo');
  });

  it('returns null when there is none', async () => {
    expect(await findGitRoot('/tmp/x/y', fakeFs([], []))).toBeNull();
  });
});

describe('candidateBases', () => {
  it('is the document folder, then each ancestor up to the root', () => {
    expect(candidateBases('/repo/docs/plans', '/repo')).toEqual(['/repo/docs/plans', '/repo/docs', '/repo']);
  });

  it('is only the document folder without a root', () => {
    expect(candidateBases('/repo/docs', null)).toEqual(['/repo/docs']);
  });

  it('adds a root that is not an ancestor at the end', () => {
    expect(candidateBases('/elsewhere/x', '/repo')).toEqual(
      expect.arrayContaining(['/elsewhere/x', '/repo'])
    );
    expect(candidateBases('/elsewhere/x', '/repo').at(-1)).toBe('/repo');
  });
});

describe('resolveFileReference', () => {
  it('prefers the document folder', async () => {
    const probe = fakeFs(['/repo/docs/plans/a.md', '/repo/a.md'], ['/repo/.git']);
    expect(await resolveFileReference('a.md', DOC, { probe })).toBe('/repo/docs/plans/a.md');
  });

  it('falls back to the project root for repo-relative paths', async () => {
    const probe = fakeFs(['/repo/src/app.ts'], ['/repo/.git']);
    expect(await resolveFileReference('src/app.ts', DOC, { probe })).toBe('/repo/src/app.ts');
  });

  it('uses the configured project root over .git', async () => {
    const probe = fakeFs(['/work/src/app.ts'], ['/repo/.git']);
    expect(await resolveFileReference('src/app.ts', DOC, { probe, projectRoot: '/work' })).toBe('/work/src/app.ts');
  });

  it('resolves ../ relative to the document', async () => {
    const probe = fakeFs(['/repo/docs/spec.md'], []);
    expect(await resolveFileReference('../spec.md', DOC, { probe })).toBe('/repo/docs/spec.md');
  });

  it('resolves ~/ against the home folder and absolute paths as they are', async () => {
    const probe = fakeFs(['/home/me/n.md', '/etc/hosts.conf'], []);
    expect(await resolveFileReference('~/n.md', DOC, { probe, home: '/home/me' })).toBe('/home/me/n.md');
    expect(await resolveFileReference('/etc/hosts.conf', DOC, { probe })).toBe('/etc/hosts.conf');
  });

  it('returns null for a missing file and for a directory', async () => {
    const probe = fakeFs([], ['/repo/.git', '/repo/src']);
    expect(await resolveFileReference('nope.ts', DOC, { probe })).toBeNull();
    expect(await resolveFileReference('src', DOC, { probe })).toBeNull();
  });
});

describe('resolveFileReferences', () => {
  it('resolves each distinct reference once, keyed as written', async () => {
    const probe = fakeFs(['/repo/src/app.ts'], ['/repo/.git']);
    const result = await resolveFileReferences(['src/app.ts', 'src/app.ts', 'missing.md'], DOC, { probe });
    expect(result).toEqual({ 'src/app.ts': '/repo/src/app.ts', 'missing.md': null });
  });
});
