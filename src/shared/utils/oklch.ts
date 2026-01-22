/**
 * OKLCH Color Utilities
 *
 * Provides parsing, formatting, validation, and conversion utilities
 * for OKLCH color format. Uses Color.js for accurate color space conversions.
 */

import Color from 'colorjs.io';

import type { OklchColor } from '@shared/types';

/**
 * Parsed OKLCH color components
 */
export interface OklchComponents {
  lightness: number; // 0-100 (percentage)
  chroma: number; // 0-0.4 (typically, can exceed)
  hue: number; // 0-360 (degrees)
  alpha: number; // 0-1 (default: 1)
}

/**
 * Regular expression for parsing OKLCH color strings
 * Matches formats:
 *   - oklch(L% C H)
 *   - oklch(L% C H / A)
 *   - oklch(L C H)
 *   - oklch(L C H / A)
 */
const OKLCH_REGEX =
  /^\s*oklch\(\s*(\d+(?:\.\d+)?%?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?%?))?\s*\)\s*$/i;

/**
 * Parse an OKLCH color string into components
 */
export function parseOklch(color: string): OklchComponents | null {
  const match = color.match(OKLCH_REGEX);
  if (!match) {
    return null;
  }

  const lightnessStr = match[1];
  const chromaStr = match[2];
  const hueStr = match[3];
  const alphaStr = match[4];

  // Guard against undefined (shouldn't happen if regex matched, but TypeScript needs this)
  if (!lightnessStr || !chromaStr || !hueStr) {
    return null;
  }

  // Parse lightness (handle percentage)
  let lightness: number;
  if (lightnessStr.endsWith('%')) {
    lightness = parseFloat(lightnessStr);
  } else {
    // If not percentage, assume 0-1 scale and convert to percentage
    lightness = parseFloat(lightnessStr) * 100;
  }

  const chroma = parseFloat(chromaStr);
  const hue = parseFloat(hueStr);

  // Parse alpha (default 1, handle percentage)
  let alpha = 1;
  if (alphaStr !== undefined) {
    if (alphaStr.endsWith('%')) {
      alpha = parseFloat(alphaStr) / 100;
    } else {
      alpha = parseFloat(alphaStr);
    }
  }

  // Validate ranges
  if (
    isNaN(lightness) ||
    isNaN(chroma) ||
    isNaN(hue) ||
    isNaN(alpha) ||
    lightness < 0 ||
    lightness > 100 ||
    chroma < 0 ||
    hue < 0 ||
    hue > 360 ||
    alpha < 0 ||
    alpha > 1
  ) {
    return null;
  }

  return { lightness, chroma, hue, alpha };
}

/**
 * Format OKLCH components into a valid CSS string
 * Always includes alpha for consistency
 */
export function formatOklch(components: OklchComponents): OklchColor {
  const { lightness, chroma, hue, alpha } = components;
  const l = Math.round(lightness * 100) / 100;
  const c = Math.round(chroma * 1000) / 1000;
  const h = Math.round(hue * 10) / 10;
  const a = Math.round(alpha * 100) / 100;

  if (a === 1) {
    return `oklch(${l}% ${c} ${h})`;
  }
  return `oklch(${l}% ${c} ${h} / ${a})`;
}

/**
 * Validate an OKLCH color string
 */
export function isValidOklch(color: string): boolean {
  return parseOklch(color) !== null;
}

/**
 * Convert hex color to OKLCH
 */
export function hexToOklch(hex: string): OklchColor {
  try {
    const color = new Color(hex);
    const oklch = color.oklch;
    const l = oklch.l ?? 0;
    const c = oklch.c ?? 0;
    const h = oklch.h ?? 0; // Hue can be NaN for achromatic colors
    return formatOklch({
      lightness: l * 100,
      chroma: c,
      hue: Number.isNaN(h) ? 0 : h,
      alpha: color.alpha,
    });
  } catch {
    throw new Error(`Invalid hex color: ${hex}`);
  }
}

/**
 * Convert RGB color to OKLCH
 */
export function rgbToOklch(
  r: number,
  g: number,
  b: number,
  a: number = 1
): OklchColor {
  try {
    const color = new Color('srgb', [r / 255, g / 255, b / 255], a);
    const oklch = color.oklch;
    const l = oklch.l ?? 0;
    const c = oklch.c ?? 0;
    const h = oklch.h ?? 0;
    return formatOklch({
      lightness: l * 100,
      chroma: c,
      hue: Number.isNaN(h) ? 0 : h,
      alpha: a,
    });
  } catch {
    throw new Error(`Invalid RGB values: r=${r}, g=${g}, b=${b}`);
  }
}

