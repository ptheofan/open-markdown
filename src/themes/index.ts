/**
 * Theme System
 *
 * Provides runtime CSS generation from theme definitions
 * and manages theme application to the document.
 */
import type {
  ThemeVariables,
  PluginThemeDeclaration,
  ResolvedTheme,
} from './types';
import type { CorePreferences, ColorPair } from '@shared/types';
import { lightTheme } from './light';
import { darkTheme } from './dark';

// Re-export types
export type {
  ThemeVariables,
  ThemeColors,
  ThemeFonts,
  PluginThemeDeclaration,
  PluginThemeVariable,
  ThemeMode,
  ResolvedTheme,
} from './types';

// Export theme definitions
export { lightTheme } from './light';
export { darkTheme } from './dark';

/**
 * Theme registry mapping theme names to their definitions
 */
export const themes: Record<ResolvedTheme, ThemeVariables> = {
  light: lightTheme,
  dark: darkTheme,
};

/**
 * Convert camelCase to kebab-case for CSS variable names
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Generate CSS variables from a theme definition
 */
export function generateThemeCSS(theme: ThemeVariables): string {
  const lines: string[] = [];

  // Generate color variables
  for (const [key, value] of Object.entries(theme.colors)) {
    lines.push(`  --${toKebabCase(key)}: ${value};`);
  }

  // Generate font variables
  for (const [key, value] of Object.entries(theme.fonts)) {
    lines.push(`  --font-${toKebabCase(key)}: ${value};`);
  }

  return lines.join('\n');
}

/**
 * Generate CSS for plugin theme variables
 */
export function generatePluginThemeCSS(
  declarations: PluginThemeDeclaration,
  theme: ResolvedTheme
): string {
  const lines: string[] = [];

  for (const [name, values] of Object.entries(declarations)) {
    const value = theme === 'dark' ? values.dark : values.light;
    lines.push(`  --${name}: ${value};`);
  }

  return lines.join('\n');
}

/**
 * Aggregate multiple plugin theme declarations into one
 */
export function aggregatePluginThemeDeclarations(
  declarations: PluginThemeDeclaration[]
): PluginThemeDeclaration {
  const aggregated: PluginThemeDeclaration = {};

  for (const declaration of declarations) {
    for (const [name, values] of Object.entries(declaration)) {
      if (aggregated[name]) {
        console.warn(
          `[ThemeSystem] Duplicate plugin theme variable: --${name}. Using latest declaration.`
        );
      }
      aggregated[name] = values;
    }
  }

  return aggregated;
}

/**
 * Get the appropriate color from a ColorPair based on theme
 */
function getColorForTheme(colorPair: ColorPair, theme: ResolvedTheme): string {
  return theme === 'dark' ? colorPair.dark : colorPair.light;
}

/**
 * Generate typography CSS variables from core preferences
 */
export function generateTypographyCSS(
  preferences: CorePreferences,
  theme: ResolvedTheme
): string {
  const lines: string[] = [];
  const { typography, lists } = preferences;

  // Base font size
  lines.push(`  --base-font-size: ${typography.baseFontSize};`);

  // Background color from preferences
  lines.push(
    `  --user-bg-color: ${getColorForTheme(preferences.theme.background, theme)};`
  );

  // Heading styles (h1-h6)
  const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
  for (const level of headingLevels) {
    const style = typography[level];
    const prefix = `--${level}`;

    lines.push(`  ${prefix}-font-size: ${style.fontSize};`);
    lines.push(`  ${prefix}-font-weight: ${style.fontWeight};`);
    lines.push(`  ${prefix}-line-height: ${style.lineHeight};`);
    lines.push(`  ${prefix}-color: ${getColorForTheme(style.color, theme)};`);
    lines.push(`  ${prefix}-margin-top: ${style.marginTop};`);
    lines.push(`  ${prefix}-margin-bottom: ${style.marginBottom};`);

    if (style.paddingBottom) {
      lines.push(`  ${prefix}-padding-bottom: ${style.paddingBottom};`);
    }
    if (style.borderBottom) {
      lines.push(`  ${prefix}-border-width: ${style.borderBottom.width};`);
      lines.push(`  ${prefix}-border-style: ${style.borderBottom.style};`);
    }
  }

  // Paragraph
  lines.push(`  --paragraph-margin-bottom: ${typography.paragraph.marginBottom};`);

  // Link
  lines.push(
    `  --user-link-color: ${getColorForTheme(typography.link.color, theme)};`
  );

  // Blockquote
  lines.push(`  --blockquote-border-width: ${typography.blockquote.borderWidth};`);
  lines.push(
    `  --blockquote-border-color: ${getColorForTheme(typography.blockquote.borderColor, theme)};`
  );
  lines.push(
    `  --blockquote-text-color: ${getColorForTheme(typography.blockquote.textColor, theme)};`
  );

  // Code
  lines.push(`  --code-font-size: ${typography.code.fontSize};`);
  lines.push(
    `  --user-code-bg: ${getColorForTheme(typography.code.background, theme)};`
  );
  lines.push(`  --code-border-radius: ${typography.code.borderRadius};`);

  // Lists
  lines.push(`  --ul-padding-left: ${lists.ul.paddingLeft};`);
  lines.push(`  --ul-item-spacing: ${lists.ul.itemSpacing};`);
  if (lists.ul.markerColor) {
    lines.push(
      `  --ul-marker-color: ${getColorForTheme(lists.ul.markerColor, theme)};`
    );
  }

  lines.push(`  --ol-padding-left: ${lists.ol.paddingLeft};`);
  lines.push(`  --ol-item-spacing: ${lists.ol.itemSpacing};`);
  if (lists.ol.markerColor) {
    lines.push(
      `  --ol-marker-color: ${getColorForTheme(lists.ol.markerColor, theme)};`
    );
  }

  return lines.join('\n');
}

/**
 * Generate complete CSS for a theme including plugin variables
 */
export function generateCompleteThemeCSS(
  theme: ResolvedTheme,
  pluginDeclarations: PluginThemeDeclaration = {},
  preferences?: CorePreferences
): string {
  const themeVars = themes[theme];
  const baseCSS = generateThemeCSS(themeVars);
  const pluginCSS = generatePluginThemeCSS(pluginDeclarations, theme);

  let allVariables = pluginCSS ? `${baseCSS}\n${pluginCSS}` : baseCSS;

  // Add typography CSS if preferences provided
  if (preferences) {
    const typographyCSS = generateTypographyCSS(preferences, theme);
    allVariables = `${allVariables}\n${typographyCSS}`;
  }

  return `:root {\n${allVariables}\n}`;
}

/**
 * Apply theme to the document by updating CSS variables
 */
export function applyTheme(
  theme: ResolvedTheme,
  pluginDeclarations: PluginThemeDeclaration = {},
  preferences?: CorePreferences
): void {
  const styleId = 'theme-variables';
  let styleElement = document.getElementById(styleId) as HTMLStyleElement | null;

  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = styleId;
    document.head.appendChild(styleElement);
  }

  const css = generateCompleteThemeCSS(theme, pluginDeclarations, preferences);
  styleElement.textContent = css;

  // Also set data-theme attribute for any CSS that uses it
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Get the current theme from the document
 */
export function getCurrentTheme(): ResolvedTheme {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'dark' ? 'dark' : 'light';
}
