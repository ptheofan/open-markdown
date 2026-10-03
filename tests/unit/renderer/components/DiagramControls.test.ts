/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDiagramControls } from '@renderer/components/DiagramControls';

function diagramHtml(id: string): string {
  return `<div class="mermaid-container mermaid-rendered" id="${id}"><svg xmlns="http://www.w3.org/2000/svg"><title>Flow</title><g></g></svg></div>`;
}

describe('DiagramControls', () => {
  let container: HTMLElement;
  let onOpenLightbox: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = `<div id="c">${diagramHtml('d1')}<div class="mermaid-container"><div class="mermaid-loading"></div></div></div>`;
    container = document.getElementById('c')!;
    onOpenLightbox = vi.fn();
  });

  it('adds a toolbar to rendered diagrams only, once', () => {
    const controls = createDiagramControls({ onOpenLightbox });
    controls.attach(container);
    controls.attach(container);
    expect(container.querySelectorAll('.diagram-toolbar')).toHaveLength(1);
    expect(container.querySelector('#d1 .diagram-toolbar')).not.toBeNull();
  });

  it('zooms the SVG with the buttons and fits it back', () => {
    const controls = createDiagramControls({ onOpenLightbox });
    controls.attach(container);
    const diagram = container.querySelector<HTMLElement>('#d1')!;
    const svg = diagram.querySelector<SVGSVGElement>('svg')!;

    diagram.querySelector<HTMLButtonElement>('[data-diagram-zoom-in]')!.click();
    expect(controls.getZoom(diagram)).toBeCloseTo(1.25);
    expect(svg.style.transform).toContain('scale(1.25)');
    expect(diagram.classList.contains('diagram-zoomed')).toBe(true);

    diagram.querySelector<HTMLButtonElement>('[data-diagram-fit]')!.click();
    expect(controls.getZoom(diagram)).toBe(1);
    expect(svg.style.transform).toBe('');
    expect(diagram.classList.contains('diagram-zoomed')).toBe(false);
  });

  it('zooms on Cmd/Ctrl+wheel and keeps the event from the page zoom', () => {
    const controls = createDiagramControls({ onOpenLightbox });
    controls.attach(container);
    const diagram = container.querySelector<HTMLElement>('#d1')!;
    const reachedPage = vi.fn();
    container.addEventListener('wheel', reachedPage);

    const zoomWheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    diagram.dispatchEvent(zoomWheel);
    expect(controls.getZoom(diagram)).toBeGreaterThan(1);
    expect(zoomWheel.defaultPrevented).toBe(true);
    expect(reachedPage).not.toHaveBeenCalled();

    const scroll = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    diagram.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
    expect(reachedPage).toHaveBeenCalled();
  });

  it('hands the SVG to the lightbox with its title', () => {
    const controls = createDiagramControls({ onOpenLightbox });
    controls.attach(container);
    const diagram = container.querySelector<HTMLElement>('#d1')!;
    diagram.querySelector<HTMLButtonElement>('[data-diagram-expand]')!.click();
    expect(onOpenLightbox).toHaveBeenCalledWith(diagram.querySelector('svg'), 'Flow');
  });

  it('pans by dragging once zoomed', () => {
    const controls = createDiagramControls({ onOpenLightbox });
    controls.attach(container);
    const diagram = container.querySelector<HTMLElement>('#d1')!;
    const svg = diagram.querySelector<SVGSVGElement>('svg')!;

    const down = (): void => {
      diagram.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, bubbles: true }));
      diagram.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 25, bubbles: true }));
      diagram.dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: 25, bubbles: true }));
    };

    down();
    expect(svg.style.transform).toBe('');

    controls.zoomBy(diagram, 2);
    down();
    expect(svg.style.transform).toContain('translate(30px, 15px)');
  });
});
