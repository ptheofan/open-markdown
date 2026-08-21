/**
 * ThreeWayMerge - reconciles a markdown file and a Google Doc that both moved.
 *
 * ## Why there are two baselines
 *
 * The two sides speak different dialects of the same document. A mermaid fence
 * in the file is a PNG in the Doc; a code block's language survives locally and
 * is lost remotely. Diffing the file against the Doc directly would therefore
 * report a change on every block of that kind, every time, and "merging" would
 * destroy the local source.
 *
 * So each side is diffed against *its own* snapshot from the last sync:
 *
 *   local edits  = diff(.local.md,  current markdown)
 *   remote edits = diff(.remote.md, convertDocsToMarkdown(doc))
 *
 * A block nobody touched converts identically both times and produces no hunk
 * at all, so the lossiness cancels and the local source is left alone. Only
 * text a human actually edited is ever rewritten.
 *
 * The remote's hunks are then translated from `.remote.md` block coordinates
 * into `.local.md` ones -- the two snapshots describe the same document at the
 * same instant, so aligning them is a plain diff -- and both edit scripts are
 * replayed against the local baseline.
 */

import { diffArrays } from 'diff';
import type { SyncChange, SyncChangeKind, SyncConflictChoice } from '@shared/types/google-docs';
import { joinBlocks, applyResolutions } from '@shared/markdown/blocks';

export { joinBlocks, applyResolutions };

/** A replacement of a range of baseline blocks. */
interface Edit {
  start: number;
  end: number;
  replacement: string[];
}

export interface ThreeWayInput {
  /** The markdown as of the last sync. */
  localBase: string;
  /** The markdown now. */
  local: string;
  /** The Doc, reverse-converted, as of the last sync. */
  remoteBase: string;
  /** The Doc, reverse-converted, now. */
  remote: string;
}

export interface MergeOutcome {
  /**
   * The merged document, one block per slot, every change sitting at its
   * default. A change always occupies exactly one slot so a different choice
   * can be substituted by index.
   */
  blocks: string[];
  /** Every difference found, in document order. */
  changes: SyncChange[];
}

/**
 * Split markdown into top-level blocks.
 *
 * Blocks are what the merge reasons about, so a fenced code block stays whole
 * even though it contains blank lines -- splitting it would let a merge insert
 * something into the middle of someone's code.
 */
