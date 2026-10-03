/**
 * Lightbox - an image or diagram on a dark backdrop, at natural size
 *
 * A screenshot or a wide diagram is hard to read at the column's width.
 * Click one and it opens here: scroll-wheel or pinch zooms, dragging pans
 * when it is larger than the window, `0` resets, `+` and `-` zoom, Esc or a
 * click on the backdrop closes. Diagrams are shown as their SVG, so text in
 * them stays crisp at any zoom.
 */

export interface LightboxContent {
  /** An image URL, or null when an SVG element is given */
  src?: string;
  /** An SVG to show instead of an image; it is cloned */
  svg?: SVGSVGElement;
  /** Shown under the picture */
  caption: string;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const STEP = 1.25;

export class Lightbox {
  private overlay: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private zoomLabel: HTMLElement | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private dragging: { x: number; y: number; panX: number; panY: number } | null = null;

  constructor(private readonly container: HTMLElement = document.body) {}

  isOpen(): boolean {
    return this.overlay !== null;
  }

  getZoom(): number {
    return this.zoom;
  }

  open(content: LightboxContent): void {
    this.close();

    const overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="lightbox-toolbar">
        <button type="button" class="lightbox-btn" data-lightbox-zoom-out title="Zoom out (-)" aria-label="Zoom out">−</button>
        <span class="lightbox-zoom" aria-live="polite">100%</span>
        <button type="button" class="lightbox-btn" data-lightbox-zoom-in title="Zoom in (+)" aria-label="Zoom in">+</button>
        <button type="button" class="lightbox-btn" data-lightbox-reset title="Actual size (0)" aria-label="Actual size">1:1</button>
        <button type="button" class="lightbox-btn lightbox-close" data-lightbox-close title="Close (Esc)" aria-label="Close">×</button>
      </div>
      <div class="lightbox-stage"></div>
      <div class="lightbox-caption"></div>
    `;

    const stage = overlay.querySelector<HTMLElement>('.lightbox-stage')!;
    if (content.svg) {
      const svg = content.svg.cloneNode(true) as SVGSVGElement;
      svg.removeAttribute('id');
      svg.classList.add('lightbox-picture');
      // Let the SVG take its drawn size instead of the column it came from
      svg.style.maxWidth = 'none';
      svg.style.width = '';
      svg.style.height = '';
      stage.appendChild(svg);
    } else if (content.src) {
      const img = document.createElement('img');
      img.className = 'lightbox-picture';
      img.src = content.src;
      img.alt = content.caption;
      img.draggable = false;
      stage.appendChild(img);
    }
    overlay.querySelector('.lightbox-caption')!.textContent = content.caption;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target === stage) this.close();
    });
    overlay.querySelector('[data-lightbox-close]')?.addEventListener('click', () => this.close());
    overlay.querySelector('[data-lightbox-zoom-in]')?.addEventListener('click', () => this.zoomBy(STEP));
    overlay.querySelector('[data-lightbox-zoom-out]')?.addEventListener('click', () => this.zoomBy(1 / STEP));
    overlay.querySelector('[data-lightbox-reset]')?.addEventListener('click', () => this.reset());

    overlay.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    stage.addEventListener('pointermove', (e) => this.onPointerMove(e));
    stage.addEventListener('pointerup', (e) => this.onPointerUp(e));
    stage.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    this.onKeyDown = (e: KeyboardEvent): void => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          this.close();
          break;
        case '+':
        case '=':
          e.preventDefault();
          this.zoomBy(STEP);
          break;
        case '-':
        case '_':
          e.preventDefault();
          this.zoomBy(1 / STEP);
          break;
        case '0':
          e.preventDefault();
          this.reset();
          break;
      }
    };
    document.addEventListener('keydown', this.onKeyDown, true);

    this.container.appendChild(overlay);
    this.overlay = overlay;
    this.stage = stage;
    this.zoomLabel = overlay.querySelector('.lightbox-zoom');
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.apply();
  }

  close(): void {
    if (this.onKeyDown) {
      document.removeEventListener('keydown', this.onKeyDown, true);
      this.onKeyDown = null;
    }
    this.overlay?.remove();
    this.overlay = null;
    this.stage = null;
    this.zoomLabel = null;
    this.dragging = null;
  }

  /** Multiply the zoom, keeping it within bounds */
  zoomBy(factor: number): void {
    this.setZoom(this.zoom * factor);
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.apply();
  }

  reset(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.apply();
  }

  private picture(): HTMLElement | null {
    return this.stage?.querySelector<HTMLElement>('.lightbox-picture') ?? null;
  }

  private apply(): void {
    const picture = this.picture();
    if (picture) {
      picture.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }
    if (this.zoomLabel) {
      this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    }
    this.stage?.classList.toggle('lightbox-stage-zoomed', this.zoom > 1);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    // A pinch arrives as a wheel with ctrlKey; both zoom here
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
    this.setZoom(this.zoom * factor);
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this.picture()) return;
    if (!(e.target instanceof Element) || !e.target.closest('.lightbox-picture')) return;
    this.dragging = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    this.panX = this.dragging.panX + (e.clientX - this.dragging.x);
    this.panY = this.dragging.panY + (e.clientY - this.dragging.y);
    this.apply();
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }
}

export function createLightbox(container?: HTMLElement): Lightbox {
  return new Lightbox(container);
}
