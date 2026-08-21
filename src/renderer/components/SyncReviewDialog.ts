/**
 * SyncReviewDialog - a three-pane merge view for a file and its Google Doc.
 *
 * Laid out the way a desktop merge tool is: your file on the left, the Doc on
 * the right, the result in the middle, one row per block so the three sides
 * stay aligned. Gutter arrows push a side into the result; the result renders
 * as markdown, because reading the outcome as source defeats the point of
 * previewing it.
 *
 * Every difference is shown, including the ones with an obvious default. The
 * merge has always known them all -- it used to apply the one-sided ones
 * silently, which meant changes were made that the user never saw and could
 * not decline.
 *
 * Direction is not a mode: the whole-file buttons set every row one way, and
 * that is all "use the Doc" and "use my file" ever were.
 */
import MarkdownIt from 'markdown-it';
import type { SyncChange, SyncConflictChoice } from '@shared/types/google-docs';
import { applyResolutions, chooseSide, joinBlocks, splitBlocks } from '@shared/markdown/blocks';

export interface SyncReviewDialog {
  /**
   * Show the merge and wait for the user to settle it.
   *
   * Resolves with the markdown they approved, or null if they backed out.
   * `original` is returned verbatim when the result matches it, so accepting
   * your own side throughout does not reformat the file.
   */
  review(changes: SyncChange[], blocks: string[], original?: string): Promise<string | null>;
  destroy(): void;
}

/**
 * html:false is the security boundary. The right-hand text is written by
 * anyone who can edit the Doc, so any markup in it is escaped rather than
 * parsed, and markdown-it refuses javascript: URLs on its own.
 */
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

/** Shown when a side has nothing at this position, so the pane is never blank. */
const ABSENT = '(nothing here)';

const KIND_LABEL: Record<SyncChange['kind'], string> = {
  conflict: 'Both sides changed this',
  'local-only': 'Changed here only',
  'remote-only': 'Changed in the Doc only',
};

class SyncReviewDialogImpl implements SyncReviewDialog {
  private overlay: HTMLElement | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  review(changes: SyncChange[], blocks: string[], original?: string): Promise<string | null> {
    return new Promise((resolve) => {
      const choices: SyncConflictChoice[] = changes.map((change) => change.choice);
      /** Block index -> position in `changes`, for the rows that are changes. */
      const changeAt = new Map(changes.map((change, i) => [change.index, i]));
      const overlay = this.open(this.shell(changes, blocks, changeAt));

      // Every cell is filled here, never in the markup: the right-hand text is
      // written by whoever can edit the Doc.
      overlay.querySelectorAll<HTMLElement>('[data-block]').forEach((row) => {
        const index = Number(row.dataset['block']);
        const i = changeAt.get(index);
        const change = i == null ? null : changes[i];
        const left = change ? change.local : blocks[index] ?? '';
        const right = change ? change.remote : blocks[index] ?? '';
        const leftCell = row.querySelector('.sync-merge-left');
        const rightCell = row.querySelector('.sync-merge-right');
        if (leftCell) leftCell.textContent = left === '' ? ABSENT : left;
        if (rightCell) rightCell.textContent = right === '' ? ABSENT : right;
        if (change == null) {
          const result = row.querySelector('.sync-merge-result');
          const text = blocks[index] ?? '';
          if (result) result.innerHTML = text.trim() === '' ? '' : md.render(text);
        }
      });

      const rowOf = (i: number): HTMLElement | null =>
        overlay.querySelector<HTMLElement>(`[data-change="${i}"]`);

      const paintRow = (i: number): void => {
        const row = rowOf(i);
        const change = changes[i];
        if (!row || !change) return;
        const chosen = chooseSide(change, choices[i] ?? change.choice);
        const result = row.querySelector('.sync-merge-result');
        if (result) result.innerHTML = chosen.trim() === '' ? '' : md.render(chosen);
        row.dataset['choice'] = choices[i] ?? change.choice;
        row.querySelectorAll<HTMLElement>('[data-accept]').forEach((button) => {
          button.setAttribute('aria-pressed', String(button.dataset['accept'] === choices[i]));
        });
      };

      const merged = (): string => joinBlocks(applyResolutions(blocks, changes, choices));

      const finish = (value: string | null): void => {
        this.close();
        resolve(value);
      };

      let at = -1;
      const jump = (step: number): void => {
        if (changes.length === 0) return;
        at = (at + step + changes.length) % changes.length;
        rowOf(at)?.scrollIntoView?.({ block: 'center' });
        overlay.querySelectorAll('.sync-merge-row-current').forEach((el) => el.classList.remove('sync-merge-row-current'));
        rowOf(at)?.classList.add('sync-merge-row-current');
      };

      overlay.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        if (target === overlay) return finish(null);

        const button = target?.closest<HTMLElement>('button');
        if (!button) return;

        const bulk = button.dataset['bulk'];
        if (bulk != null) {
          choices.fill(bulk as SyncConflictChoice);
          changes.forEach((_, i) => paintRow(i));
          return;
        }

        const accept = button.dataset['accept'];
        if (accept != null) {
          const i = Number(button.closest<HTMLElement>('[data-change]')?.dataset['change'] ?? -1);
          if (i >= 0) {
            choices[i] = accept as SyncConflictChoice;
            paintRow(i);
          }
          return;
        }

        const nav = button.dataset['nav'];
        if (nav != null) return jump(nav === 'prev' ? -1 : 1);

        const action = button.dataset['action'];
        if (action === 'cancel') finish(null);
        else if (action === 'apply') {
          const result = merged();
          // Accepting your own side everywhere must not rewrite the file just
          // because the merge re-joins blocks with blank lines between them.
          finish(original != null && joinBlocks(splitBlocks(original)) === result ? original : result);
        }
      });

      if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') finish(null);
      };
      document.addEventListener('keydown', this.onKeyDown);

