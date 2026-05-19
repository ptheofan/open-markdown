/**
 * PreviewablePlugin - Optional plugin capability for live-preview editing.
 *
 * A plugin that owns a particular kind of slice (e.g. MermaidPlugin owns
 * ```mermaid fences) implements this so the editor can give the user a
 * live-preview-above-source editing surface. The four methods are stateless
 * on the plugin: matchesSlice/extractSource/applySourceToRaw are pure;
 * renderPreview is async and mutates the target element.
 */
import type { MarkdownPlugin } from '@shared/types';
import type { MarkdownSlice } from '../../renderer/services/MarkdownSlicer';

export interface PreviewablePlugin {
  /** Does this plugin own the given slice? Fast and side-effect-free. */
  matchesSlice(slice: MarkdownSlice): boolean;

  /** Extract the user-editable source from the slice's raw markdown
   *  (e.g. strip ```mermaid fences). */
  extractSource(slice: MarkdownSlice): string;

  /** Render `source` into `target`, replacing its contents on success.
   *  MUST NOT throw — errors are returned so the caller can keep the
   *  previous good preview visible. On `{ ok: false }` `target` MUST
   *  be left unchanged. */
  renderPreview(
    source: string,
    target: HTMLElement,
  ): Promise<{ ok: true } | { ok: false; error: string }>;

  /** Inverse of extractSource — wrap the edited source back into a full
   *  slice raw. Implementations may consult `slice.raw` to preserve
   *  details like a fence's info-string. */
  applySourceToRaw(slice: MarkdownSlice, source: string): string;
}

/** Runtime duck-type check. Returns true when `plugin` implements all four
 *  PreviewablePlugin methods. */
export function isPreviewablePlugin(
  plugin: MarkdownPlugin,
): plugin is MarkdownPlugin & PreviewablePlugin {
  const p = plugin as Partial<PreviewablePlugin>;
  return typeof p.matchesSlice === 'function'
      && typeof p.extractSource === 'function'
      && typeof p.renderPreview === 'function'
      && typeof p.applySourceToRaw === 'function';
}
