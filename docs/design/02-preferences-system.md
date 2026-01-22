# Preferences System - Technical Design Document

**Author:** Claude
**Date:** 2026-01-22
**Status:** Draft

---

## 1. Problem Statement

The application currently has limited user customization—only a simple light/dark toggle. Users need fine-grained control over:

1. **Theme appearance** - Background colors, typography styles (headings, lists, etc.)
2. **Plugin behavior** - Mermaid image export settings, diagram theming
3. **Future extensibility** - Architecture for plugins to declare and store their own preferences

The current theme system uses hardcoded hex colors. We want to modernize to **OKLCH color space** for better perceptual uniformity and easier color manipulation.

## 2. Goals & Non-Goals

### Goals

- Add preferences button (cog icon) to toolbar, left of theme toggle
- Implement slide-in sidebar panel for preferences UI
- Support **Theme Mode**: Light | Dark | Auto (system)
- Allow customizable background colors per theme (Light/Dark)
- Expose typography CSS variables for all markdown elements (h1-h6, li, ol, blockquote, code, etc.)
- Use OKLCH color format throughout
- Live preview of preference changes
- Design plugin preferences architecture (declaration + storage)
- Implement Mermaid plugin preferences: transparent vs solid background on export
- Persist all preferences to disk

### Non-Goals

- Custom theme creation (save/load named themes) - future enhancement
- Import/export preferences - future enhancement
- Per-file preferences - out of scope
- Plugin marketplace/installation - separate feature
- Undo/redo in preferences panel

## 3. Proposed Solution

### 3.1 Architecture

The preferences system follows the existing Clean Architecture pattern with clear separation between main process (storage), renderer (UI/state), and shared types.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           RENDERER PROCESS                          │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │   Toolbar    │───▶│ PreferencesPanel │◀───│  PluginManager   │  │
│  │ (cog button) │    │   (sidebar UI)   │    │ (plugin prefs)   │  │
│  └──────────────┘    └────────┬─────────┘    └──────────────────┘  │
│                               │                                     │
│                               ▼                                     │
│                    ┌──────────────────────┐                        │
│                    │  PreferencesState    │                        │
│                    │  (in-memory cache)   │                        │
│                    └──────────┬───────────┘                        │
│                               │                                     │
│                               ▼                                     │
│                    ┌──────────────────────┐                        │
│                    │    applyTheme()      │                        │
│                    │  (CSS var injection) │                        │
│                    └──────────────────────┘                        │
└───────────────────────────────┼─────────────────────────────────────┘
                                │ IPC
┌───────────────────────────────┼─────────────────────────────────────┐
│                               ▼              MAIN PROCESS           │
│                    ┌──────────────────────┐                        │
│                    │ PreferencesService   │                        │
│                    │   (load/save/validate)│                        │
│                    └──────────┬───────────┘                        │
│                               │                                     │
│                               ▼                                     │
│                    ┌──────────────────────┐                        │
│                    │  preferences.json    │                        │
│                    │  (userData dir)      │                        │
│                    └──────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Boundaries

| Module | Exposes | Consumes |
|--------|---------|----------|
| **PreferencesService** (main) | `get()`, `set()`, `subscribe()`, `getPluginPreferences()`, `setPluginPreferences()` | Electron fs, app paths |
| **PreferencesHandler** (main/ipc) | IPC channel handlers | PreferencesService |
| **PreferencesPanel** (renderer) | `open()`, `close()`, `isOpen()` | electronAPI.preferences, PluginManager |
| **PreferencesState** (renderer) | `getPreferences()`, `updatePreferences()`, `onPreferencesChange()` | electronAPI.preferences |
| **Themes** (renderer) | `applyUserPreferences()`, extended `generateThemeCSS()` | PreferencesState |
| **PluginManager** | `getPluginPreferencesSchema()` | Plugin instances |
| **MarkdownPlugin** (interface) | `getPreferencesSchema?()`, `onPreferencesChange?()` | - |

### 3.3 Data Model

#### Core Preferences Schema