export function splitBlocks(md: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = (): void => {
    while (current.length > 0 && current.at(-1)?.trim() === '') current.pop();
    if (current.length > 0) blocks.push(current.join('\n'));
    current = [];
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
    if (line.trim() === '') {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * Express `other` as a list of replacements against `base`.
 *
 * A removed run followed by an added run is one replacement; a lone added run
 * is an insertion (start === end) and a lone removed run is a deletion.
 */
function editsFrom(base: string[], other: string[]): Edit[] {
  const changes = diffArrays(base, other);
  const edits: Edit[] = [];
  let cursor = 0;
  let i = 0;

  while (i < changes.length) {
    const change = changes[i];
    if (change == null) break;
    if (!change.added && !change.removed) {
      cursor += change.value.length;
      i++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (i < changes.length) {
      const c = changes[i];
      if (c == null || (!c.added && !c.removed)) break;
      if (c.removed) removed.push(...c.value);
      else added.push(...c.value);
      i++;
    }
    edits.push({ start: cursor, end: cursor + removed.length, replacement: added });
    cursor += removed.length;
  }
  return edits;
}

/**
 * Map each index of `remoteBase` onto the index of `localBase` describing the
 * same part of the document, so the remote's hunks can be replayed locally.
 */
function alignToLocal(localBase: string[], remoteBase: string[]): number[] {
  const map: number[] = [];
  let li = 0;
  let ri = 0;

  for (const change of diffArrays(localBase, remoteBase)) {
    const count = change.value.length;
    if (!change.added && !change.removed) {
      for (let k = 0; k < count; k++) map[ri + k] = li + k;
      li += count;
      ri += count;
    } else if (change.removed) {
      // Present locally, absent remotely -- a block whose dialects diverged, or
      // one the Doc never received. Local indices advance, remote ones do not.
      li += count;
    } else {
      // Present remotely only: every such index pins to the same local spot.
      for (let k = 0; k < count; k++) map[ri + k] = li;
      ri += count;
    }
  }
  map[remoteBase.length] = localBase.length;
  return map;
}

function overlaps(a: Edit, b: Edit): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Replay both edit scripts against the shared baseline. */
function replay(base: string[], localEdits: Edit[], remoteEdits: Edit[]): MergeOutcome {
  const blocks: string[] = [];
  const changes: SyncChange[] = [];
  let pos = 0;
  let li = 0;
  let ri = 0;

  // Every difference lands in exactly one slot, holding whichever side the
  // default picks. The review screen swaps that slot to show another choice.
  const record = (
    kind: SyncChangeKind,
    local: string,
    remote: string,
    choice: SyncConflictChoice,
  ): void => {
    changes.push({ index: blocks.length, kind, local, remote, choice });
    blocks.push(choice === 'remote' ? remote : local);
  };

  while (li < localEdits.length || ri < remoteEdits.length) {
    const le = localEdits[li];
    const re = remoteEdits[ri];

    if (le != null && re != null && overlaps(le, re)) {
      blocks.push(...base.slice(pos, Math.min(le.start, re.start)));
      const localText = joinBlocks(le.replacement).trimEnd();
      const remoteText = joinBlocks(re.replacement).trimEnd();
      if (localText === remoteText) {
        // Both sides made the same edit, so there is nothing to ask about.
        blocks.push(...le.replacement);
      } else {
        record('conflict', localText, remoteText, 'local');
      }
      pos = Math.max(le.end, re.end);
      li++;
      ri++;
      continue;
    }

    const takeLocal = re == null || (le != null && le.start <= re.start);
    const edit = takeLocal ? le : re;
    if (edit == null) break;
    blocks.push(...base.slice(pos, edit.start));
    // One side moved; the other still holds what the baseline held there.
    const edited = joinBlocks(edit.replacement).trimEnd();
    const untouched = joinBlocks(base.slice(edit.start, edit.end)).trimEnd();
    if (takeLocal) record('local-only', edited, untouched, 'local');
    else record('remote-only', untouched, edited, 'remote');
    pos = edit.end;
    if (takeLocal) li++;
    else ri++;
  }

  blocks.push(...base.slice(pos));
  return { blocks, changes };
}

/**
 * Merge a changed file and a changed Doc, reporting what could not be settled.
 */
export function threeWayMerge(input: ThreeWayInput): MergeOutcome {
  const localBase = splitBlocks(input.localBase);
  const local = splitBlocks(input.local);
  const remoteBase = splitBlocks(input.remoteBase);
  const remote = splitBlocks(input.remote);

  const alignment = alignToLocal(localBase, remoteBase);
  const toLocalCoords = (index: number): number =>
    alignment[index] ?? alignment[alignment.length - 1] ?? localBase.length;

  const remoteEdits = editsFrom(remoteBase, remote).map((edit) => ({
    start: toLocalCoords(edit.start),
    end: toLocalCoords(edit.end),
    replacement: edit.replacement,
  }));

  return replay(localBase, editsFrom(localBase, local), remoteEdits);
}

/**
 * Review a file and a Doc with no shared history, by diffing them directly.
 *
 * Used on a first sync into a Doc that already holds content: there is no
 * ancestor to replay against, but the two documents as they stand right now
 * are a perfectly good diff.
 *
 * This is the one path where the reverse conversion's lossiness does not
 * cancel -- see the note at the top of this file. A mermaid fence is a PNG in
 * the Doc and will show up as a difference every time, so every change here
 * defaults to the file's version, which leaves that source alone.
 */
export function twoWayReview(local: string, remote: string): MergeOutcome {
  const base = splitBlocks(local);
  const blocks: string[] = [];
  const changes: SyncChange[] = [];
  let pos = 0;

  for (const edit of editsFrom(base, splitBlocks(remote))) {
    blocks.push(...base.slice(pos, edit.start));
    const mine = joinBlocks(base.slice(edit.start, edit.end)).trimEnd();
    const theirs = joinBlocks(edit.replacement).trimEnd();
    const kind: SyncChangeKind = mine === '' ? 'remote-only' : theirs === '' ? 'local-only' : 'conflict';
    changes.push({ index: blocks.length, kind, local: mine, remote: theirs, choice: 'local' });
    blocks.push(mine);
    pos = edit.end;
  }

  blocks.push(...base.slice(pos));
  return { blocks, changes };
}
