/**
 * Block-level pieces of the sync merge that both processes need.
 *
 * The merge itself runs in main, but the review screen has to preview a
 * different set of choices as fast as the user can click, which rules out a
 * round trip per toggle. So the two functions it needs live here, and main
 * and the renderer share one copy rather than keeping two in step.
 */
import type { SyncChange, SyncConflictChoice } from '@shared/types/google-docs';

/** What sort of markdown line this is, for deciding where a block ends. */
type LineKind = 'blank' | 'heading' | 'rule' | 'table' | 'list' | 'quote' | 'text';

function lineKind(line: string): LineKind {
  const trimmed = line.trim();
  if (trimmed === '') return 'blank';
  if (/^#{1,6}\s/.test(trimmed)) return 'heading';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return 'rule';
  if (trimmed.startsWith('|')) return 'table';
  if (/^([-*+]\s|\d+[.)]\s)/.test(trimmed)) return 'list';
  if (trimmed.startsWith('>')) return 'quote';
  return 'text';
}

/**
 * Split markdown into top-level blocks.
 *
 * Blank lines are not the boundary -- structure is. Markdown written without
 * any blank lines is perfectly legal and common (a heading, its paragraph and
 * a table on consecutive lines), and splitting only on blank lines turns a
 * whole section into one block. That matters because the Doc's reverse
 * conversion always emits one block per paragraph: if the file is segmented
 * differently, no block on one side ever equals a block on the other, nothing
 * aligns, and every remote edit is reported as an insertion into a void.
 *
 * A fenced code block stays whole despite its blank lines -- splitting one
 * would let a merge drop something into the middle of someone's code.
 */
export function splitBlocks(md: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let currentKind: LineKind | null = null;
  let fence: string | null = null;

  const flush = (): void => {
    while (current.length > 0 && current.at(-1)?.trim() === '') current.pop();
    if (current.length > 0) blocks.push(current.join('\n'));
    current = [];
    currentKind = null;
  };

  for (const line of md.split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);

    if (fence !== null) {
      current.push(line);
      if (fenceMatch && line.trim().startsWith(fence)) {
        fence = null;
        flush();
      }
      continue;
    }

    if (fenceMatch?.[1] != null) {
      flush();
      fence = fenceMatch[1];
      current.push(line);
      continue;
    }

    let kind = lineKind(line);

    if (kind === 'blank') {
      flush();
      continue;
    }

    // A run of dashes under a paragraph is a setext heading, not a rule, and
    // belongs to the line above it.
    if (kind === 'rule' && currentKind === 'text') {
      current.push(line);
      flush();
      continue;
    }

    // An indented line continues whatever run it sits under -- a wrapped list
    // item, a nested bullet -- rather than starting a paragraph of its own.
    if (currentKind !== null && /^[ \t]/.test(line)) kind = currentKind;

    if (kind === 'heading' || kind === 'rule') {
      flush();
      blocks.push(line.trim());
      continue;
    }

    if (currentKind !== null && currentKind !== kind) flush();
    currentKind = kind;
    current.push(line);
  }

  flush();
  return blocks;
}

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
export function chooseSide(change: SyncChange, choice: SyncConflictChoice): string {
  if (choice === 'both') {
    // One side may hold nothing -- "keep both" of a block only one side has
    // is just that block, not a stray blank.
    return [change.local, change.remote].filter((side) => side.trim() !== '').join('\n\n');
  }
  return choice === 'remote' ? change.remote : change.local;
}

export function applyResolutions(
  blocks: string[],
  changes: SyncChange[],
  choices: SyncConflictChoice[],
): string[] {
  const out = [...blocks];
  changes.forEach((change, i) => {
    out[change.index] = chooseSide(change, choices[i] ?? change.choice);
  });
  return out;
}