```typescript
// src/shared/types/preferences.ts

/**
 * OKLCH color representation with alpha support
 * Format: "oklch(L% C H / A)" where L=0-100, C=0-0.4, H=0-360, A=0-1
 * Examples:
 *   - "oklch(100% 0 0)"         // Opaque white
 *   - "oklch(100% 0 0 / 0.5)"   // 50% transparent white
 *   - "oklch(52% 0.18 250 / 1)" // Opaque blue
 */
export type OklchColor = string;

/**
 * Theme mode preference
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Typography element styling
 */
export interface TypographyStyle {
  fontSize: string;           // e.g., "2em", "1.5rem"
  fontWeight: number;         // 100-900
  lineHeight: number;         // e.g., 1.25
  color: {
    light: OklchColor;
    dark: OklchColor;
  };
  marginTop: string;          // e.g., "24px"
  marginBottom: string;
  paddingBottom?: string;     // For h1, h2 with borders
  borderBottom?: {
    width: string;            // e.g., "1px"
    style: string;            // e.g., "solid"
    // Color uses --border-color by default
  };
}

/**
 * List styling
 */
export interface ListStyle {
  paddingLeft: string;        // e.g., "2em"
  itemSpacing: string;        // margin between items
  markerColor?: {
    light: OklchColor;
    dark: OklchColor;
  };
}

/**
 * Core application preferences
 */
export interface CorePreferences {
  theme: {
    mode: ThemeMode;
    background: {
      light: OklchColor;
      dark: OklchColor;
    };
  };
  typography: {
    baseFontSize: string;     // Body text size, e.g., "14px"
    h1: TypographyStyle;
    h2: TypographyStyle;
    h3: TypographyStyle;
    h4: TypographyStyle;
    h5: TypographyStyle;
    h6: TypographyStyle;
    paragraph: {
      marginBottom: string;
    };
    link: {
      color: {
        light: OklchColor;
        dark: OklchColor;
      };
    };
    blockquote: {
      borderWidth: string;
      borderColor: {
        light: OklchColor;
        dark: OklchColor;
      };
      textColor: {
        light: OklchColor;
        dark: OklchColor;
      };
    };
    code: {
      fontSize: string;       // Relative, e.g., "85%"
      background: {
        light: OklchColor;
        dark: OklchColor;
      };
      borderRadius: string;
    };
  };
  lists: {
    ul: ListStyle;
    ol: ListStyle;
  };
}

/**
 * Plugin preferences - keyed by plugin ID
 */
export type PluginPreferencesMap = Record<string, unknown>;

/**
 * Complete preferences structure
 */
export interface AppPreferences {
  version: number;            // Schema version for migrations
  core: CorePreferences;
  plugins: PluginPreferencesMap;
}
```

#### Plugin Preferences Schema

```typescript
// src/shared/types/plugin.ts (extend existing)

/**
 * Preference field types for plugin preferences UI
 */
export type PreferenceFieldType =
  | 'boolean'
  | 'string'
  | 'number'
  | 'color'           // OklchColor with picker
  | 'select'          // Dropdown
  | 'color-pair';     // Light/dark color pair

/**
 * Base preference field definition
 */
export interface PreferenceFieldBase {
  key: string;
  label: string;
  description?: string;
}

/**
 * Boolean preference (checkbox/toggle)
 */
export interface BooleanPreferenceField extends PreferenceFieldBase {
  type: 'boolean';
  defaultValue: boolean;
}

/**
 * Select preference (dropdown)
 */
export interface SelectPreferenceField extends PreferenceFieldBase {
  type: 'select';
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
}

/**
 * Color preference (single color)
 */
export interface ColorPreferenceField extends PreferenceFieldBase {
  type: 'color';
  defaultValue: OklchColor;
}

/**
 * Color pair preference (light/dark)
 */
export interface ColorPairPreferenceField extends PreferenceFieldBase {
  type: 'color-pair';
  defaultValue: {
    light: OklchColor;
    dark: OklchColor;
  };
}

/**
 * Number preference
 */
export interface NumberPreferenceField extends PreferenceFieldBase {
  type: 'number';
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Union of all preference field types
 */
export type PreferenceField =
  | BooleanPreferenceField
  | SelectPreferenceField
  | ColorPreferenceField
  | ColorPairPreferenceField
  | NumberPreferenceField;

/**
 * Plugin preferences schema
 */
export interface PluginPreferencesSchema {
  /** Schema version for this plugin's preferences */
  version: number;
  /** Grouped preference sections */
  sections: Array<{
    id: string;
    title: string;
    fields: PreferenceField[];
  }>;
}

/**
 * Extended plugin interface with preferences support
 */
export interface MarkdownPlugin {
  // ... existing methods ...

  /**
   * Declare preferences schema for this plugin
   * Return null if plugin has no configurable preferences
   */
  getPreferencesSchema?(): PluginPreferencesSchema | null;

  /**
   * Called when plugin preferences change
   * Plugin should apply new preferences immediately (live preview)
   */
  onPreferencesChange?(preferences: unknown): void;
}
```

