import { DiffService } from '@renderer/services/DiffService';
import { describe, it, expect, beforeEach } from 'vitest';

describe('DiffService', () => {
  let service: DiffService;

  beforeEach(() => {
    service = new DiffService();
  });

  describe('baseline management', () => {
    it('should start with no baseline', () => {
      expect(service.hasBaseline()).toBe(false);
    });

    it('should store a baseline', () => {
      service.setBaseline('line1\nline2');
      expect(service.hasBaseline()).toBe(true);
    });

    it('should clear the baseline', () => {
      service.setBaseline('line1');
      service.clearBaseline();
      expect(service.hasBaseline()).toBe(false);
    });
  });

  describe('computeDiff', () => {
    it('should return no changes for identical content', () => {
      service.setBaseline('line1\nline2\nline3');
      const result = service.computeDiff('line1\nline2\nline3');
      expect(result.hasChanges).toBe(false);
      expect(result.changes).toEqual([]);
    });

    it('should return no changes when no baseline is set', () => {
      const result = service.computeDiff('line1\nline2');
      expect(result.hasChanges).toBe(false);
      expect(result.changes).toEqual([]);
    });

    it('should detect added lines at the end', () => {
      service.setBaseline('line1\nline2');
      const result = service.computeDiff('line1\nline2\nline3\nline4');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'added', startLine: 2, endLine: 4 },
      ]);
    });

    it('should detect added lines at the beginning', () => {
      service.setBaseline('line2\nline3');
      const result = service.computeDiff('line0\nline1\nline2\nline3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'added', startLine: 0, endLine: 2 },
      ]);
    });

    it('should detect added lines in the middle', () => {
      service.setBaseline('line1\nline3');
      const result = service.computeDiff('line1\nline2\nline3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'added', startLine: 1, endLine: 2 },
      ]);
    });

    it('should detect deleted lines at the end', () => {
      service.setBaseline('line1\nline2\nline3');
      const result = service.computeDiff('line1');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'deleted', startLine: 1, endLine: 1 },
      ]);
    });

    it('should detect deleted lines at the beginning', () => {
      service.setBaseline('line1\nline2\nline3');
      const result = service.computeDiff('line3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'deleted', startLine: 0, endLine: 0 },
      ]);
    });

    it('should detect deleted lines in the middle', () => {
      service.setBaseline('line1\nline2\nline3');
      const result = service.computeDiff('line1\nline3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'deleted', startLine: 1, endLine: 1 },
      ]);
    });

    it('should detect modified lines (removed + added at same position)', () => {
      service.setBaseline('line1\nold line\nline3');
      const result = service.computeDiff('line1\nnew line\nline3');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'modified', startLine: 1, endLine: 2 },
      ]);
    });

    it('should detect multiple modified lines', () => {
      service.setBaseline('line1\nold A\nold B\nline4');
      const result = service.computeDiff('line1\nnew A\nnew B\nline4');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'modified', startLine: 1, endLine: 3 },
      ]);
    });

    it('should handle mixed changes', () => {
      service.setBaseline('keep1\ndelete_me\nkeep2\nold_line\nkeep3');
      const result = service.computeDiff('keep1\nkeep2\nnew_line\nkeep3\nadded');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toContainEqual(
        { type: 'deleted', startLine: 1, endLine: 1 }
      );
      expect(result.changes).toContainEqual(
        { type: 'modified', startLine: 2, endLine: 3 }
      );
      expect(result.changes).toContainEqual(
        { type: 'added', startLine: 4, endLine: 5 }
      );
    });

    it('should handle empty baseline', () => {
      service.setBaseline('');
      const result = service.computeDiff('line1\nline2');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'added', startLine: 0, endLine: 2 },
      ]);
    });

    it('should handle empty current content', () => {
      service.setBaseline('line1\nline2');
      const result = service.computeDiff('');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'deleted', startLine: 0, endLine: 0 },
      ]);
    });

    it('should handle single line content', () => {
      service.setBaseline('old');
      const result = service.computeDiff('new');
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual([
        { type: 'modified', startLine: 0, endLine: 1 },
      ]);
    });
  });
});
