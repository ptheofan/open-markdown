/**
 * Renderer Components - Public API
 */

// MarkdownViewer
export {
  MarkdownViewer,
  createMarkdownViewer,
  type MarkdownViewerState,
} from './MarkdownViewer';

// DropZone
export {
  DropZone,
  createDropZone,
  type FileDropCallback,
} from './DropZone';

// Toolbar
export {
  Toolbar,
  createToolbar,
  type ToolbarCallbacks,
} from './Toolbar';

// StatusBar
export {
  StatusBar,
  createStatusBar,
  type StatusBarState,
} from './StatusBar';

// ZoomController
export {
  ZoomController,
  createZoomController,
  type ZoomConfig,
  type ZoomChangeCallback,
} from './ZoomController';

// CollapsibleSection
export {
  CollapsibleSection,
  createCollapsibleSection,
  type CollapsibleSectionOptions,
} from './CollapsibleSection';

// FormControls
export {
  Select,
  createSelect,
  type SelectOptions,
  NumberInput,
  createNumberInput,
  type NumberInputOptions,
  Toggle,
  createToggle,
  type ToggleOptions,
  TextInput,
  createTextInput,
  type TextInputOptions,
} from './FormControls';

// ColorPicker
export {
  ColorPicker,
  createColorPicker,
  type ColorPickerOptions,
} from './ColorPicker';

// ColorPairPicker
export {
  ColorPairPicker,
  createColorPairPicker,
  type ColorPairPickerOptions,
} from './ColorPairPicker';

// PreferencesPanel
export {
  PreferencesPanel,
  createPreferencesPanel,
  type PreferencesPanelCallbacks,
} from './PreferencesPanel';

// CopyDropdown
export {
  CopyDropdown,
  createCopyDropdown,
  type CopyDropdownCallbacks,
} from './CopyDropdown';

// Toast
export { Toast, type ToastType } from './Toast';

// ChangeGutter
export {
  ChangeGutter,
  createChangeGutter,
  type ChangeGutterOptions,
} from './ChangeGutter';

// FindBar
export {
  FindBar,
  createFindBar,
  type FindBarCallbacks,
} from './FindBar';

// RecentFilesDropdown
export {
  RecentFilesDropdown,
  createRecentFilesDropdown,
  type RecentFilesDropdownCallbacks,
} from './RecentFilesDropdown';