#### Mermaid Plugin Preferences

```typescript
// src/plugins/builtin/MermaidPlugin.ts (preferences section)

export interface MermaidPreferences {
  export: {
    background: 'transparent' | 'solid';
  };
  colors: {
    labelBackground: {
      light: OklchColor;
      dark: OklchColor;
    };
    nodeFill: {
      light: OklchColor;
      dark: OklchColor;
    };
    nodeStroke: {
      light: OklchColor;
      dark: OklchColor;
    };
    edgeStroke: {
      light: OklchColor;
      dark: OklchColor;
    };
  };
}
```

### 3.4 API Design

#### IPC Channels

```typescript
// src/shared/types/api.ts (extend)

export interface PreferencesAPI {
  /** Get all preferences */
  get(): Promise<AppPreferences>;

  /** Update preferences (partial update, deep merge) */
  set(updates: DeepPartial<AppPreferences>): Promise<void>;

  /** Reset to defaults */
  reset(): Promise<AppPreferences>;

  /** Subscribe to preference changes from other sources */
  onChange(callback: (preferences: AppPreferences) => void): () => void;

  /** Get plugin-specific preferences */
  getPluginPreferences<T>(pluginId: string): Promise<T | null>;

  /** Set plugin-specific preferences */
  setPluginPreferences<T>(pluginId: string, preferences: T): Promise<void>;
}
```

#### PreferencesService (Main Process)

```typescript
// src/main/services/PreferencesService.ts

export interface PreferencesService {
  /** Initialize service, load from disk */
  initialize(): Promise<void>;

  /** Get complete preferences */
  getPreferences(): AppPreferences;

  /** Update preferences with partial data */
  updatePreferences(updates: DeepPartial<AppPreferences>): Promise<void>;

  /** Reset to factory defaults */
  resetToDefaults(): Promise<AppPreferences>;

  /** Subscribe to changes */
  onPreferencesChange(callback: (prefs: AppPreferences) => void): () => void;

  /** Migrate preferences schema if needed */
  migrateIfNeeded(stored: unknown): AppPreferences;
}
```

#### PreferencesPanel (Renderer)

```typescript
// src/renderer/components/PreferencesPanel.ts

export interface PreferencesPanelCallbacks {
  onPreferencesChange: (updates: DeepPartial<AppPreferences>) => void;
  onClose: () => void;
}

export interface PreferencesPanel {
  /** Open the panel with animation */
  open(): void;

  /** Close the panel with animation */
  close(): void;

  /** Check if panel is open */
  isOpen(): boolean;

  /** Update displayed values (for external changes) */
  updateValues(preferences: AppPreferences): void;

  /** Set plugin schemas for dynamic UI generation */
  setPluginSchemas(schemas: Map<string, PluginPreferencesSchema>): void;
}
```

### 3.5 Color Utilities

