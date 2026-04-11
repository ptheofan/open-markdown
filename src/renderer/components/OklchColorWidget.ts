/**
 * OklchColorWidget - Canvas-based OKLCH color picker
 *
 * A 2D Lightness x Chroma color plane for a given hue, plus a horizontal
 * hue strip. Uses inline OKLCH-to-sRGB math with no external dependencies.
 * The sRGB gamut boundary appears naturally as a curve -- pixels outside
 * the gamut are rendered dimmed.
 */

export interface OklchWidgetOptions {
  lightness: number; // 0-100 (percentage, matching OklchComponents)
  chroma: number; // 0-0.4
  hue: number; // 0-360
}

const CANVAS_WIDTH = 240;
const CANVAS_HEIGHT = 160;
const HUE_STRIP_HEIGHT = 16;
const MAX_CHROMA = 0.37;

/**
 * Apply sRGB gamma companding to a linear channel value.
 */
function gammaEncode(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Convert OKLCH to sRGB values (0-255) with gamut info.
 * Returns null if out of gamut.
 */
function oklchToSrgb(
  L: number,
  C: number,
  cosH: number,
  sinH: number
): [number, number, number] | null {
  // OKLCH -> OKLab
  const Lok = L / 100;
  const a = C * cosH;
  const b = C * sinH;

  // OKLab -> LMS (cube root domain)
  const l_ = Lok + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = Lok - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = Lok - 0.0894841775 * a - 1.291485548 * b;

  // Cube to get LMS
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // LMS -> linear sRGB
  const rl = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gl = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  // Gamut check
  if (
    rl < -0.001 ||
    rl > 1.001 ||
    gl < -0.001 ||
    gl > 1.001 ||
    bl < -0.001 ||
    bl > 1.001
  ) {
    return null;
  }

  // Clamp to [0, 1] for tiny floating point overshoots
  const rc = Math.max(0, Math.min(1, rl));
  const gc = Math.max(0, Math.min(1, gl));
  const bc = Math.max(0, Math.min(1, bl));

  // Gamma encode and convert to 0-255
  const r = Math.round(gammaEncode(rc) * 255);
  const g = Math.round(gammaEncode(gc) * 255);
  const bv = Math.round(gammaEncode(bc) * 255);

  return [r, g, bv];
}

export class OklchColorWidget {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private hueCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hueCtx: CanvasRenderingContext2D;

  private lightness: number;
  private chroma: number;
  private hue: number;

  private cosH: number;
  private sinH: number;

  /** Cached ImageData of the L*C plane (without crosshair). */
  private cachedImageData: ImageData | null = null;

  private onChange: ((l: number, c: number, h: number) => void) | null = null;

  private draggingCanvas = false;
  private draggingHue = false;

  // Bound handlers for cleanup
  private readonly boundCanvasMouseDown: (e: MouseEvent) => void;
  private readonly boundHueMouseDown: (e: MouseEvent) => void;
  private readonly boundDocMouseMove: (e: MouseEvent) => void;
  private readonly boundDocMouseUp: () => void;

  constructor(options: OklchWidgetOptions) {
    this.lightness = options.lightness;
    this.chroma = options.chroma;
    this.hue = options.hue;

    const hRad = (this.hue * Math.PI) / 180;
    this.cosH = Math.cos(hRad);
    this.sinH = Math.sin(hRad);

    // Build DOM
    this.container = document.createElement('div');
    this.container.className = 'oklch-widget';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'oklch-widget-canvas';
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.container.appendChild(this.canvas);

    this.hueCanvas = document.createElement('canvas');
    this.hueCanvas.className = 'oklch-widget-hue';
    this.hueCanvas.width = CANVAS_WIDTH;
    this.hueCanvas.height = HUE_STRIP_HEIGHT;
    this.container.appendChild(this.hueCanvas);

    this.ctx = this.canvas.getContext('2d')!;
    this.hueCtx = this.hueCanvas.getContext('2d')!;

    // Bind event handlers
    this.boundCanvasMouseDown = this.onCanvasMouseDown.bind(this);
    this.boundHueMouseDown = this.onHueMouseDown.bind(this);
    this.boundDocMouseMove = this.onDocMouseMove.bind(this);
    this.boundDocMouseUp = this.onDocMouseUp.bind(this);

    this.canvas.addEventListener('mousedown', this.boundCanvasMouseDown);
    this.hueCanvas.addEventListener('mousedown', this.boundHueMouseDown);
    document.addEventListener('mousemove', this.boundDocMouseMove);
    document.addEventListener('mouseup', this.boundDocMouseUp);

    // Initial render
    this.renderAll();
  }

  getElement(): HTMLElement {
    return this.container;
  }

  setValues(l: number, c: number, h: number): void {
    const hueChanged = h !== this.hue;
    this.lightness = l;
    this.chroma = c;
    this.hue = h;

    if (hueChanged) {
      const hRad = (this.hue * Math.PI) / 180;
      this.cosH = Math.cos(hRad);
      this.sinH = Math.sin(hRad);
      this.renderAll();
    } else {
      this.renderCrosshairOnly();
    }
  }

  setOnChange(callback: (l: number, c: number, h: number) => void): void {
    this.onChange = callback;
  }

  destroy(): void {
    this.canvas.removeEventListener('mousedown', this.boundCanvasMouseDown);
    this.hueCanvas.removeEventListener('mousedown', this.boundHueMouseDown);
    document.removeEventListener('mousemove', this.boundDocMouseMove);
    document.removeEventListener('mouseup', this.boundDocMouseUp);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private renderAll(): void {
    this.renderCanvasPixels();
    this.renderCrosshairOnly();
    this.renderHueStrip();
  }

  /**
   * Render the L*C plane pixel-by-pixel into cachedImageData.
   */
  private renderCanvasPixels(): void {
    const width = CANVAS_WIDTH;
    const height = CANVAS_HEIGHT;
    const imageData = this.ctx.createImageData(width, height);
    const data = imageData.data;
    const cosH = this.cosH;
    const sinH = this.sinH;

    for (let py = 0; py < height; py++) {
      // Y axis: lightness, 100 at top, 0 at bottom
      const L = (1 - py / (height - 1)) * 100;

      for (let px = 0; px < width; px++) {
        const C = (px / (width - 1)) * MAX_CHROMA;
        const idx = (py * width + px) * 4;

        const rgb = oklchToSrgb(L, C, cosH, sinH);

        if (rgb) {
          data[idx] = rgb[0];
          data[idx + 1] = rgb[1];
          data[idx + 2] = rgb[2];
          data[idx + 3] = 255;
        } else {
          // Out of gamut: dimmed #222 background with low alpha blend
          // Compute the color anyway for a tinted dim effect
          const Lok = L / 100;
          const a = C * cosH;
          const b = C * sinH;
          const l_ = Lok + 0.3963377774 * a + 0.2158037573 * b;
          const m_ = Lok - 0.1055613458 * a - 0.0638541728 * b;
          const s_ = Lok - 0.0894841775 * a - 1.291485548 * b;
          const lv = l_ * l_ * l_;
          const mv = m_ * m_ * m_;
          const sv = s_ * s_ * s_;
          const rl = +4.0767416621 * lv - 3.3077115913 * mv + 0.2309699292 * sv;
          const gl = -1.2684380046 * lv + 2.6097574011 * mv - 0.3413193965 * sv;
          const bl = -0.0041960863 * lv - 0.7034186147 * mv + 1.707614701 * sv;

          // Clamp to sRGB for display, then blend at 20/255 alpha over #222
          const rc = Math.max(0, Math.min(1, rl));
          const gc = Math.max(0, Math.min(1, gl));
          const bc = Math.max(0, Math.min(1, bl));
          const alpha = 20 / 255;
          const bgR = 0x22;
          const bgG = 0x22;
          const bgB = 0x22;

          data[idx] = Math.round(
            bgR * (1 - alpha) + gammaEncode(rc) * 255 * alpha
          );
          data[idx + 1] = Math.round(
            bgG * (1 - alpha) + gammaEncode(gc) * 255 * alpha
          );
          data[idx + 2] = Math.round(
            bgB * (1 - alpha) + gammaEncode(bc) * 255 * alpha
          );
          data[idx + 3] = 255;
        }
      }
    }

    this.cachedImageData = imageData;
  }

  /**
   * Restore the cached pixel data and draw the crosshair on top.
   */
  private renderCrosshairOnly(): void {
    if (!this.cachedImageData) {
      this.renderCanvasPixels();
    }
    this.ctx.putImageData(this.cachedImageData!, 0, 0);
    this.drawCrosshair();
  }

  /**
   * Draw the crosshair circle at the current (L, C) position.
   */
  private drawCrosshair(): void {
    const cx = (this.chroma / MAX_CHROMA) * CANVAS_WIDTH;
    const cy = (1 - this.lightness / 100) * CANVAS_HEIGHT;

    // Determine stroke colors based on lightness
    const outerColor = this.lightness > 55 ? '#000000' : '#ffffff';
    const innerColor = this.lightness > 55 ? '#ffffff' : '#000000';

    // Outer ring
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    this.ctx.strokeStyle = outerColor;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Inner ring
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    this.ctx.strokeStyle = innerColor;
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }

  /**
   * Render the hue strip and its marker.
   */
  private renderHueStrip(): void {
    const width = CANVAS_WIDTH;
    const height = HUE_STRIP_HEIGHT;
    const imageData = this.hueCtx.createImageData(width, height);
    const data = imageData.data;

    // Precompute: each column is a single hue at L=70%, C=0.15
    const L = 70;
    const C = 0.15;

    for (let px = 0; px < width; px++) {
      const h = (px / (width - 1)) * 360;
      const hRad = (h * Math.PI) / 180;
      const cosHue = Math.cos(hRad);
      const sinHue = Math.sin(hRad);

      const rgb = oklchToSrgb(L, C, cosHue, sinHue);

      // These values should all be in gamut at L=70% C=0.15
      const r = rgb ? rgb[0] : 128;
      const g = rgb ? rgb[1] : 128;
      const b = rgb ? rgb[2] : 128;

      // Fill the entire column
      for (let py = 0; py < height; py++) {
        const idx = (py * width + px) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    this.hueCtx.putImageData(imageData, 0, 0);

    // Draw hue marker
    this.drawHueMarker();
  }

  /**
   * Draw a vertical marker line on the hue strip at the current hue.
   */
  private drawHueMarker(): void {
    const x = (this.hue / 360) * CANVAS_WIDTH;
    const height = HUE_STRIP_HEIGHT;

    // Dark outline
    this.hueCtx.beginPath();
    this.hueCtx.moveTo(x, 0);
    this.hueCtx.lineTo(x, height);
    this.hueCtx.strokeStyle = '#000000';
    this.hueCtx.lineWidth = 3;
    this.hueCtx.stroke();

    // White line
    this.hueCtx.beginPath();
    this.hueCtx.moveTo(x, 0);
    this.hueCtx.lineTo(x, height);
    this.hueCtx.strokeStyle = '#ffffff';
    this.hueCtx.lineWidth = 1;
    this.hueCtx.stroke();
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  private onCanvasMouseDown(e: MouseEvent): void {
    this.draggingCanvas = true;
    this.updateFromCanvasEvent(e);
  }

  private onHueMouseDown(e: MouseEvent): void {
    this.draggingHue = true;
    this.updateFromHueEvent(e);
  }

  private onDocMouseMove(e: MouseEvent): void {
    if (this.draggingCanvas) {
      this.updateFromCanvasEvent(e);
    } else if (this.draggingHue) {
      this.updateFromHueEvent(e);
    }
  }

  private onDocMouseUp(): void {
    this.draggingCanvas = false;
    this.draggingHue = false;
  }

  private updateFromCanvasEvent(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.chroma = Math.max(
      0,
      Math.min(MAX_CHROMA, (x / rect.width) * MAX_CHROMA)
    );
    this.lightness = Math.max(
      0,
      Math.min(100, (1 - y / rect.height) * 100)
    );

    this.renderCrosshairOnly();
    this.onChange?.(this.lightness, this.chroma, this.hue);
  }

  private updateFromHueEvent(e: MouseEvent): void {
    const rect = this.hueCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    this.hue = Math.max(0, Math.min(360, (x / rect.width) * 360));

    const hRad = (this.hue * Math.PI) / 180;
    this.cosH = Math.cos(hRad);
    this.sinH = Math.sin(hRad);

    this.renderAll();
    this.onChange?.(this.lightness, this.chroma, this.hue);
  }
}
