/**
 * SyncReviewDialog - shows every difference between a file and its Google Doc
 * and lets the user settle each one before anything is written.
 *
 * The merge already knows every hunk; the old dialog only surfaced the ones it
 * could not settle by itself, so changes were applied that the user never saw
 * and could not decline. This screen shows all of them, with a live preview of
 * the result, and returns the markdown the user approved.
 *
 * Direction is not a separate mode any more: "use the Doc" and "use this file"
 * are the bulk buttons, which set every change one way.
 *
 * Builds its own DOM the way SyncProgressBar does, so no markup lives in
 * index.html waiting to fall out of step with the code.
 */
import type { SyncChange, SyncChangeKind, SyncConflictChoice } from '@shared/types/google-docs';
import { applyResolutions, joinBlocks } from '@shared/markdown/blocks';

export interface SyncReviewDialog {
  /**
   * Walk the user through every difference.
   *
   * Resolves with the markdown they approved, or null if they backed out.
   */
  review(changes: SyncChange[], blocks: string[]): Promise<string | null>;
  destroy(): void;
}

const KIND_LABEL: Record<SyncChangeKind, string> = {
  conflict: 'Both sides changed this',
  'local-only': 'Only this file changed',
  'remote-only': 'Only the Doc changed',
};

/** Shown when a side has nothing at this position, so the pane is never blank. */
const ABSENT = '(nothing here)';

class SyncReviewDialogImpl implements SyncReviewDialog {
  private overlay: HTMLElement | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  review(changes: SyncChange[], blocks: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const choices: SyncConflictChoice[] = changes.map((change) => change.choice);
      const overlay = this.open(this.shell(changes));

      // The Doc's text is written by anyone who can edit it, so it reaches the
      // DOM only ever as text -- never as markup.
      changes.forEach((change, i) => {
        const row = overlay.querySelector(`[data-change="${i}"]`);
        if (!row) return;
        const local = row.querySelector('.sync-review-local');
        const remote = row.querySelector('.sync-review-remote');
        if (local) local.textContent = change.local === '' ? ABSENT : change.local;
        if (remote) remote.textContent = change.remote === '' ? ABSENT : change.remote;
      });

      const paint = (): void => {
        const preview = overlay.querySelector('.sync-review-preview-text');
        if (preview) preview.textContent = joinBlocks(applyResolutions(blocks, changes, choices));
        overlay.querySelectorAll<HTMLElement>('[data-choice]').forEach((button) => {
          const row = button.closest<HTMLElement>('[data-change]');
          const at = Number(row?.dataset['change'] ?? -1);
          button.setAttribute('aria-pressed', String(button.dataset['choice'] === choices[at]));
        });
      };

      const finish = (value: string | null): void => {
        this.close();
        resolve(value);
      };

      overlay.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        if (target === overlay) {
          finish(null);
          return;
        }

        const button = target?.closest<HTMLElement>('button');
        if (!button) return;

        const bulk = button.dataset['bulk'];
        if (bulk != null) {
          choices.fill(bulk as SyncConflictChoice);
          paint();
          return;
        }

        const choice = button.dataset['choice'];
        if (choice != null) {
          const at = Number(button.closest<HTMLElement>('[data-change]')?.dataset['change'] ?? -1);
          if (at >= 0) choices[at] = choice as SyncConflictChoice;
          paint();
          return;
        }

        const action = button.dataset['action'];
        if (action === 'cancel') finish(null);
        else if (action === 'apply') {
          finish(joinBlocks(applyResolutions(blocks, changes, choices)));
        }
      });

      if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') finish(null);
      };
      document.addEventListener('keydown', this.onKeyDown);

      paint();
    });
  }

  destroy(): void {
    this.close();
  }

  /** The whole screen's markup. Carries no user text -- that is set after. */
  private shell(changes: SyncChange[]): string {
    const rows = changes.map((change, i) => `
      <li class="sync-review-change sync-review-change-${change.kind}" data-change="${i}">
        <header class="sync-review-change-head">
          <span class="sync-review-count">Change ${i + 1} of ${changes.length}</span>
          <span class="sync-review-kind">${KIND_LABEL[change.kind]}</span>
        </header>
        <div class="sync-review-pair">
          <div class="sync-review-side">
            <h4 class="sync-review-side-title">This file</h4>
            <pre class="sync-review-local"></pre>
          </div>
          <div class="sync-review-side">
            <h4 class="sync-review-side-title">Google Doc</h4>
            <pre class="sync-review-remote"></pre>
          </div>
        </div>
        <div class="sync-review-choices">
          <button type="button" class="btn" data-choice="local" aria-pressed="false">Use this file</button>
          <button type="button" class="btn" data-choice="remote" aria-pressed="false">Use the Doc</button>
          <button type="button" class="btn" data-choice="both" aria-pressed="false">Keep both</button>
        </div>
      </li>`).join('');

    const count = changes.length === 1 ? '1 difference' : `${changes.length} differences`;

    return `
      <h2 class="sync-review-title">Review changes</h2>
      <p class="sync-review-body">
        ${count} between this file and its Google Doc. Applying settles both sides.
      </p>
      <div class="sync-review-bulk">
        <span class="sync-review-bulk-label">Apply to all:</span>
        <button type="button" class="btn btn-quiet" data-bulk="local">Use this file</button>
        <button type="button" class="btn btn-quiet" data-bulk="remote">Use the Doc</button>
      </div>
      <div class="sync-review-panes">
        <ol class="sync-review-list">${rows}</ol>
        <section class="sync-review-preview">
          <h3 class="sync-review-side-title">Result</h3>
          <pre class="sync-review-preview-text"></pre>
        </section>
      </div>
      <div class="sync-review-actions">
        <button type="button" class="btn btn-quiet" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="apply">Apply to both</button>
      </div>
    `;
  }

  private open(html: string): HTMLElement {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'sync-review-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class="sync-review">${html}</div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    return overlay;
  }

  private close(): void {
    if (this.onKeyDown) {
      document.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = null;
    }
    this.overlay?.remove();
    this.overlay = null;
  }
}

export function createSyncReviewDialog(): SyncReviewDialog {
  return new SyncReviewDialogImpl();
}
