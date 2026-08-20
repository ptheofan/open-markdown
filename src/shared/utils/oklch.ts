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
