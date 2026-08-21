/**
 * Block-level pieces of the sync merge that both processes need.
 *
 * The merge itself runs in main, but the review screen has to preview a
 * different set of choices as fast as the user can click, which rules out a
 * round trip per toggle. So the two functions it needs live here, and main
 * and the renderer share one copy rather than keeping two in step.
 */
import type { SyncChange, SyncConflictChoice } from '@shared/types/google-docs';

/**
 * Reassemble blocks into a markdown document.
 *
 * Empty slots are dropped: a change whose chosen side is "nothing here" holds
 * an empty string, and joining it verbatim would leave a run of blank lines.
 */
export function joinBlocks(blocks: string[]): string {
  const kept = blocks.filter((block) => block.trim() !== '');
  return kept.length > 0 ? `${kept.join('\n\n')}\n` : '';
}

/**
 * Substitute the user's choices back into the merged block list.
 *
 * `choices` is positional: one entry per change, in the order reported. A
 * missing entry leaves the change at its default.
 */
export function applyResolutions(
  blocks: string[],
  changes: SyncChange[],
  choices: SyncConflictChoice[],
): string[] {
  const out = [...blocks];
  changes.forEach((change, i) => {
    const choice = choices[i] ?? change.choice;
    if (choice === 'both') {
      // One side may hold nothing -- "keep both" of a block only one side has
      // is just that block, not a stray blank.
      out[change.index] = [change.local, change.remote]
        .filter((side) => side.trim() !== '')
        .join('\n\n');
      return;
    }
    out[change.index] = choice === 'remote' ? change.remote : change.local;
  });
  return out;
}
