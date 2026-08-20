/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSyncConflictDialog } from '@renderer/components/SyncConflictDialog';
import type { SyncConflictDialog } from '@renderer/components/SyncConflictDialog';

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  el.click();
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

describe('SyncConflictDialog', () => {
  let dialog: SyncConflictDialog;

  beforeEach(() => {
    document.body.innerHTML = '';
    dialog = createSyncConflictDialog();
  });

  afterEach(() => {
    dialog.destroy();
  });

  describe('choosing a direction', () => {
    it('resolves with the mode the user picked', async () => {
      const choice = dialog.chooseMode();
      click('[data-action="merge"]');
      await expect(choice).resolves.toBe('merge');
    });

    it('offers all three directions', () => {
      void dialog.chooseMode();
      expect(document.querySelector('[data-action="merge"]')).not.toBeNull();
      expect(document.querySelector('[data-action="pull"]')).not.toBeNull();
      expect(document.querySelector('[data-action="push"]')).not.toBeNull();
    });

    it('resolves with null when cancelled', async () => {
      const choice = dialog.chooseMode();
      click('[data-action="cancel"]');
      await expect(choice).resolves.toBeNull();
    });

    it('treats Escape as cancel', async () => {
      const choice = dialog.chooseMode();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await expect(choice).resolves.toBeNull();
    });

    it('leaves nothing behind once answered', async () => {
      const choice = dialog.chooseMode();
      click('[data-action="push"]');
      await choice;
      expect(document.querySelector('.sync-conflict')).toBeNull();
    });
  });

  describe('confirming a pull', () => {
    it('resolves true when the user takes the Doc', async () => {
      const answer = dialog.confirmPull();
      click('[data-action="pull"]');
      await expect(answer).resolves.toBe(true);
    });

    it('resolves false when the user declines', async () => {
      const answer = dialog.confirmPull();
      click('[data-action="cancel"]');
      await expect(answer).resolves.toBe(false);
    });
  });

  describe('resolving conflicts one at a time', () => {
    const conflicts = [
      { index: 0, local: 'mine one', remote: 'theirs one' },
      { index: 2, local: 'mine two', remote: 'theirs two' },
    ];

    it('walks every conflict and collects one choice each', async () => {
      const answers = dialog.resolveConflicts(conflicts);
      click('[data-action="local"]');
      click('[data-action="remote"]');
      await expect(answers).resolves.toEqual(['local', 'remote']);
    });

    it('says where the user is in the run', async () => {
      const answers = dialog.resolveConflicts(conflicts);
      expect(text('.sync-conflict-progress')).toBe('Conflict 1 of 2');
      click('[data-action="both"]');
      expect(text('.sync-conflict-progress')).toBe('Conflict 2 of 2');
      click('[data-action="both"]');
      await answers;
    });

    it('shows both versions of the block', async () => {
      const answers = dialog.resolveConflicts(conflicts);
      expect(text('.sync-conflict-local')).toContain('mine one');
      expect(text('.sync-conflict-remote')).toContain('theirs one');
      click('[data-action="local"]');
      click('[data-action="local"]');
      await answers;
    });

    it('abandons the whole run when cancelled', async () => {
      const answers = dialog.resolveConflicts(conflicts);
      click('[data-action="cancel"]');
      await expect(answers).resolves.toBeNull();
    });

    it('renders document text as text, never as markup', async () => {
      // The remote side is written by whoever can edit the Doc. Interpolating
      // it into innerHTML would let them run script in the app.
      const answers = dialog.resolveConflicts([
        { index: 0, local: 'safe', remote: '<img src=x onerror="globalThis.pwned = true">' },
      ]);

      expect(document.querySelector('.sync-conflict-remote img')).toBeNull();
      expect(text('.sync-conflict-remote')).toContain('<img');
      click('[data-action="local"]');
      await answers;
    });
  });
});
