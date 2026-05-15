/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { FloatingFormatToolbar } from '../../../../src/renderer/components/FloatingFormatToolbar';

describe('FloatingFormatToolbar', () => {
  it('renders a button for each formatting action', () => {
    const tb = new FloatingFormatToolbar({ onAction: vi.fn() });
    const root = tb.getElement();
    const actions = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
      .map((b) => b.dataset.action);
    expect(actions).toEqual([
      'bold', 'italic', 'strikethrough', 'code', 'link', 'clear',
    ]);
  });

  it('is hidden until show() is called', () => {
    const tb = new FloatingFormatToolbar({ onAction: vi.fn() });
    expect(tb.getElement().hidden).toBe(true);
    tb.show(document.createElement('div'));
    expect(tb.getElement().hidden).toBe(false);
    tb.hide();
    expect(tb.getElement().hidden).toBe(true);
  });

  it('clicking a button fires onAction with that action name', () => {
    const onAction = vi.fn();
    const tb = new FloatingFormatToolbar({ onAction });
    tb.getElement().querySelector<HTMLButtonElement>('[data-action="italic"]')!.click();
    expect(onAction).toHaveBeenCalledWith('italic');
  });

  it('setActiveMarks toggles the is-active class on matching buttons', () => {
    const tb = new FloatingFormatToolbar({ onAction: vi.fn() });
    tb.setActiveMarks(['bold', 'code']);
    const root = tb.getElement();
    expect(root.querySelector('[data-action="bold"]')!.classList.contains('is-active')).toBe(true);
    expect(root.querySelector('[data-action="code"]')!.classList.contains('is-active')).toBe(true);
    expect(root.querySelector('[data-action="italic"]')!.classList.contains('is-active')).toBe(false);
  });
});
