/**
 * Default Preference Values
 *
 * Provides default values for all preferences. OKLCH colors are
 * conversions from the current GitHub-style hex colors.
 *
 * Color conversions (approximate):
 *   #ffffff → oklch(100% 0 0)
 *   #0d1117 → oklch(11% 0.02 260)
 *   #24292f → oklch(26% 0.02 250)
 *   #c9d1d9 → oklch(85% 0.01 250)
 *   #0969da → oklch(52% 0.18 250)
 *   #58a6ff → oklch(70% 0.14 250)
 */

import type {
  CorePreferences,
  AppPreferences,
  TypographyStyle,
  ColorPair,
} from '@shared/types';

/**
 * Current preferences schema version
 */
export const PREFERENCES_VERSION = 1;

/**
 * Common text colors for light and dark themes
 */
const TEXT_COLOR: ColorPair = {
  light: 'oklch(26% 0.02 250)', // #24292f
  dark: 'oklch(85% 0.01 250)', // #c9d1d9
};

/**
 * Muted text color for less prominent elements
 */
const TEXT_MUTED_COLOR: ColorPair = {
  light: 'oklch(45% 0.01 250)', // #57606a
  dark: 'oklch(62% 0.01 250)', // #8b949e
};

/**
 * Create heading style with defaults
 */
function createHeadingStyle(
  fontSize: string,
  options: {
    paddingBottom?: string;
    hasBorder?: boolean;
    useMutedColor?: boolean;
  } = {}
): TypographyStyle {
  return {
    fontSize,
    fontWeight: 600,
    lineHeight: 1.25,
    color: options.useMutedColor ? TEXT_MUTED_COLOR : TEXT_COLOR,
    marginTop: '24px',
    marginBottom: '16px',
    paddingBottom: options.paddingBottom,
    borderBottom: options.hasBorder
      ? {
          width: '1px',
          style: 'solid',
        }
      : undefined,
  };
}

/**
 * Default core preferences
 */
export const DEFAULT_CORE_PREFERENCES: CorePreferences = {
  theme: {
    mode: 'system',
    background: {
      light: 'oklch(100% 0 0)', // #ffffff
      dark: 'oklch(11% 0.02 260)', // #0d1117
    },
  },
  typography: {
    baseFontSize: '14px',
    h1: createHeadingStyle('2em', { paddingBottom: '0.3em', hasBorder: true }),
    h2: createHeadingStyle('1.5em', { paddingBottom: '0.3em', hasBorder: true }),
    h3: createHeadingStyle('1.25em'),
    h4: createHeadingStyle('1em'),
    h5: createHeadingStyle('0.875em'),
    h6: createHeadingStyle('0.85em', { useMutedColor: true }),
    paragraph: {
      marginBottom: '16px',
    },
    link: {
      color: {
        light: 'oklch(52% 0.18 250)', // #0969da
        dark: 'oklch(70% 0.14 250)', // #58a6ff
      },
    },
    blockquote: {
      borderWidth: '0.25em',
      borderColor: {
        light: 'oklch(87% 0.01 250)', // #d0d7de
        dark: 'oklch(35% 0.01 250)', // #3b434b
      },
      textColor: TEXT_MUTED_COLOR,
    },
    code: {
      fontSize: '85%',
      background: {
        light: 'oklch(97% 0.01 250)', // #f6f8fa
        dark: 'oklch(16% 0.02 260)', // #161b22
      },
      borderRadius: '6px',
    },
  },
  lists: {
    ul: {
      paddingLeft: '2em',
      itemSpacing: '0.25em',
    },
    ol: {
      paddingLeft: '2em',
      itemSpacing: '0.25em',
    },
  },
};

/**
 * Mermaid plugin default preferences
 */
export interface MermaidPreferences {
  export: {
    background: 'transparent' | 'solid';
  };
  colors: {
    labelBackground: ColorPair;
    nodeFill: ColorPair;
    nodeStroke: ColorPair;
    edgeStroke: ColorPair;
  };
}

export const DEFAULT_MERMAID_PREFERENCES: MermaidPreferences = {
  export: {
    background: 'solid',
  },
  colors: {
    labelBackground: {
      light: 'oklch(100% 0 0)',
      dark: 'oklch(24% 0.01 250)',
    },
    nodeFill: {
      light: 'oklch(94% 0.03 250)',
      dark: 'oklch(22% 0.02 250)',
    },
    nodeStroke: {
      light: 'oklch(70% 0.02 250)',
      dark: 'oklch(45% 0.02 250)',
    },
    edgeStroke: {
      light: 'oklch(50% 0.02 250)',
      dark: 'oklch(60% 0.02 250)',
    },
  },
};

/**
 * Default app preferences (complete structure)
 */
export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  version: PREFERENCES_VERSION,
  core: DEFAULT_CORE_PREFERENCES,
  plugins: {
    mermaid: DEFAULT_MERMAID_PREFERENCES,
  },
};

/**
 * Deep clone preferences to avoid mutation
 */
export function clonePreferences<T>(preferences: T): T {
  return JSON.parse(JSON.stringify(preferences)) as T;
}

/**
 * Deep merge two objects, with source values overwriting target values
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (
        sourceValue !== undefined &&
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== undefined &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        // Recursively merge nested objects
        result[key] = deepMerge(
          targetValue as object,
          sourceValue as Partial<object>
        ) as T[Extract<keyof T, string>];
      } else if (sourceValue !== undefined) {
        // Direct assignment for primitives and arrays
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }

  return result;
}
