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

// OutlinePanel
export {
  OutlinePanel,
  createOutlinePanel,
  type OutlinePanelOptions,
  type OutlineEntry,
} from './OutlinePanel';

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

// OpenPathBar
export {
  OpenPathBar,
  createOpenPathBar,
  type OpenPathBarCallbacks,
} from './OpenPathBar';

// DocumentBrowser
export {
  DocumentBrowser,
  createDocumentBrowser,
  type DocumentBrowserCallbacks,
} from './DocumentBrowser';

// RecentFilesDropdown
export {
  RecentFilesDropdown,
  createRecentFilesDropdown,
  type RecentFilesDropdownCallbacks,
} from './RecentFilesDropdown';

// EditModeController
export {
  EditModeController,
  createEditModeController,
  type EditModeCallbacks,
  type SliceAction,
  type BlockType,
} from './EditModeController';

// OpenExternalDropdown
export {
  OpenExternalDropdown,
  createOpenExternalDropdown,
  type OpenExternalDropdownCallbacks,
} from './OpenExternalDropdown';

// GoogleDocsButton
export {
  GoogleDocsButton,
  createGoogleDocsButton,
  type GoogleDocsButtonState,
  type GoogleDocsButtonCallbacks,
} from './GoogleDocsButton';

// GoogleDocsSettings
export {
  GoogleDocsSettings,
  createGoogleDocsSettings,
} from './GoogleDocsSettings';

// SyncReviewDialog
export {
  createSyncReviewDialog,
  type SyncReviewDialog,
  type SyncReviewOutcome,
} from './SyncReviewDialog';

// SyncProgressBar
export {
  createSyncProgressBar,
  type SyncProgressBar,
} from './SyncProgressBar';

export { createExportDialog } from './ExportDialog';
export type { ExportDialog, ExportKind, ExportChoices } from './ExportDialog';

export { createQuickSwitcher, rankItems } from './QuickSwitcher';
export type { QuickSwitcher, QuickSwitcherCallbacks } from './QuickSwitcher';
export { createLightbox, Lightbox } from './Lightbox';
export { createDiagramControls, DiagramControls } from './DiagramControls';

export { createUpdateBanner, UpdateBanner } from './UpdateBanner';
export type { UpdateBannerCallbacks } from './UpdateBanner';
export { createReleaseNotesDialog } from './ReleaseNotesDialog';
export type { ReleaseNotesDialog } from './ReleaseNotesDialog';
