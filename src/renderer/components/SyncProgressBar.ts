/**
 * SyncProgressBar - a snackbar reporting what a Google Docs sync is doing.
 *
 * Unlike Toast, this is a single long-lived element that is updated in place:
 * a sync can run for tens of seconds, and the user needs to see it moving.
 * Dismissing it only hides it -- progress keeps being recorded, so reopening
 * from the sync button shows where the sync actually is, not where it was.
 */
import type { SyncProgressUpdate } from '@shared/types/google-docs';

export interface SyncProgressBar {
  /** Put it on screen, restoring the latest known progress. */
  show(): void;
  /** Take it off screen. The sync keeps running and keeps being recorded. */
  hide(): void;
  /** Record progress, redrawing only if currently on screen. */
  update(update: SyncProgressUpdate): void;
  /** The sync ended: remove it and reset. */
  finish(): void;
  isVisible(): boolean;
  destroy(): void;
}

const TITLE = 'Syncing to Google Docs';

class SyncProgressBarImpl implements SyncProgressBar {
  private element: HTMLElement | null = null;
  private latest: SyncProgressUpdate = { percent: 0, label: 'Starting…' };

  show(): void {
    if (this.element) return;

    const el = document.createElement('div');
    el.className = 'sync-progress';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <div class="sync-progress-head">
        <span class="sync-progress-title"></span>
        <span class="sync-progress-pct"></span>
        <button class="sync-progress-close" type="button" aria-label="Dismiss">&times;</button>
      </div>
      <div class="sync-progress-track">
        <div class="sync-progress-fill"></div>
      </div>
      <div class="sync-progress-label"></div>
    `;

    const title = el.querySelector('.sync-progress-title');
    if (title) title.textContent = TITLE;
    el.querySelector('.sync-progress-close')?.addEventListener('click', () => this.hide());

    document.body.appendChild(el);
    this.element = el;
    this.render();
  }

  hide(): void {
    this.element?.remove();
    this.element = null;
  }

  update(update: SyncProgressUpdate): void {
    this.latest = update;
    this.render();
  }

  finish(): void {
    this.hide();
    this.latest = { percent: 0, label: 'Starting…' };
  }

  isVisible(): boolean {
    return this.element !== null;
  }

  destroy(): void {
    this.hide();
  }

  private render(): void {
    if (!this.element) return;
    const percent = Math.min(Math.max(Math.round(this.latest.percent), 0), 100);

    const pct = this.element.querySelector('.sync-progress-pct');
    if (pct) pct.textContent = `${percent}%`;

    const label = this.element.querySelector('.sync-progress-label');
    if (label) label.textContent = this.latest.label;

    const fill = this.element.querySelector<HTMLElement>('.sync-progress-fill');
    if (fill) fill.style.width = `${percent}%`;
  }
}

export function createSyncProgressBar(): SyncProgressBar {
  return new SyncProgressBarImpl();
}
