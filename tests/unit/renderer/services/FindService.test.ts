/**
 * @vitest-environment jsdom
 */
import { FindService } from '@renderer/services/FindService';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';

// Mock CSS Custom Highlight API (not available in jsdom)
class MockHighlight {
  ranges: AbstractRange[];
  constructor(...ranges: AbstractRange[]) {
    this.ranges = ranges;
  }
}

const mockHighlightsMap = new Map<string, MockHighlight>();

vi.stubGlobal('Highlight', MockHighlight);
vi.stubGlobal('CSS', {
  highlights: mockHighlightsMap,
});

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

function createContainer(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('FindService', () => {
  let container: HTMLElement;
  let service: FindService;

  beforeEach(() => {
    mockHighlightsMap.clear();
    container = createContainer(
      '<p>Hello world</p><p>Hello again, hello!</p><p>Goodbye world</p>',
    );
    document.body.appendChild(container);
    service = new FindService(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe('find()', () => {
    it('should return correct match count', () => {
      // Case-insensitive by default: "Hello" (p1), "Hello" (p2), "hello" (p2) = 3
      const result = service.find('Hello');
      expect(result.matches).toBe(3);
      expect(result.activeMatchOrdinal).toBe(1);
    });

    it('should return zero matches for empty text', () => {
      const result = service.find('');
      expect(result.matches).toBe(0);
      expect(result.activeMatchOrdinal).toBe(0);
    });

    it('should return zero matches when text is not found', () => {
      const result = service.find('zzzzzzz');
      expect(result.matches).toBe(0);
      expect(result.activeMatchOrdinal).toBe(0);
    });

    it('should find multiple occurrences in the same text node', () => {
      const result = service.find('hello');
      // "Hello world", "Hello again, hello!" => case-insensitive: Hello, Hello, hello = 3
      expect(result.matches).toBe(3);
    });

    it('should set CSS highlights when matches are found', () => {
      service.find('world');
      expect(mockHighlightsMap.has('find-matches')).toBe(true);
      expect(mockHighlightsMap.has('find-active-match')).toBe(true);
    });

    it('should not set CSS highlights when no matches found', () => {
      service.find('nonexistent');
      expect(mockHighlightsMap.has('find-matches')).toBe(false);
      expect(mockHighlightsMap.has('find-active-match')).toBe(false);
    });
  });

  describe('find() with matchCase', () => {
    it('should be case-sensitive when matchCase is true', () => {
      const result = service.find('Hello', { matchCase: true });
      // "Hello world" and "Hello again, hello!" => only "Hello" x2 (not "hello")
      expect(result.matches).toBe(2);
    });

    it('should be case-insensitive when matchCase is false', () => {
      const result = service.find('hello', { matchCase: false });
      // "Hello world", "Hello again, hello!" => 3 matches
      expect(result.matches).toBe(3);
    });

    it('should default to case-insensitive', () => {
      const result = service.find('hello');
      expect(result.matches).toBe(3);
    });
  });

  describe('findNext()', () => {
    it('should advance activeMatchOrdinal forward', () => {
      service.find('world'); // 2 matches: p1, p3
      const result = service.findNext(true);
      expect(result.activeMatchOrdinal).toBe(2);
      expect(result.matches).toBe(2);
    });

    it('should wrap around at end when going forward', () => {
      service.find('world'); // 2 matches
      service.findNext(true); // 2 of 2
      const result = service.findNext(true); // wraps to 1 of 2
      expect(result.activeMatchOrdinal).toBe(1);
    });

    it('should go backwards', () => {
      service.find('world'); // 2 matches
      const result = service.findNext(false); // wraps to last
      expect(result.activeMatchOrdinal).toBe(2);
    });

    it('should wrap around at start when going backward', () => {
      service.find('hello');
      // At 1, go back => wraps to 3
      const result = service.findNext(false);
      expect(result.activeMatchOrdinal).toBe(3);
    });

    it('should return zero when no matches exist', () => {
      const result = service.findNext(true);
      expect(result.activeMatchOrdinal).toBe(0);
      expect(result.matches).toBe(0);
    });

    it('should update CSS highlights on navigation', () => {
      service.find('world');
      mockHighlightsMap.clear();
      service.findNext(true);
      expect(mockHighlightsMap.has('find-matches')).toBe(true);
      expect(mockHighlightsMap.has('find-active-match')).toBe(true);
    });
  });

  describe('clear()', () => {
    it('should reset state and remove highlights', () => {
      service.find('Hello');
      expect(mockHighlightsMap.size).toBeGreaterThan(0);

      service.clear();
      expect(mockHighlightsMap.has('find-matches')).toBe(false);
      expect(mockHighlightsMap.has('find-active-match')).toBe(false);
    });

    it('should return zero matches after clear + findNext', () => {
      service.find('Hello');
      service.clear();
      const result = service.findNext(true);
      expect(result.matches).toBe(0);
    });
  });

  describe('rerun()', () => {
    it('should return null when no previous search', () => {
      const result = service.rerun();
      expect(result).toBeNull();
    });

    it('should re-search after DOM changes', () => {
      service.find('world'); // 2 matches: "Hello world", "Goodbye world"
      expect(service.find('world').matches).toBe(2);

      // Modify DOM: add another "world"
      const extra = document.createElement('p');
      extra.textContent = 'Another world';
      container.appendChild(extra);

      const result = service.rerun();
      expect(result).not.toBeNull();
      expect(result!.matches).toBe(3);
    });

    it('should preserve matchCase option on rerun', () => {
      service.find('Hello', { matchCase: true });
      expect(service.find('Hello', { matchCase: true }).matches).toBe(2);

      const extra = document.createElement('p');
      extra.textContent = 'hello lowercase';
      container.appendChild(extra);

      const result = service.rerun();
      expect(result).not.toBeNull();
      // "hello lowercase" shouldn't match with matchCase: true
      expect(result!.matches).toBe(2);
    });

    it('should return null after clear', () => {
      service.find('Hello');
      service.clear();
      expect(service.rerun()).toBeNull();
    });
  });
});