/**
 * Convert OKLCH to hex color
 */
export function oklchToHex(oklchColor: OklchColor): string {
  const components = parseOklch(oklchColor);
  if (!components) {
    throw new Error(`Invalid OKLCH color: ${oklchColor}`);
  }

  const color = new Color('oklch', [
    components.lightness / 100,
    components.chroma,
    components.hue,
  ]);
  color.alpha = components.alpha;

  return color.to('srgb').toString({ format: 'hex' });
}

/**
 * Convert OKLCH to RGB values (0-255)
 */
export function oklchToRgb(
  oklchColor: OklchColor
): { r: number; g: number; b: number; a: number } {
  const components = parseOklch(oklchColor);
  if (!components) {
    throw new Error(`Invalid OKLCH color: ${oklchColor}`);
  }

  const color = new Color('oklch', [
    components.lightness / 100,
    components.chroma,
    components.hue,
  ]);
  color.alpha = components.alpha;

  const srgb = color.to('srgb');
  const coords = srgb.coords;
  return {
    r: Math.round((coords[0] ?? 0) * 255),
    g: Math.round((coords[1] ?? 0) * 255),
    b: Math.round((coords[2] ?? 0) * 255),
    a: components.alpha,
  };
}

/**
 * Clamp OKLCH values to valid ranges
 */
export function clampOklch(components: OklchComponents): OklchComponents {
  return {
    lightness: Math.max(0, Math.min(100, components.lightness)),
    chroma: Math.max(0, components.chroma), // No upper bound, but usually < 0.4
    hue: ((components.hue % 360) + 360) % 360, // Normalize to 0-360
    alpha: Math.max(0, Math.min(1, components.alpha)),
  };
}

/**
 * Interpolate between two OKLCH colors
 * Useful for gradient previews
 */
export function interpolateOklch(
  from: OklchColor,
  to: OklchColor,
  t: number
): OklchColor {
  const fromComponents = parseOklch(from);
  const toComponents = parseOklch(to);

  if (!fromComponents || !toComponents) {
    throw new Error('Invalid OKLCH colors for interpolation');
  }

  // Clamp t to 0-1
  const clampedT = Math.max(0, Math.min(1, t));

  // Handle hue interpolation (shortest path around the circle)
  let hueDiff = toComponents.hue - fromComponents.hue;
  if (hueDiff > 180) hueDiff -= 360;
  if (hueDiff < -180) hueDiff += 360;

  return formatOklch({
    lightness:
      fromComponents.lightness +
      (toComponents.lightness - fromComponents.lightness) * clampedT,
    chroma:
      fromComponents.chroma +
      (toComponents.chroma - fromComponents.chroma) * clampedT,
    hue: ((fromComponents.hue + hueDiff * clampedT) % 360 + 360) % 360,
    alpha:
      fromComponents.alpha +
      (toComponents.alpha - fromComponents.alpha) * clampedT,
  });
}

/**
 * Adjust lightness of an OKLCH color
 */
export function adjustLightness(
  color: OklchColor,
  delta: number
): OklchColor {
  const components = parseOklch(color);
  if (!components) {
    throw new Error(`Invalid OKLCH color: ${color}`);
  }

  return formatOklch(
    clampOklch({
      ...components,
      lightness: components.lightness + delta,
    })
  );
}

/**
 * Adjust chroma (saturation) of an OKLCH color
 */
export function adjustChroma(color: OklchColor, delta: number): OklchColor {
  const components = parseOklch(color);
  if (!components) {
    throw new Error(`Invalid OKLCH color: ${color}`);
  }

  return formatOklch(
    clampOklch({
      ...components,
      chroma: components.chroma + delta,
    })
  );
}

/**
 * Adjust hue of an OKLCH color
 */
export function adjustHue(color: OklchColor, delta: number): OklchColor {
  const components = parseOklch(color);
  if (!components) {
    throw new Error(`Invalid OKLCH color: ${color}`);
  }

  return formatOklch(
    clampOklch({
      ...components,
      hue: components.hue + delta,
    })
  );
}

/**
 * Set alpha of an OKLCH color
 */
export function setAlpha(color: OklchColor, alpha: number): OklchColor {
  const components = parseOklch(color);
  if (!components) {
    throw new Error(`Invalid OKLCH color: ${color}`);
  }

  return formatOklch({
    ...components,
    alpha: Math.max(0, Math.min(1, alpha)),
  });
}
