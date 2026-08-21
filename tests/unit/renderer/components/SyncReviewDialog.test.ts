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

/** One local-only edit and one remote-only edit, over a three-block document. */
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

  it('shows every change, not only the conflicting ones', () => {
    void dialog.review(CHANGES, BLOCKS);
    expect(document.querySelectorAll('[data-change]')).toHaveLength(2);
  });

  it('previews the defaults before the user touches anything', () => {
    void dialog.review(CHANGES, BLOCKS);
    expect(text('.sync-review-preview-text')).toBe('one MINE\n\ntwo\n\nthree THEIRS\n');
  });

  it('re-previews when one change is flipped', () => {
    void dialog.review(CHANGES, BLOCKS);
    click('[data-change="1"] [data-choice="local"]');
    expect(text('.sync-review-preview-text')).toBe('one MINE\n\ntwo\n\nthree\n');
  });

  it('keeps both sides of a change when asked', () => {
    void dialog.review(CHANGES, BLOCKS);
    click('[data-change="0"] [data-choice="both"]');
    expect(text('.sync-review-preview-text')).toBe('one MINE\n\none\n\ntwo\n\nthree THEIRS\n');
  });

  it('makes the whole file match the Doc in one click', () => {
    void dialog.review(CHANGES, BLOCKS);
    click('[data-bulk="remote"]');
    expect(text('.sync-review-preview-text')).toBe('one\n\ntwo\n\nthree THEIRS\n');
  });

  it('makes the whole file win in one click', () => {
    void dialog.review(CHANGES, BLOCKS);
    click('[data-bulk="local"]');
    expect(text('.sync-review-preview-text')).toBe('one MINE\n\ntwo\n\nthree\n');
  });

  it('resolves with the previewed markdown when applied', async () => {
    const done = dialog.review(CHANGES, BLOCKS);
    click('[data-bulk="remote"]');
    click('[data-action="apply"]');
    await expect(done).resolves.toBe('one\n\ntwo\n\nthree THEIRS\n');
  });

  it('resolves with null when cancelled', async () => {
    const done = dialog.review(CHANGES, BLOCKS);
    click('[data-action="cancel"]');
    await expect(done).resolves.toBeNull();
  });

  it('marks which choice is active', () => {
    void dialog.review(CHANGES, BLOCKS);
    click('[data-change="0"] [data-choice="remote"]');
    const remote = document.querySelector('[data-change="0"] [data-choice="remote"]');
    const local = document.querySelector('[data-change="0"] [data-choice="local"]');
    expect(remote?.getAttribute('aria-pressed')).toBe('true');
    expect(local?.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders Doc text as text, never as markup', () => {
    void dialog.review(
      [{ index: 0, kind: 'remote-only', local: 'safe', remote: '<img src=x onerror=alert(1)>', choice: 'remote' }],
      ['<img src=x onerror=alert(1)>'],
    );
    expect(document.querySelector('.sync-review-side img')).toBeNull();
    expect(text('[data-change="0"] .sync-review-remote')).toContain('<img');
  });
});
