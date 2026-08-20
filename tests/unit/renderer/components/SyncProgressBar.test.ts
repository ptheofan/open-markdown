/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSyncProgressBar } from '../../../../src/renderer/components/SyncProgressBar';

describe('SyncProgressBar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is not in the DOM until a sync starts', () => {
    createSyncProgressBar();
    expect(document.querySelector('.sync-progress')).toBeNull();
  });

  it('shows what is happening and how far along it is', () => {
    const bar = createSyncProgressBar();
    bar.show();
    bar.update({ percent: 58, label: 'Uploading diagram 3 of 5' });

    const el = document.querySelector('.sync-progress');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('Uploading diagram 3 of 5');
    expect(el?.textContent).toContain('58%');
    const fill = document.querySelector<HTMLElement>('.sync-progress-fill');
    expect(fill?.style.width).toBe('58%');
  });

  it('reports whether it is currently on screen', () => {
    const bar = createSyncProgressBar();
    expect(bar.isVisible()).toBe(false);
    bar.show();
    expect(bar.isVisible()).toBe(true);
  });

  it('closes when the dismiss button is clicked, without losing progress', () => {
    const bar = createSyncProgressBar();
    bar.show();
    bar.update({ percent: 40, label: 'Uploading diagram 2 of 5' });

    document.querySelector<HTMLButtonElement>('.sync-progress-close')?.click();

    expect(bar.isVisible()).toBe(false);
    expect(document.querySelector('.sync-progress')).toBeNull();

    // Re-opening restores the state it was dismissed at, rather than resetting.
    bar.show();
    expect(document.querySelector('.sync-progress')?.textContent).toContain(
      'Uploading diagram 2 of 5'
    );
    expect(document.querySelector<HTMLElement>('.sync-progress-fill')?.style.width).toBe('40%');
  });

  it('keeps updating while dismissed so a reopen shows current progress', () => {
    const bar = createSyncProgressBar();
    bar.show();
    bar.hide();
    bar.update({ percent: 90, label: 'Inserting table 2 of 2' });

    bar.show();
    expect(document.querySelector('.sync-progress')?.textContent).toContain(
      'Inserting table 2 of 2'
    );
    expect(document.querySelector<HTMLElement>('.sync-progress-fill')?.style.width).toBe('90%');
  });

  it('removes itself when the sync finishes', () => {
    const bar = createSyncProgressBar();
    bar.show();
    bar.finish();
    expect(document.querySelector('.sync-progress')).toBeNull();
    expect(bar.isVisible()).toBe(false);
  });
});
