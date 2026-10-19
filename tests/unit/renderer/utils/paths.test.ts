import { describe, it, expect } from 'vitest';

import { fileNameOf, parentDirOf } from '@renderer/utils/paths';

describe('fileNameOf', () => {
  it('takes the last segment of a posix path', () => {
    expect(fileNameOf('/Users/me/notes/a.md')).toBe('a.md');
  });

  it('takes the last segment of a Windows path', () => {
    expect(fileNameOf('C:\\Users\\me\\notes\\a.md')).toBe('a.md');
    expect(fileNameOf('\\\\server\\share\\a.md')).toBe('a.md');
  });

  it('returns a bare name as it is', () => {
    expect(fileNameOf('a.md')).toBe('a.md');
  });
});

describe('parentDirOf', () => {
  it('drops the last segment of a posix path', () => {
    expect(parentDirOf('/Users/me/a.md')).toBe('/Users/me');
  });

  it('drops the last segment of a Windows path', () => {
    expect(parentDirOf('C:\\Users\\me\\a.md')).toBe('C:\\Users\\me');
  });

  it('is empty when nothing sits above the file', () => {
    expect(parentDirOf('/a.md')).toBe('');
    expect(parentDirOf('a.md')).toBe('');
  });
});