```typescript
// src/shared/utils/oklch.ts

/**
 * Parsed OKLCH color components
 */
export interface OklchComponents {
  lightness: number;    // 0-100 (percentage)
  chroma: number;       // 0-0.4 (typically, can exceed)
  hue: number;          // 0-360 (degrees)
  alpha: number;        // 0-1 (default: 1)
}

/**
 * Parse an OKLCH color string into components
 * Supports formats:
 *   - oklch(L% C H)
 *   - oklch(L% C H / A)
 *   - oklch(L C H)
 *   - oklch(L C H / A)
 */
export function parseOklch(color: string): OklchComponents | null;

/**
 * Format OKLCH components into a valid CSS string
 * Always includes alpha for consistency
 */
export function formatOklch(components: OklchComponents): OklchColor;

/**
 * Validate an OKLCH color string
 */
export function isValidOklch(color: string): boolean;

/**
 * Convert hex color to OKLCH (for import/paste functionality)
 * Uses Color.js or similar library for accurate conversion
 */
export function hexToOklch(hex: string): OklchColor;

/**
 * Convert RGB color to OKLCH
 */
export function rgbToOklch(r: number, g: number, b: number, a?: number): OklchColor;

/**
 * Clamp OKLCH values to valid ranges
 */
export function clampOklch(components: OklchComponents): OklchComponents;

/**
 * Interpolate between two OKLCH colors
 * Useful for gradient previews
 */
export function interpolateOklch(
  from: OklchColor,
  to: OklchColor,
  t: number
): OklchColor;
```

### 3.6 CSS Variables Architecture

All user-customizable styles map to CSS variables. The theme system generates these at runtime.

```typescript
// Extended CSS variable mapping

const TYPOGRAPHY_CSS_VARS = {
  // Headings
  '--h1-font-size': 'typography.h1.fontSize',
  '--h1-font-weight': 'typography.h1.fontWeight',
  '--h1-line-height': 'typography.h1.lineHeight',
  '--h1-color': 'typography.h1.color.[theme]',
  '--h1-margin-top': 'typography.h1.marginTop',
  '--h1-margin-bottom': 'typography.h1.marginBottom',
  '--h1-padding-bottom': 'typography.h1.paddingBottom',
  '--h1-border-bottom-width': 'typography.h1.borderBottom.width',
  // ... h2-h6 follow same pattern

  // Lists
  '--ul-padding-left': 'lists.ul.paddingLeft',
  '--ul-item-spacing': 'lists.ul.itemSpacing',
  '--ol-padding-left': 'lists.ol.paddingLeft',
  '--ol-item-spacing': 'lists.ol.itemSpacing',

  // Code
  '--code-font-size': 'typography.code.fontSize',
  '--code-bg': 'typography.code.background.[theme]',
  '--code-border-radius': 'typography.code.borderRadius',

  // Blockquote
  '--blockquote-border-width': 'typography.blockquote.borderWidth',
  '--blockquote-border-color': 'typography.blockquote.borderColor.[theme]',
  '--blockquote-text-color': 'typography.blockquote.textColor.[theme]',
} as const;
```

### 3.7 Default Values (Current Styles in OKLCH with Alpha)

All colors include explicit alpha values for transparency support. Alpha = 1 is fully opaque.

