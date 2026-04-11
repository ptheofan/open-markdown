import { describe, it, expect } from 'vitest';
import { generateTypographyCSS } from '../../../src/themes/index';
import { DEFAULT_CORE_PREFERENCES } from '../../../src/preferences/defaults';

describe('generateTypographyCSS doc variable naming', () => {
  it('produces --doc-h1-color variable', () => {
    const css = generateTypographyCSS(DEFAULT_CORE_PREFERENCES, 'light');
    expect(css).toContain('--doc-h1-color:');
  });

  it('uses light color for h1 in light theme', () => {
    const css = generateTypographyCSS(DEFAULT_CORE_PREFERENCES, 'light');
    expect(css).toContain(`--doc-h1-color: ${DEFAULT_CORE_PREFERENCES.typography.h1.color.light}`);
  });

  it('uses dark color for h1 in dark theme', () => {
    const css = generateTypographyCSS(DEFAULT_CORE_PREFERENCES, 'dark');
    expect(css).toContain(`--doc-h1-color: ${DEFAULT_CORE_PREFERENCES.typography.h1.color.dark}`);
  });

  it('reflects updated h1 color', () => {
    const modified = structuredClone(DEFAULT_CORE_PREFERENCES);
    modified.typography.h1.color.light = 'oklch(60% 0.2 30)';
    const css = generateTypographyCSS(modified, 'light');
    expect(css).toContain('--doc-h1-color: oklch(60% 0.2 30)');
  });

  it('produces --doc-bg-color variable', () => {
    const css = generateTypographyCSS(DEFAULT_CORE_PREFERENCES, 'light');
    expect(css).toContain('--doc-bg-color:');
  });

  it('all doc variables use --doc- prefix', () => {
    const css = generateTypographyCSS(DEFAULT_CORE_PREFERENCES, 'light');
    const varPattern = /--[\w-]+:/g;
    const vars = css.match(varPattern) ?? [];
    for (const v of vars) {
      expect(v).toMatch(/^--doc-/);
    }
  });
});
