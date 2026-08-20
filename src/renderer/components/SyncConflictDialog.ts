/**
 * SyncConflictDialog - asks the user how to reconcile a file and a Doc that
 * both moved since the last sync.
 *
 * Three screens, one component, because they are steps of a single decision:
 * pick a direction, or -- when only the Doc moved -- just confirm the pull;
 * then settle any block the merge could not.
 *
 * Builds its own DOM the way SyncProgressBar does, so no markup lives in
 * index.html waiting to fall out of step with the code.
 */
import type { SyncConflict, SyncConflictChoice, SyncResolveMode } from '@shared/types/google-docs';

export interface SyncConflictDialog {
  /** Ask which way to reconcile. Resolves null if the user backs out. */
  chooseMode(): Promise<SyncResolveMode | null>;
  /** Ask whether to take the Doc's version, when there is nothing to merge. */
  confirmPull(): Promise<boolean>;
  /** Walk each conflicting block. Resolves null if the user backs out. */
  resolveConflicts(conflicts: SyncConflict[]): Promise<SyncConflictChoice[] | null>;
  destroy(): void;
}

/** Fill an element with plain text -- never markup. */
function setText(root: HTMLElement, selector: string, value: string): void {
  const el = root.querySelector(selector);
  if (el) el.textContent = value;
}

class SyncConflictDialogImpl implements SyncConflictDialog {
  private overlay: HTMLElement | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  chooseMode(): Promise<SyncResolveMode | null> {
    return this.present<SyncResolveMode | null>(`
      <h2 class="sync-conflict-title">Both sides changed</h2>
      <p class="sync-conflict-body">
        This file and its Google Doc have each been edited since the last sync.
        Choose how to reconcile them.
      </p>
      <div class="sync-conflict-actions sync-conflict-actions-stacked">
        <button type="button" class="btn btn-primary" data-action="merge">
          Merge both
          <span class="sync-conflict-hint">Keep every change; ask about anything that clashes</span>
        </button>
        <button type="button" class="btn" data-action="pull">
          Use the Google Doc
          <span class="sync-conflict-hint">Rewrite this file to match the Doc</span>
        </button>
        <button type="button" class="btn" data-action="push">
          Use this file
          <span class="sync-conflict-hint">Edit the Doc to match this file, keeping its comments</span>
        </button>
        <button type="button" class="btn btn-quiet" data-action="cancel">Cancel</button>
      </div>
    `, (action, resolve) => {
      if (action === 'cancel') resolve(null);
      else resolve(action as SyncResolveMode);
    }, null);
  }

  confirmPull(): Promise<boolean> {
    return this.present<boolean>(`
      <h2 class="sync-conflict-title">The Google Doc has changed</h2>
      <p class="sync-conflict-body">
        Someone edited the Doc since the last sync. This file has no changes of
        its own, so it can simply be brought up to date.
      </p>
      <div class="sync-conflict-actions">
        <button type="button" class="btn btn-quiet" data-action="cancel">Not now</button>
        <button type="button" class="btn btn-primary" data-action="pull">Update this file</button>
      </div>
    `, (action, resolve) => { resolve(action === 'pull'); }, false);
  }

  resolveConflicts(conflicts: SyncConflict[]): Promise<SyncConflictChoice[] | null> {
    if (conflicts.length === 0) return Promise.resolve([]);

    return new Promise((resolve) => {
      const choices: SyncConflictChoice[] = [];
      let at = 0;

      const draw = (): void => {
        const conflict = conflicts[at];
        if (conflict == null) return;
        const overlay = this.open(`
          <h2 class="sync-conflict-title">Both sides changed the same text</h2>
          <p class="sync-conflict-progress"></p>
          <div class="sync-conflict-pair">
            <div class="sync-conflict-side">
              <h3 class="sync-conflict-side-title">This file</h3>
              <pre class="sync-conflict-local"></pre>
            </div>
            <div class="sync-conflict-side">
              <h3 class="sync-conflict-side-title">Google Doc</h3>
              <pre class="sync-conflict-remote"></pre>
            </div>
          </div>
          <div class="sync-conflict-actions">
            <button type="button" class="btn btn-quiet" data-action="cancel">Cancel</button>
            <button type="button" class="btn" data-action="both">Keep both</button>
            <button type="button" class="btn" data-action="remote">Keep the Doc's</button>
            <button type="button" class="btn btn-primary" data-action="local">Keep mine</button>
          </div>
        `);

        setText(overlay, '.sync-conflict-progress', `Conflict ${at + 1} of ${conflicts.length}`);
        // textContent, not innerHTML: the remote side is written by anyone who
        // can edit the Doc, and must never reach the DOM as markup.
        setText(overlay, '.sync-conflict-local', conflict.local);
        setText(overlay, '.sync-conflict-remote', conflict.remote);

        this.wire((action) => {
          if (action === 'cancel') {
            this.close();
            resolve(null);
            return;
          }
          choices.push(action as SyncConflictChoice);
          at += 1;
          if (at >= conflicts.length) {
            this.close();
            resolve(choices);
            return;
          }
          draw();
        }, () => {
          this.close();
          resolve(null);
        });
      };

      draw();
    });
  }

  destroy(): void {
    this.close();
  }

  /** Show one screen and resolve once the user answers it. */
  private present<T>(
    html: string,
    decide: (action: string, resolve: (value: T) => void) => void,
    onDismiss: T,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      this.open(html);
      const finish = (value: T): void => {
        this.close();
        resolve(value);
      };
      this.wire(
        (action) => { decide(action, finish); },
        () => { finish(onDismiss); },
      );
    });
  }

  private open(html: string): HTMLElement {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'sync-conflict-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class="sync-conflict">${html}</div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    return overlay;
  }

  private wire(onAction: (action: string) => void, onDismiss: () => void): void {
    const overlay = this.overlay;
    if (!overlay) return;

    overlay.querySelectorAll<HTMLElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset['action'];
        if (action != null) onAction(action);
      });
    });

    // Clicking the backdrop, but not the panel itself, dismisses.
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) onDismiss();
    });

    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
    this.onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', this.onKeyDown);
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

export function createSyncConflictDialog(): SyncConflictDialog {
  return new SyncConflictDialogImpl();
}
