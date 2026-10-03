/**
 * DiagramControls - zoom and pan for rendered diagrams
 *
 * A big flowchart squeezed into the column is unreadable. Each diagram gets
 * a hover toolbar (zoom in, zoom out, fit, open in the lightbox), zooms in
 * place on pinch or Cmd/Ctrl+wheel, and pans by dragging once zoomed. The
 * right-click menu the diagram already has is untouched.
 */

export interface DiagramControlsCallbacks {
  /** Open the diagram's SVG in the lightbox */
  onOpenLightbox: (svg: SVGSVGElement, caption: string) => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const STEP = 1.25;
const ATTACHED_ATTR = 'data-diagram-controls';

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export class DiagramControls {
  private readonly states = new WeakMap<HTMLElement, ViewState>();

  constructor(private readonly callbacks: DiagramControlsCallbacks) {}

  /**
   * Give every rendered diagram in the container its controls. Safe to call
   * after each render; containers already set up are skipped.
   */
  attach(container: HTMLElement): void {
    const diagrams = container.querySelectorAll<HTMLElement>('.mermaid-container.mermaid-rendered');
    for (const diagram of diagrams) {
      if (diagram.hasAttribute(ATTACHED_ATTR)) continue;
      if (!diagram.querySelector('svg')) continue;
      this.setup(diagram);
    }
  }

  private setup(diagram: HTMLElement): void {
    diagram.setAttribute(ATTACHED_ATTR, '');
    this.states.set(diagram, { zoom: 1, panX: 0, panY: 0 });

    const toolbar = document.createElement('div');
    toolbar.className = 'diagram-toolbar';
    toolbar.setAttribute('aria-label', 'Diagram controls');
    toolbar.innerHTML = `
      <button type="button" class="diagram-btn" data-diagram-zoom-out title="Zoom out" aria-label="Zoom out">−</button>
      <button type="button" class="diagram-btn" data-diagram-zoom-in title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" class="diagram-btn" data-diagram-fit title="Fit" aria-label="Fit">Fit</button>
      <button type="button" class="diagram-btn" data-diagram-expand title="Open large" aria-label="Open large">⤢</button>
    `;
    toolbar.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as Element;
      if (target.closest('[data-diagram-zoom-in]')) this.zoomBy(diagram, STEP);
      else if (target.closest('[data-diagram-zoom-out]')) this.zoomBy(diagram, 1 / STEP);
      else if (target.closest('[data-diagram-fit]')) this.reset(diagram);
      else if (target.closest('[data-diagram-expand]')) this.expand(diagram);
    });
    toolbar.addEventListener('mousedown', (e) => e.preventDefault());
    diagram.appendChild(toolbar);

    diagram.addEventListener(
      'wheel',
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        // Ours, not the page zoom's
        e.preventDefault();
        e.stopPropagation();
        const factor = Math.exp(-e.deltaY * 0.01);
        this.zoomBy(diagram, factor);
      },
      { passive: false }
    );

    let drag: { x: number; y: number; panX: number; panY: number } | null = null;
    diagram.addEventListener('pointerdown', (e) => {
      const state = this.states.get(diagram);
      if (!state || state.zoom <= 1 || e.button !== 0) return;
      if ((e.target as Element).closest('.diagram-toolbar')) return;
      drag = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
      diagram.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    diagram.addEventListener('pointermove', (e) => {
      const state = this.states.get(diagram);
      if (!drag || !state) return;
      state.panX = drag.panX + (e.clientX - drag.x);
      state.panY = drag.panY + (e.clientY - drag.y);
      this.apply(diagram);
    });
    const endDrag = (e: PointerEvent): void => {
      if (!drag) return;
      drag = null;
      diagram.releasePointerCapture?.(e.pointerId);
    };
    diagram.addEventListener('pointerup', endDrag);
    diagram.addEventListener('pointercancel', endDrag);
  }

  /** The zoom a diagram is at; 1 when untouched or unknown */
  getZoom(diagram: HTMLElement): number {
    return this.states.get(diagram)?.zoom ?? 1;
  }

  zoomBy(diagram: HTMLElement, factor: number): void {
    const state = this.states.get(diagram);
    if (!state) return;
    state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor));
    if (state.zoom <= 1) {
      state.panX = 0;
      state.panY = 0;
    }
    this.apply(diagram);
  }

  reset(diagram: HTMLElement): void {
    const state = this.states.get(diagram);
    if (!state) return;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    this.apply(diagram);
  }

  private expand(diagram: HTMLElement): void {
    const svg = diagram.querySelector('svg');
    if (!svg) return;
    const caption = diagram.querySelector('svg title')?.textContent?.trim() || 'Diagram';
    this.callbacks.onOpenLightbox(svg, caption);
  }

  private apply(diagram: HTMLElement): void {
    const state = this.states.get(diagram);
    const svg = diagram.querySelector<SVGSVGElement>('svg');
    if (!state || !svg) return;
    svg.style.transformOrigin = 'center top';
    svg.style.transform =
      state.zoom === 1 && state.panX === 0 && state.panY === 0
        ? ''
        : `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    diagram.classList.toggle('diagram-zoomed', state.zoom > 1);
    diagram.dataset['diagramZoom'] = state.zoom.toFixed(2);
  }
}

export function createDiagramControls(callbacks: DiagramControlsCallbacks): DiagramControls {
  return new DiagramControls(callbacks);
}
