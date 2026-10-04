/**
 * FolderService: what the folder sidebar lists, and what it leaves out
 */
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  IgnoreRules,
  defaultDocument,
  ignoredByChain,
  isMarkdownName,
  listDirectory,
  loadIgnoreChain,
  walkFolder,
  type DirectoryEntryInfo,
  type FolderProbe,
} from '@main/services/FolderService';

/** An in-memory tree: directories map names to children, files to contents */
type Node = string | Tree;
interface Tree {
  [name: string]: Node;
}

function makeProbe(tree: Tree, root = '/repo'): FolderProbe {
  const lookup = (target: string): Node | undefined => {
    const rel = path.relative(root, target);
    if (rel === '') return tree;
    let node: Node = tree;
    for (const part of rel.split(path.sep)) {
      if (typeof node === 'string') return undefined;
      const next: Node | undefined = node[part];
      if (next === undefined) return undefined;
      node = next;
    }
    return node;
  };
  return {
    readDirectory: (dirPath) => {
      const node = lookup(dirPath);
      if (node === undefined || typeof node === 'string') return Promise.reject(new Error('ENOENT'));
      const entries: DirectoryEntryInfo[] = Object.entries(node).map(([name, child]) => ({
        name,
        isDirectory: typeof child !== 'string',
        isFile: typeof child === 'string',
      }));
      return Promise.resolve(entries);
    },
    readText: (filePath) => {
      const node = lookup(filePath);
      return Promise.resolve(typeof node === 'string' ? node : null);
    },
  };
}

const names = (entries: Array<{ name: string }>): string[] => entries.map((e) => e.name);

describe('IgnoreRules', () => {
  it('matches names at any depth and anchored paths at the root', () => {
    const rules = IgnoreRules.parse(['*.log', '/build', 'docs/drafts', '# comment', ''].join('\n'));
    expect(rules.size).toBe(3);
    expect(rules.decide('a.log', false)).toBe(true);
    expect(rules.decide('deep/er/b.log', false)).toBe(true);
    expect(rules.decide('build', true)).toBe(true);
    expect(rules.decide('src/build', true)).toBeNull();
    expect(rules.decide('docs/drafts', true)).toBe(true);
    expect(rules.decide('other/docs/drafts', true)).toBeNull();
  });

  it('applies directory-only rules to directories, and lets the last rule win', () => {
    const rules = IgnoreRules.parse(['tmp/', '*.md', '!README.md'].join('\n'));
    expect(rules.decide('tmp', true)).toBe(true);
    expect(rules.decide('tmp', false)).toBeNull();
    expect(rules.decide('notes.md', false)).toBe(true);
    expect(rules.decide('README.md', false)).toBe(false);
  });

  it('understands **, ? and character classes', () => {
    const rules = IgnoreRules.parse(['**/generated', 'out/**', 'v?.md', '[ab].md'].join('\n'));
    expect(rules.decide('generated', true)).toBe(true);
    expect(rules.decide('x/y/generated', true)).toBe(true);
    expect(rules.decide('out/deep/file.md', false)).toBe(true);
    expect(rules.decide('v1.md', false)).toBe(true);
    expect(rules.decide('v12.md', false)).toBeNull();
    expect(rules.decide('a.md', false)).toBe(true);
    expect(rules.decide('c.md', false)).toBeNull();
  });
});

