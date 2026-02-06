/**
 * GithubFlavoredPlugin unit tests
 */
import {
  GithubFlavoredPlugin,
  createGithubFlavoredPlugin,
} from '@plugins/builtin/GithubFlavoredPlugin';
import { MarkdownRenderer } from '@plugins/core/MarkdownRenderer';
import { BUILTIN_PLUGINS } from '@shared/constants';
import { describe, it, expect, beforeEach } from 'vitest';

describe('GithubFlavoredPlugin', () => {
  let plugin: GithubFlavoredPlugin;
  let renderer: MarkdownRenderer;

  beforeEach(async () => {
    plugin = new GithubFlavoredPlugin();
    renderer = new MarkdownRenderer();
    await renderer.registerPlugin(plugin);
  });

  describe('metadata', () => {
    it('should have correct plugin id', () => {
      expect(plugin.metadata.id).toBe(BUILTIN_PLUGINS.GITHUB_FLAVORED);
    });

    it('should have name', () => {
      expect(plugin.metadata.name).toBe('GitHub Flavored Markdown');
    });

    it('should have version', () => {
      expect(plugin.metadata.version).toBe('1.0.0');
    });

    it('should have description', () => {
      expect(plugin.metadata.description).toContain('GitHub Flavored Markdown');
    });
  });

  describe('createGithubFlavoredPlugin', () => {
    it('should create a new GithubFlavoredPlugin instance', () => {
      const p = createGithubFlavoredPlugin();
      expect(p).toBeInstanceOf(GithubFlavoredPlugin);
    });
  });

  describe('strikethrough', () => {
    it('should render ~~text~~ as strikethrough', () => {
      const result = renderer.render('~~deleted~~');
      expect(result).toContain('<del>deleted</del>');
    });

    it('should render strikethrough within a sentence', () => {
      const result = renderer.render('This is ~~not~~ correct');
      expect(result).toContain('<del>not</del>');
    });

    it('should not render single tilde as strikethrough', () => {
      const result = renderer.render('~not deleted~');
      expect(result).not.toContain('<del>');
    });

    it('should handle empty strikethrough markers', () => {
      const result = renderer.render('~~~~ empty');
      // Should not crash and not produce empty <del> tags
      expect(result).not.toContain('<del></del>');
    });

    it('should render multiple strikethroughs in the same line', () => {
      const result = renderer.render('~~one~~ and ~~two~~');
      expect(result).toContain('<del>one</del>');
      expect(result).toContain('<del>two</del>');
    });
  });

  describe('task lists', () => {
    it('should render unchecked task - [ ]', () => {
      const result = renderer.render('- [ ] Task item');
      expect(result).toContain('class="task-list-item"');
      expect(result).toContain('type="checkbox"');
      expect(result).not.toContain('checked');
    });

    it('should render checked task - [x]', () => {
      const result = renderer.render('- [x] Completed task');
      expect(result).toContain('class="task-list-item"');
      expect(result).toContain('checked');
    });

    it('should render checked task with uppercase - [X]', () => {
      const result = renderer.render('- [X] Completed task');
      expect(result).toContain('class="task-list-item"');
      expect(result).toContain('checked');
    });

    it('should render checkboxes as disabled', () => {
      const result = renderer.render('- [ ] Task');
      expect(result).toContain('disabled');
    });

    it('should handle mixed task list', () => {
      const result = renderer.render('- [ ] Todo\n- [x] Done\n- [ ] Another todo');
      expect(result).toContain('class="task-list-checkbox"');
      // Count checkboxes
      const checkboxCount = (result.match(/type="checkbox"/g) || []).length;
      expect(checkboxCount).toBe(3);
    });

    it('should preserve task text after checkbox', () => {
      const result = renderer.render('- [ ] Buy groceries');
      expect(result).toContain('Buy groceries');
    });

    it('should not affect regular list items', () => {
      const result = renderer.render('- Regular item');
      expect(result).not.toContain('type="checkbox"');
      expect(result).toContain('Regular item');
    });
  });

  describe('tables', () => {
    it('should render basic table', () => {
      const markdown = `
| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |
`;
      const result = renderer.render(markdown);
      expect(result).toContain('<table');
      expect(result).toContain('<th>');
      expect(result).toContain('<td>');
    });

    it('should render table headers', () => {
      const markdown = `
| Name | Age |
| ---- | --- |
| John | 30  |
`;
      const result = renderer.render(markdown);
      expect(result).toContain('<th>Name</th>');
      expect(result).toContain('<th>Age</th>');
    });

    it('should render table cells', () => {
      const markdown = `
| A | B |
| - | - |
| 1 | 2 |
`;
      const result = renderer.render(markdown);
      expect(result).toContain('<td>1</td>');
      expect(result).toContain('<td>2</td>');
    });
  });

  describe('getStyles', () => {
    it('should return CSS styles', () => {
      const styles = plugin.getStyles();
      expect(typeof styles).toBe('string');
    });

    it('should include task list styles', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain('.task-list-item');
      expect(styles).toContain('.task-list-checkbox');
    });

    it('should include strikethrough styles', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain('del');
      expect(styles).toContain('line-through');
    });

    it('should include table styles', () => {
      const styles = plugin.getStyles();
      expect(styles).toContain('table');
      expect(styles).toContain('border');
    });
  });

  describe('integration with MarkdownRenderer', () => {
    it('should be registerable with MarkdownRenderer', async () => {
      const r = new MarkdownRenderer();
      const p = new GithubFlavoredPlugin();
      await r.registerPlugin(p);
      expect(r.hasPlugin(BUILTIN_PLUGINS.GITHUB_FLAVORED)).toBe(true);
    });

    it('should combine features', () => {
      const markdown = `
# Title

~~strikethrough~~

- [ ] Task 1
- [x] Task 2

| Col 1 | Col 2 |
| ----- | ----- |
| A     | B     |
`;
      const result = renderer.render(markdown);
      expect(result).toContain('<del>strikethrough</del>');
      expect(result).toContain('type="checkbox"');
      expect(result).toContain('<table');
    });
  });
});