```typescript
// src/preferences/defaults.ts

// Hex to OKLCH conversions (approximate)
// #ffffff → oklch(100% 0 0 / 1)
// #0d1117 → oklch(11% 0.02 260 / 1)
// #24292f → oklch(26% 0.02 250 / 1)
// #c9d1d9 → oklch(85% 0.01 250 / 1)
// #0969da → oklch(52% 0.18 250 / 1)
// #58a6ff → oklch(70% 0.14 250 / 1)

export const DEFAULT_CORE_PREFERENCES: CorePreferences = {
  theme: {
    mode: 'system',
    background: {
      light: 'oklch(100% 0 0 / 1)',        // #ffffff opaque
      dark: 'oklch(11% 0.02 260 / 1)',     // #0d1117 opaque
    },
  },
  typography: {
    baseFontSize: '14px',
    h1: {
      fontSize: '2em',
      fontWeight: 600,
      lineHeight: 1.25,
      color: {
        light: 'oklch(26% 0.02 250 / 1)',  // #24292f
        dark: 'oklch(85% 0.01 250 / 1)',   // #c9d1d9
      },
      marginTop: '24px',
      marginBottom: '16px',
      paddingBottom: '0.3em',
      borderBottom: {
        width: '1px',
        style: 'solid',
      },
    },
    h2: {
      fontSize: '1.5em',
      fontWeight: 600,
      lineHeight: 1.25,
      color: {
        light: 'oklch(26% 0.02 250 / 1)',
        dark: 'oklch(85% 0.01 250 / 1)',
      },
      marginTop: '24px',
      marginBottom: '16px',
      paddingBottom: '0.3em',
      borderBottom: {
        width: '1px',
        style: 'solid',
      },
    },
    h3: {
      fontSize: '1.25em',
      fontWeight: 600,
      lineHeight: 1.25,
      color: {
        light: 'oklch(26% 0.02 250 / 1)',
        dark: 'oklch(85% 0.01 250 / 1)',
      },
      marginTop: '24px',
      marginBottom: '16px',
    },
    h4: {
      fontSize: '1em',
      fontWeight: 600,
      lineHeight: 1.25,
      color: {
        light: 'oklch(26% 0.02 250 / 1)',
        dark: 'oklch(85% 0.01 250 / 1)',
      },
      marginTop: '24px',
      marginBottom: '16px',
    },
    h5: {
      fontSize: '0.875em',
      fontWeight: 600,
      lineHeight: 1.25,
      color: {
        light: 'oklch(26% 0.02 250 / 1)',
        dark: 'oklch(85% 0.01 250 / 1)',
      },
      marginTop: '24px',
      marginBottom: '16px',
    },
    h6: {
      fontSize: '0.85em',
      fontWeight: 600,
      lineHeight: 1.25,
      color: {
        light: 'oklch(45% 0.01 250 / 1)',  // --text-muted equivalent
        dark: 'oklch(62% 0.01 250 / 1)',
      },
      marginTop: '24px',
      marginBottom: '16px',
    },
    paragraph: {
      marginBottom: '16px',
    },
    link: {
      color: {
        light: 'oklch(52% 0.18 250 / 1)',  // #0969da
        dark: 'oklch(70% 0.14 250 / 1)',   // #58a6ff
      },
    },
    blockquote: {
      borderWidth: '0.25em',
      borderColor: {
        light: 'oklch(87% 0.01 250 / 1)',  // #d0d7de
        dark: 'oklch(35% 0.01 250 / 1)',   // #3b434b
      },
      textColor: {
        light: 'oklch(45% 0.01 250 / 1)',  // #57606a
        dark: 'oklch(62% 0.01 250 / 1)',   // #8b949e
      },
    },
    code: {
      fontSize: '85%',
      background: {
        light: 'oklch(97% 0.01 250 / 1)',  // #f6f8fa
        dark: 'oklch(16% 0.02 260 / 1)',   // #161b22
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

export const DEFAULT_MERMAID_PREFERENCES: MermaidPreferences = {
  export: {
    background: 'solid',  // Use rendered background, not transparent
  },
  colors: {
    labelBackground: {
      light: 'oklch(100% 0 0 / 1)',
      dark: 'oklch(24% 0.01 250 / 1)',
    },
    nodeFill: {
      light: 'oklch(94% 0.03 250 / 1)',
      dark: 'oklch(22% 0.02 250 / 1)',
    },
    nodeStroke: {
      light: 'oklch(70% 0.02 250 / 1)',
      dark: 'oklch(45% 0.02 250 / 1)',
    },
    edgeStroke: {
      light: 'oklch(50% 0.02 250 / 1)',
      dark: 'oklch(60% 0.02 250 / 1)',
    },
  },
};
```

### 3.8 UI Components

#### Preferences Panel Structure