describe('listDirectory', () => {
  const tree: Tree = {
    'README.md': '# hi',
    'notes.markdown': '',
    'page.mdx': '',
    'image.png': '',
    '.hidden.md': '',
    '.gitignore': 'drafts/\nsecret-*.md\n',
    'secret-plan.md': '',
    node_modules: { 'x.md': '' },
    '.git': { HEAD: '' },
    dist: {},
    drafts: { 'wip.md': '' },
    docs: {
      '.gitignore': '!secret-ok.md\n',
      'guide.md': '',
      'secret-ok.md': '',
      'secret-no.md': '',
      api: { 'index.md': '' },
    },
    zeta: {},
    Alpha: {},
  };
  const probe = makeProbe(tree);

  it('lists directories first, then markdown files, sorted by name without case', async () => {
    const entries = await listDirectory('/repo', { root: '/repo', showAll: false, probe });
    expect(names(entries)).toEqual(['Alpha', 'docs', 'zeta', 'notes.markdown', 'page.mdx', 'README.md']);
    expect(entries[0]).toEqual({ name: 'Alpha', path: '/repo/Alpha', kind: 'directory', isMarkdown: false });
    expect(entries.find((e) => e.name === 'README.md')?.isMarkdown).toBe(true);
  });

  it('shows other files and hidden entries behind the toggle, but never build output', async () => {
    const entries = await listDirectory('/repo', { root: '/repo', showAll: true, probe });
    expect(names(entries)).toContain('image.png');
    expect(names(entries)).toContain('.hidden.md');
    expect(names(entries)).toContain('.gitignore');
    expect(names(entries)).not.toContain('node_modules');
    expect(names(entries)).not.toContain('.git');
    expect(names(entries)).not.toContain('dist');
    expect(entries.find((e) => e.name === 'image.png')?.isMarkdown).toBe(false);
  });

  it('honours .gitignore files from the root down, with nested negation', async () => {
    const root = await listDirectory('/repo', { root: '/repo', showAll: false, probe });
    expect(names(root)).not.toContain('drafts');
    expect(names(root)).not.toContain('secret-plan.md');

    const docs = await listDirectory('/repo/docs', { root: '/repo', showAll: false, probe });
    expect(names(docs)).toEqual(['api', 'guide.md', 'secret-ok.md']);
  });

  it('builds the ignore chain deepest first', async () => {
    const chain = await loadIgnoreChain('/repo', '/repo/docs/api', probe);
    expect(chain.map((c) => c.base)).toEqual(['/repo/docs', '/repo']);
    expect(ignoredByChain(chain, '/repo/docs/api/secret-x.md', false)).toBe(true);
    expect(ignoredByChain(chain, '/repo/docs/api/secret-ok.md', false)).toBe(false);
    expect(ignoredByChain(chain, '/repo/docs/api/index.md', false)).toBe(false);
  });
});

describe('walkFolder', () => {
  const tree: Tree = {
    'README.md': '',
    a: { 'one.md': '', b: { 'two.md': '', 'skip.txt': '' } },
    node_modules: { 'x.md': '' },
  };
  const probe = makeProbe(tree);

  it('lists every document relative to the root, breadth first', async () => {
    const files = await walkFolder('/repo', { showAll: false, probe });
    expect(files).toEqual(['README.md', 'a/one.md', 'a/b/two.md']);
  });

  it('stops at the limit', async () => {
    const files = await walkFolder('/repo', { showAll: true, limit: 2, probe });
    expect(files).toHaveLength(2);
  });
});

describe('defaultDocument', () => {
  it('prefers README, then index, then the first document', async () => {
    const probe = makeProbe({ 'zzz.md': '', 'index.md': '', 'Readme.MD': '' });
    expect(await defaultDocument('/repo', probe)).toBe('/repo/Readme.MD');
    expect(await defaultDocument('/repo', makeProbe({ 'zzz.md': '', 'index.md': '' }))).toBe('/repo/index.md');
    expect(await defaultDocument('/repo', makeProbe({ 'zzz.md': '', 'aaa.md': '' }))).toBe('/repo/aaa.md');
    expect(await defaultDocument('/repo', makeProbe({ 'a.png': '', sub: { 'x.md': '' } }))).toBeNull();
  });
});

describe('isMarkdownName', () => {
  it('accepts the markdown extensions and mdx', () => {
    expect(isMarkdownName('a.md')).toBe(true);
    expect(isMarkdownName('a.MDX')).toBe(true);
    expect(isMarkdownName('a.markdown')).toBe(true);
    expect(isMarkdownName('a.txt')).toBe(false);
  });
});