      changes.forEach((_, i) => paintRow(i));
    });
  }

  destroy(): void {
    this.close();
  }

  /**
   * The whole document as aligned rows.
   *
   * Carries no user text: every cell is filled with textContent afterwards,
   * or rendered through markdown-it with html disabled.
   */
  private shell(changes: SyncChange[], blocks: string[], changeAt: Map<number, number>): string {
    const conflicts = changes.filter((c) => c.kind === 'conflict').length;
    const summary = [
      changes.length === 1 ? '1 change' : `${changes.length} changes`,
      conflicts > 0 ? `${conflicts} needing a decision` : null,
    ].filter(Boolean).join(' · ');

    const rows = blocks.map((_, index) => {
      const i = changeAt.get(index);
      if (i == null) {
        return `<div class="sync-merge-row sync-merge-row-same" data-block="${index}">
          <pre class="sync-merge-cell sync-merge-left"></pre>
          <div class="sync-merge-gutter"></div>
          <div class="sync-merge-cell sync-merge-result sync-merge-result-plain"></div>
          <div class="sync-merge-gutter"></div>
          <pre class="sync-merge-cell sync-merge-right"></pre>
        </div>`;
      }
      const change = changes[i];
      const kind = change?.kind ?? 'conflict';
      return `<div class="sync-merge-row sync-merge-row-${kind}" data-block="${index}" data-change="${i}"
        title="${KIND_LABEL[kind]}">
        <pre class="sync-merge-cell sync-merge-left"></pre>
        <div class="sync-merge-gutter">
          <button type="button" class="sync-merge-arrow" data-accept="local" aria-pressed="false"
            title="Use this file's version">&raquo;</button>
          <button type="button" class="sync-merge-arrow sync-merge-arrow-both" data-accept="both" aria-pressed="false"
            title="Keep both">&plusmn;</button>
        </div>
        <div class="sync-merge-cell sync-merge-result"></div>
        <div class="sync-merge-gutter">
          <button type="button" class="sync-merge-arrow" data-accept="remote" aria-pressed="false"
            title="Use the Doc's version">&laquo;</button>
        </div>
        <pre class="sync-merge-cell sync-merge-right"></pre>
      </div>`;
    }).join('');

    return `
      <header class="sync-merge-head">
        <h2 class="sync-merge-title">Merge with Google Doc</h2>
        <span class="sync-merge-summary">${summary}</span>
        <span class="sync-merge-spacer"></span>
        <button type="button" class="btn btn-quiet" data-nav="prev" title="Previous change">&#9650;</button>
        <button type="button" class="btn btn-quiet" data-nav="next" title="Next change">&#9660;</button>
        <span class="sync-merge-bulk-label">Whole file:</span>
        <button type="button" class="btn btn-quiet" data-bulk="local">Use this file</button>
        <button type="button" class="btn btn-quiet" data-bulk="remote">Use the Doc</button>
      </header>
      <div class="sync-merge-colheads">
        <span>This file</span><span></span><span>Result</span><span></span><span>Google Doc</span>
      </div>
      <div class="sync-merge-grid">${rows}</div>
      <footer class="sync-merge-actions">
        <button type="button" class="btn btn-quiet" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="apply">Apply to both</button>
      </footer>
    `;
  }

  private open(html: string): HTMLElement {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'sync-merge-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class="sync-merge">${html}</div>`;
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