```
┌─────────────────────────────────────┐
│ Preferences                      ✕  │
├─────────────────────────────────────┤
│                                     │
│ ▼ Appearance                        │
│   ┌─────────────────────────────┐   │
│   │ Theme Mode    [Light ▾]     │   │
│   └─────────────────────────────┘   │
│   ┌─────────────────────────────┐   │
│   │ Background (Light)          │   │
│   │ [●───────] oklch(100% 0 0)  │   │
│   └─────────────────────────────┘   │
│   ┌─────────────────────────────┐   │
│   │ Background (Dark)           │   │
│   │ [●───────] oklch(11% 0 260) │   │
│   └─────────────────────────────┘   │
│                                     │
│ ▼ Typography                        │
│   ┌─────────────────────────────┐   │
│   │ Base Font Size  [14px ▾]    │   │
│   └─────────────────────────────┘   │
│                                     │
│   ▸ Heading 1                       │
│   ▸ Heading 2                       │
│   ▸ Heading 3                       │
│   ...                               │
│                                     │
│ ▼ Mermaid Diagrams                  │
│   ┌─────────────────────────────┐   │
│   │ Export Background           │   │
│   │ ○ Transparent  ● Solid      │   │
│   └─────────────────────────────┘   │
│   ┌─────────────────────────────┐   │
│   │ Label Background (Light)    │   │
│   │ [●───────] oklch(100% 0 0)  │   │
│   └─────────────────────────────┘   │
│                                     │
│ [Reset to Defaults]                 │
│                                     │
└─────────────────────────────────────┘
```

#### Color Picker Component

The color picker follows Chrome DevTools' OKLCH picker design pattern - a proven, familiar UI for web developers.

```typescript
// src/renderer/components/ColorPicker.ts

export interface ColorPickerProps {
  value: OklchColor;
  onChange: (color: OklchColor) => void;
  label?: string;
  showAlpha?: boolean;  // Default: true
}

export interface ParsedOklchColor {
  lightness: number;    // 0-100 (percentage)
  chroma: number;       // 0-0.4
  hue: number;          // 0-360
  alpha: number;        // 0-1 (default: 1)
}
```

**Visual Design (Chrome-style):**

```
┌─────────────────────────────────────────┐
│  ┌───────────────────────────────────┐  │
│  │                                   │  │
│  │     Chroma (x) × Lightness (y)    │  │
│  │          2D gradient area         │  │
│  │              [●]                  │  │
│  │                                   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  Hue slider (0-360 rainbow)   [●] │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  Alpha slider (checkerboard)  [●] │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌────────┐ oklch(52% 0.18 250 / 1)    │
│  │ swatch │ ────────────────────────   │
│  │        │ [editable text input   ]   │
│  └────────┘                             │
│                                         │
│  L: [52%───●────] C: [0.18─●──]        │
│  H: [250──●─────] A: [100%────●]       │
│                                         │
└─────────────────────────────────────────┘
```

**Features:**
- **2D gradient area**: X-axis = Chroma (saturation), Y-axis = Lightness
- **Hue rainbow slider**: Full 0-360 spectrum
- **Alpha slider**: Checkerboard pattern background showing transparency
- **Live preview swatch**: Shows color with alpha over checkerboard
- **Text input**: Direct `oklch()` value entry with validation
- **Individual sliders**: Fine-tune L, C, H, A values independently
- **Keyboard support**: Arrow keys adjust values, Tab navigation
- **Copy/paste**: Copy oklch string, paste any color format (hex, rgb, hsl, oklch)

### 3.9 Error Handling

| Error Class | When Thrown | Data Included |
|-------------|-------------|---------------|
| `PreferencesLoadError` | Failed to read preferences file | `filePath`, `cause` |
| `PreferencesValidationError` | Invalid preference values | `field`, `value`, `expected` |
| `PreferencesMigrationError` | Failed to migrate schema | `fromVersion`, `toVersion`, `cause` |
| `ColorFormatError` | Invalid OKLCH color string | `input`, `expectedFormat` |
| `PluginPreferencesError` | Plugin preferences operation failed | `pluginId`, `operation`, `cause` |

