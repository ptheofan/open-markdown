/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createLightbox } from '@renderer/components/Lightbox';

describe('Lightbox', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens an image with its caption and closes on Escape', () => {
    const box = createLightbox();
    box.open({ src: 'om-asset://local/pic.png', caption: 'docs/pic.png' });

    expect(box.isOpen()).toBe(true);
    const img = document.querySelector<HTMLImageElement>('.lightbox-picture');
    expect(img?.getAttribute('src')).toBe('om-asset://local/pic.png');
    expect(document.querySelector('.lightbox-caption')?.textContent).toBe('docs/pic.png');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(box.isOpen()).toBe(false);
    expect(document.querySelector('.lightbox')).toBeNull();
  });

  it('shows a clone of an SVG rather than moving it', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'diagram-1';
    document.body.appendChild(svg);

    const box = createLightbox();
    box.open({ svg, caption: 'Diagram' });

    expect(document.body.contains(svg)).toBe(true);
    const shown = document.querySelector('.lightbox-picture');
    expect(shown?.tagName.toLowerCase()).toBe('svg');
    expect(shown).not.toBe(svg);
    expect(shown?.id).toBe('');
  });

  it('zooms with keys and buttons, and resets with 0', () => {
    const box = createLightbox();
    box.open({ src: 'x.png', caption: 'x' });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    expect(box.getZoom()).toBeCloseTo(1.25);
    document.querySelector<HTMLButtonElement>('[data-lightbox-zoom-in]')!.click();
    expect(box.getZoom()).toBeCloseTo(1.5625);
    expect(document.querySelector('.lightbox-zoom')?.textContent).toBe('156%');
    expect(document.querySelector<HTMLElement>('.lightbox-picture')?.style.transform).toContain('scale(1.5625)');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
    expect(box.getZoom()).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    expect(box.getZoom()).toBeCloseTo(0.8);
  });

  it('zooms on the wheel and stays within bounds', () => {
    const box = createLightbox();
    box.open({ src: 'x.png', caption: 'x' });
    const overlay = document.querySelector<HTMLElement>('.lightbox')!;

    for (let i = 0; i < 50; i++) {
      overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, cancelable: true }));
    }
    expect(box.getZoom()).toBe(8);
    for (let i = 0; i < 100; i++) {
      overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: 500, cancelable: true }));
    }
    expect(box.getZoom()).toBe(0.1);
  });

  it('closes on a backdrop click but not on a click on the picture', () => {
    const box = createLightbox();
    box.open({ src: 'x.png', caption: 'x' });
    document.querySelector<HTMLElement>('.lightbox-picture')!.click();
    expect(box.isOpen()).toBe(true);
    document.querySelector<HTMLElement>('.lightbox')!.click();
    expect(box.isOpen()).toBe(false);
  });
});
