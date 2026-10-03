import { describe, it, expect } from 'vitest';
import { NavigationHistory } from '@renderer/services/NavigationHistory';

describe('NavigationHistory', () => {
  it('starts empty with nothing to go to', () => {
    const h = new NavigationHistory();
    expect(h.current()).toBeNull();
    expect(h.canGoBack()).toBe(false);
    expect(h.canGoForward()).toBe(false);
    expect(h.back()).toBeNull();
    expect(h.forward()).toBeNull();
  });

  it('pushes entries and walks back and forward through them', () => {
    const h = new NavigationHistory();
    h.push('/a.md');
    h.push('/b.md');
    h.push('/c.md');

    expect(h.current()?.filePath).toBe('/c.md');
    expect(h.canGoBack()).toBe(true);
    expect(h.canGoForward()).toBe(false);

    expect(h.back()?.filePath).toBe('/b.md');
    expect(h.back()?.filePath).toBe('/a.md');
    expect(h.back()).toBeNull();
    expect(h.canGoForward()).toBe(true);
    expect(h.forward()?.filePath).toBe('/b.md');
  });

  it('drops the forward entries when a new document is opened from the middle', () => {
    const h = new NavigationHistory();
    h.push('/a.md');
    h.push('/b.md');
    h.push('/c.md');
    h.back();
    h.push('/d.md');

    expect(h.snapshot().entries.map((e) => e.filePath)).toEqual(['/a.md', '/b.md', '/d.md']);
    expect(h.canGoForward()).toBe(false);
  });

  it('ignores a push of the document already on show', () => {
    const h = new NavigationHistory();
    h.push('/a.md');
    h.push('/a.md');
    expect(h.snapshot().entries).toHaveLength(1);
  });

  it('remembers the scroll position per entry', () => {
    const h = new NavigationHistory();
    h.push('/a.md');
    h.rememberScroll(420);
    h.push('/b.md');
    expect(h.back()?.scrollTop).toBe(420);
    expect(h.forward()?.scrollTop).toBe(0);
  });

  it('removes a document that is gone, keeping the cursor on a survivor', () => {
    const h = new NavigationHistory();
    h.push('/a.md');
    h.push('/b.md');
    h.push('/c.md');
    h.back(); // on b
    h.remove('/b.md');

    expect(h.snapshot().entries.map((e) => e.filePath)).toEqual(['/a.md', '/c.md']);
    expect(h.current()?.filePath).toBe('/a.md');
    expect(h.canGoForward()).toBe(true);
  });

  it('keeps at most the limit', () => {
    const h = new NavigationHistory(3);
    for (const p of ['/1', '/2', '/3', '/4']) h.push(p);
    expect(h.snapshot().entries.map((e) => e.filePath)).toEqual(['/2', '/3', '/4']);
    expect(h.current()?.filePath).toBe('/4');
  });
});
