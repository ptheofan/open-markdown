/**
 * FrontMatterPlugin: the metadata block at the top of generated documents.
 */
import { FrontMatterPlugin, frontMatterBlockRule } from '@plugins/builtin/FrontMatterPlugin';
import { MarkdownRenderer } from '@plugins/core/MarkdownRenderer';
import { BUILTIN_PLUGINS } from '@shared/constants';
import MarkdownIt from 'markdown-it';
import { describe, it, expect, beforeEach } from 'vitest';

const SKILL = [
  '---',
  'name: deploy',
  'description: Ship the thing',
  'tags:',
  '  - ops',
  '  - release',
  'allowed-tools: Bash(git:*)',
  'meta:',
  '  version: 2',
  '  draft: false',
  '---',
  '',
  '# Deploy',
  '',
  'Body text.',
].join('\n');

describe('FrontMatterPlugin', () => {
  let renderer: MarkdownRenderer;
  let plugin: FrontMatterPlugin;

  beforeEach(async () => {
    plugin = new FrontMatterPlugin();
    renderer = new MarkdownRenderer();
    await renderer.registerPlugin(plugin);
  });

  it('has the front-matter plugin id', () => {
    expect(plugin.metadata.id).toBe(BUILTIN_PLUGINS.FRONT_MATTER);
  });

  it('renders YAML front matter as a collapsible table', () => {
    const html = renderer.render(SKILL);
    expect(html).toContain('<details class="front-matter" data-source-lines="0-11" open>');
    expect(html).toContain('Front matter<span class="front-matter-count">5 fields</span>');
    expect(html).toContain('<th scope="row">name</th><td><span class="front-matter-scalar front-matter-string">deploy</span></td>');
    expect(html).toContain('<th scope="row">allowed-tools</th>');
    expect(html).not.toContain('<hr');
  });

  it('nests lists and mappings', () => {
    const html = renderer.render(SKILL);
    expect(html).toContain('<ul class="front-matter-list"><li><span class="front-matter-scalar front-matter-string">ops</span></li>');
    expect(html).toContain('<th scope="row">meta</th><td><table class="front-matter-table">');
    expect(html).toContain('<span class="front-matter-scalar front-matter-number">2</span>');
    expect(html).toContain('<span class="front-matter-scalar front-matter-boolean">false</span>');
  });

  it('leaves the rest of the document, and its source lines, intact', () => {
    const html = renderer.render(SKILL);
    expect(html).toContain('<h1 data-source-lines="12-13">Deploy</h1>');
    expect(html).toContain('<p data-source-lines="14-15">Body text.</p>');
  });

  it('escapes values', () => {
    const html = renderer.render('---\ntitle: "<b>x</b> & y"\n---\n');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(html).not.toContain('<b>x</b>');
  });

  it('renders multi-line strings in a pre and nulls as a dash', () => {
    const html = renderer.render('---\nnotes: |\n  one\n  two\nempty:\n---\n');
    expect(html).toContain('<pre class="front-matter-text">one\ntwo');
    expect(html).toContain('<span class="front-matter-null">–</span>');
  });

  it('accepts ... as the YAML closer', () => {
    const html = renderer.render('---\na: 1\n...\n\ntext');
    expect(html).toContain('class="front-matter"');
    expect(html).toContain('<p data-source-lines="4-5">text</p>');
  });

  it('shows TOML front matter raw', () => {
    const html = renderer.render('+++\ntitle = "x"\n+++\n\ntext');
    expect(html).toContain('front-matter-count">TOML</span>');
    expect(html).toContain('<pre class="front-matter-raw">title = &quot;x&quot;</pre>');
  });

  it('is not fooled by a horizontal rule followed by prose and another rule', () => {
    const html = renderer.render('---\n\nJust a paragraph here.\n\n---\n');
    expect(html).not.toContain('front-matter');
    expect(html.match(/<hr/g)?.length).toBe(2);
  });

  it('ignores a block that is not valid YAML', () => {
    const html = renderer.render('---\n: : :\n  - [\n---\n');
    expect(html).not.toContain('front-matter');
  });

  it('only recognises front matter on the first line', () => {
    const html = renderer.render('# Title\n\n---\na: 1\n---\n');
    expect(html).not.toContain('front-matter');
  });

  it('ignores an unterminated block', () => {
    const html = renderer.render('---\na: 1\n\ntext');
    expect(html).not.toContain('front-matter');
  });

  it('starts collapsed when the preference says so', () => {
    plugin.onPreferencesChange({ expanded: false });
    const html = renderer.render('---\na: 1\n---\n');
    expect(html).toContain('<details class="front-matter" data-source-lines="0-3">');
    expect(html).not.toContain(' open>');
  });

  it('declares its preference and styles', () => {
    expect(plugin.getPreferencesSchema().sections[0]?.fields[0]?.key).toBe('expanded');
    expect(plugin.getStyles()).toContain('.front-matter-table');
  });
});

describe('frontMatterBlockRule alone', () => {
  it('turns the block into one token with its source map', () => {
    const md = new MarkdownIt();
    frontMatterBlockRule(md);
    const tokens = md.parse('---\na: 1\n---\n\n# T', {});
    expect(tokens[0]?.type).toBe('front_matter');
    expect(tokens[0]?.map).toEqual([0, 3]);
    expect(tokens[1]?.type).toBe('heading_open');
  });
});