## 4. Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Color Format: Hex** | Universal support, familiar | Poor perceptual uniformity, hard to manipulate | Rejected |
| **Color Format: HSL** | Better than hex, good browser support | Not perceptually uniform | Rejected |
| **Color Format: OKLCH** | Perceptually uniform, modern, great for UI | Requires newer browsers (widely supported now) | **Selected** |
| **UI: Modal dialog** | Simple, familiar | Blocks main content, less spacious | Rejected |
| **UI: Sidebar panel** | Non-blocking, good space, slide animation | More complex layout | **Selected** |
| **UI: Separate window** | Full customization | Heavy, disconnected feel | Rejected |
| **Storage: SQLite** | Queries, migrations built-in | Overkill for config, adds dependency | Rejected |
| **Storage: JSON file** | Simple, human-readable, sufficient | Manual migration | **Selected** |
| **Apply mode: On save** | Explicit action | Poor UX, no immediate feedback | Rejected |
| **Apply mode: Live preview** | Immediate feedback, modern UX | Slightly more complex state management | **Selected** |
| **Color conversion: Color.js** | Comprehensive, accurate, CSS Color 4/5 | 30KB gzipped, but worth it for accuracy | **Selected** |
| **Color conversion: Custom** | Smaller bundle | Error-prone, maintenance burden | Rejected |
| **Color conversion: culori** | Fast, modular | Less comprehensive than Color.js | Considered |

## 5. Testing Strategy

### Unit Tests

- `PreferencesService`: Load, save, validate, migrate operations
- `ColorPicker`: OKLCH parsing, validation, conversion utilities
- `TypographyStyle` defaults: Verify CSS variable generation
- `PluginPreferencesSchema`: Validation of plugin-declared schemas
- `DeepMerge` utility: Partial preference updates merge correctly

### Integration Tests

- `PreferencesHandler` + `PreferencesService`: IPC round-trip
- `PreferencesPanel` + `applyTheme`: Live preview updates DOM
- `MermaidPlugin.onPreferencesChange`: Re-renders with new colors
- `PluginManager` + preferences: Plugins receive preference updates

### E2E Tests

- Open preferences panel via toolbar button
- Change theme mode, verify immediate visual change
- Adjust h1 color, verify markdown re-renders
- Change Mermaid export setting, export image, verify background
- Reset to defaults, verify all values restored
- Close and reopen app, verify preferences persisted

## 6. Migration / Rollout Plan

### Phase 1: Foundation
- [ ] Implement `PreferencesService` with schema v1
- [ ] Add `preferences.json` storage (separate from `theme-preferences.json`)
- [ ] Migrate existing theme preference to new format
- [ ] IPC handlers for preferences

### Phase 2: UI
- [ ] Preferences panel component (sidebar)
- [ ] Color picker component
- [ ] Collapsible sections
- [ ] Theme mode selector

### Phase 3: Typography
- [ ] CSS variable mapping for all typography
- [ ] Typography section in preferences panel
- [ ] Live preview integration

### Phase 4: Plugin Architecture
- [ ] Extend `MarkdownPlugin` interface
- [ ] Plugin preferences schema validation
- [ ] Dynamic UI generation from schemas

### Phase 5: Mermaid Integration
- [ ] Implement `MermaidPlugin.getPreferencesSchema()`
- [ ] Export background setting (transparent/solid)
- [ ] Mermaid color overrides via CSS variables

### Backward Compatibility

- Existing `theme-preferences.json` migrated to `preferences.json` on first load
- Missing fields filled with defaults
- Schema version field enables future migrations

## 7. Open Questions

1. **Should we support CSS import/export?** Users might want to share typography configurations as CSS snippets.

2. **Keyboard shortcuts in preferences?** Should Tab navigate fields, Escape close panel?

3. **Preset themes?** Should we ship a few preset typography/color combinations (GitHub, Notion, Bear)?

4. **Plugin preference persistence granularity?** Should plugins be able to declare per-document preferences vs global?

## 8. References

- [OKLCH Color Space](https://oklch.com/) - Interactive color picker and documentation
- [CSS Color Level 4](https://www.w3.org/TR/css-color-4/#ok-lab) - OKLCH specification
- [Color.js](https://colorjs.io/) - Color conversion library (recommended for hex/rgb → oklch)
- [Chrome DevTools Color Picker](https://developer.chrome.com/docs/devtools/css/color) - UI reference for color picker design
- Current codebase: `src/themes/`, `src/main/services/ThemeService.ts`
- Plugin interface: `src/shared/types/plugin.ts`
