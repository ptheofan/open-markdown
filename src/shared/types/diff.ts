export type LineChangeType = 'added' | 'modified' | 'deleted';

export interface LineChange {
  type: LineChangeType;
  startLine: number;
  endLine: number;
}

export interface DiffResult {
  changes: LineChange[];
  hasChanges: boolean;
}
