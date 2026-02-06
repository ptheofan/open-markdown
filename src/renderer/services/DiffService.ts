import { diffArrays } from 'diff';

import type { LineChange, DiffResult } from '@shared/types';

export class DiffService {
  private baseline: string[] | null = null;

  setBaseline(content: string): void {
    this.baseline = content === '' ? [] : content.split('\n');
  }

  clearBaseline(): void {
    this.baseline = null;
  }

  hasBaseline(): boolean {
    return this.baseline !== null;
  }

  computeDiff(currentContent: string): DiffResult {
    if (!this.baseline) {
      return { changes: [], hasChanges: false };
    }

    const currentLines = currentContent === '' ? [] : currentContent.split('\n');
    const diffs = diffArrays(this.baseline, currentLines);
    const changes: LineChange[] = [];
    let currentLineIndex = 0;

    for (let i = 0; i < diffs.length; i++) {
      const part = diffs[i]!;

      if (!part.added && !part.removed) {
        currentLineIndex += part.count ?? 0;
        continue;
      }

      if (part.removed) {
        const nextPart = diffs[i + 1];
        if (nextPart?.added) {
          changes.push({
            type: 'modified',
            startLine: currentLineIndex,
            endLine: currentLineIndex + (nextPart.count ?? 0),
          });
          currentLineIndex += nextPart.count ?? 0;
          i++;
        } else {
          changes.push({
            type: 'deleted',
            startLine: currentLineIndex,
            endLine: currentLineIndex,
          });
        }
        continue;
      }

      if (part.added) {
        changes.push({
          type: 'added',
          startLine: currentLineIndex,
          endLine: currentLineIndex + (part.count ?? 0),
        });
        currentLineIndex += part.count ?? 0;
      }
    }

    return { changes, hasChanges: changes.length > 0 };
  }
}
