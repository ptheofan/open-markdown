/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSyncReviewDialog } from '@renderer/components/SyncReviewDialog';
import type { SyncReviewDialog } from '@renderer/components/SyncReviewDialog';
import type { SyncChange } from '@shared/types/google-docs';

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  el.click();
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

/** One local-only edit and one remote-only edit over a three-block document. */
const CHANGES: SyncChange[] = [
  { index: 0, kind: 'local-only', local: 'one MINE', remote: 'one', choice: 'local' },
  { index: 2, kind: 'remote-only', local: 'three', remote: 'three THEIRS', choice: 'remote' },
];
const BLOCKS = ['one MINE', 'two', 'three THEIRS'];

describe('SyncReviewDialog', () => {
  let dialog: SyncReviewDialog;

  beforeEach(() => {
    document.body.innerHTML = '';
    dialog = createSyncReviewDialog();
  });

  afterEach(() => {
    dialog.destroy();
  });

  describe('the three panes', () => {
    it('shows one row per block, not only the changed ones', () => {
      void dialog.review(CHANGES, BLOCKS, 'push');
      expect(document.querySelectorAll('[data-block]')).toHaveLength(3);
      expect(document.querySelectorAll('[data-change]')).toHaveLength(2);
    });

    it('puts each side in its own pane', () => {
      void dialog.review(CHANGES, BLOCKS, 'push');
      expect(text('[data-change="0"] .sync-merge-left')).toBe('one MINE');
      expect(text('[data-change="0"] .sync-merge-right')).toBe('one');
    });

    it('says so plainly when a side has nothing at that position', () => {
      void dialog.review(
        [{ index: 0, kind: 'remote-only', local: '', remote: 'added', choice: 'remote' }],
        ['added'],
        'pull',
      );
      expect(text('[data-change="0"] .sync-merge-left')).toBe('(nothing here)');
    });

    it('renders the result as markdown, not as source', () => {
      void dialog.review(
        [{ index: 0, kind: 'local-only', local: '# Heading', remote: 'plain', choice: 'local' }],
        ['# Heading'],
        'push',
      );
      expect(document.querySelector('[data-change="0"] .sync-merge-result h1')).not.toBeNull();
    });

    it('renders an unchanged row in the result pane too', () => {
      void dialog.review(CHANGES, BLOCKS, 'push');
      const same = document.querySelector('.sync-merge-row-same .sync-merge-result');
      expect(same?.textContent).toContain('two');
    });
  });

  describe('choosing', () => {
    it('re-renders the result when a gutter arrow is used', () => {
      void dialog.review(CHANGES, BLOCKS, 'push');
      click('[data-change="1"] [data-accept="local"]');
      expect(text('[data-change="1"] .sync-merge-result')).toContain('three');
      expect(text('[data-change="1"] .sync-merge-result')).not.toContain('THEIRS');
    });

    it('keeps both sides when asked', () => {
      void dialog.review(CHANGES, BLOCKS, 'push');
      click('[data-change="0"] [data-accept="both"]');
      const result = text('[data-change="0"] .sync-merge-result');
      expect(result).toContain('one MINE');
      expect(result).toContain('one');
    });

    it('marks which side is currently in the result', () => {
      void dialog.review(CHANGES, BLOCKS, 'push');
      click('[data-change="0"] [data-accept="remote"]');
      expect(document.querySelector('[data-change="0"] [data-accept="remote"]')
        ?.getAttribute('aria-pressed')).toBe('true');
      expect(document.querySelector('[data-change="0"] [data-accept="local"]')
        ?.getAttribute('aria-pressed')).toBe('false');
    });

    it('offers no whole-file button for the side that is not the source', () => {
      // On a push that would be a pull, which is the other toolbar button.
      void dialog.review(CHANGES, BLOCKS, 'push');
      expect(document.querySelector('[data-bulk]')).toBeNull();
    });

    it('drops every exception back to the source of truth', async () => {
      const done = dialog.review(CHANGES, BLOCKS, 'push');
      click('[data-change="0"] [data-accept="remote"]');
      click('[data-change="1"] [data-accept="both"]');
      click('[data-reset]');
      click('[data-action="apply"]');

      await expect(done).resolves.toEqual({
        markdown: 'one MINE\n\ntwo\n\nthree THEIRS\n',
        deviates: false,
      });
    });

    it('names the direction rather than calling it a merge', () => {
      void dialog.review(CHANGES, BLOCKS, 'pull');
      expect(text('.sync-merge-title')).toBe('Pull from Google Doc');
      expect(text('[data-reset]')).toBe('Use the Doc throughout');
    });

    it('reports no deviation when every default is left as it stands', async () => {
      // Nothing was overridden, so the side the user was not syncing towards
      // already holds this and must not be written to.
      const done = dialog.review(CHANGES, BLOCKS, 'push');
      click('[data-action="apply"]');
      await expect(done).resolves.toMatchObject({ deviates: false });
    });

    it('resolves with null when cancelled', async () => {
      const done = dialog.review(CHANGES, BLOCKS, 'push');
      click('[data-action="cancel"]');
      await expect(done).resolves.toBeNull();
    });
  });

  describe('leaving the file alone', () => {
    it('returns the original text when the result matches it', async () => {
      // The file has no blank line between the heading and its paragraph.
      // Rebuilding from blocks would insert one, so accepting nothing from
      // the Doc would still rewrite the file.
      const original = '# Title\nProse\n';
      const done = dialog.review(
        [{ index: 1, kind: 'remote-only', local: 'Prose', remote: 'Prose EDITED', choice: 'remote' }],
        ['# Title', 'Prose EDITED'],
        'pull',
        original,
      );
      click('[data-change="0"] [data-accept="local"]');
      click('[data-action="apply"]');
      await expect(done).resolves.toMatchObject({ markdown: original });
    });

    it('still rebuilds when the result really differs', async () => {
      const done = dialog.review(
        [{ index: 1, kind: 'remote-only', local: 'Prose', remote: 'Prose EDITED', choice: 'remote' }],
        ['# Title', 'Prose EDITED'],
        'pull',
        '# Title\nProse\n',
      );
      click('[data-action="apply"]');
      await expect(done).resolves.toMatchObject({ markdown: '# Title\n\nProse EDITED\n' });
    });
  });

  describe('navigation', () => {
    it('steps to a change and marks it as current', () => {
      void dialog.review(CHANGES, BLOCKS, 'push');
      click('[data-nav="next"]');
      expect(document.querySelector('.sync-merge-row-current')?.getAttribute('data-change')).toBe('0');
      click('[data-nav="next"]');
      expect(document.querySelector('.sync-merge-row-current')?.getAttribute('data-change')).toBe('1');
    });

    it('counts the changes and the ones needing a decision', () => {
      void dialog.review(
        [
          { index: 0, kind: 'conflict', local: 'a', remote: 'b', choice: 'local' },
          { index: 1, kind: 'local-only', local: 'c', remote: 'd', choice: 'local' },
        ],
        ['a', 'c'],
        'push',
      );
      expect(text('.sync-merge-summary')).toBe('2 changes · 1 needing a decision');
    });
  });

  it('renders Doc text as text, never as markup', () => {
    void dialog.review(
      [{ index: 0, kind: 'remote-only', local: 'safe', remote: '<img src=x onerror=alert(1)>', choice: 'remote' }],
      ['<img src=x onerror=alert(1)>'],
      'pull',
    );
    expect(document.querySelector('.sync-merge-right img')).toBeNull();
    expect(document.querySelector('.sync-merge-result img')).toBeNull();
    expect(text('[data-change="0"] .sync-merge-right')).toContain('<img');
  });
});
