/**
 * Rewrites relative/absolute image references in rendered markdown so they
 * point at the app's local asset protocol instead of failing to load.
 *
 * markdown-it emits `<img>`/`<source>` elements with the `src`/`srcset` values
 * exactly as written in the document. References like `docs/images/logo.svg`
 * would otherwise resolve against the app origin (or dev server) and never
 * reach the file the author intended.
 */

/**
 * Resolves a single document reference to a loadable URL, or returns `null`
 * to leave the reference untouched (e.g. it is already an absolute URL).
 */
export type AssetResolver = (ref: string) => string | null;

/**
 * Rewrite a `srcset` attribute value, resolving each candidate's URL while
 * preserving its descriptor (e.g. `2x`, `640w`).
 */
export function rewriteSrcset(srcset: string, resolve: AssetResolver): string {
  return srcset
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) {
        return '';
      }
      const parts = trimmed.split(/\s+/);
      const url = parts[0];
      if (url) {
        const resolved = resolve(url);
        if (resolved) {
          parts[0] = resolved;
        }
      }
      return parts.join(' ');
    })
    .filter((candidate) => candidate.length > 0)
    .join(', ');
}

/**
 * Rewrite every image reference within a rendered markdown container.
 *
 * Handles markdown image syntax and raw HTML alike, including `<picture>`
 * elements which use `<source srcset>` plus an `<img>` fallback.
 */
export function rewriteAssetPaths(
  container: HTMLElement,
  resolve: AssetResolver
): void {
  const srcElements = container.querySelectorAll<HTMLElement>(
    'img[src], source[src]'
  );
  srcElements.forEach((element) => {
    const src = element.getAttribute('src');
    if (src) {
      const resolved = resolve(src);
      if (resolved) {
        element.setAttribute('src', resolved);
      }
    }
  });

  const srcsetElements = container.querySelectorAll<HTMLElement>(
    'img[srcset], source[srcset]'
  );
  srcsetElements.forEach((element) => {
    const srcset = element.getAttribute('srcset');
    if (srcset) {
      element.setAttribute('srcset', rewriteSrcset(srcset, resolve));
    }
  });
}
