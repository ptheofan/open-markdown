/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import {
  rewriteSrcset,
  rewriteAssetPaths,
  type AssetResolver,
} from '../../../../src/renderer/utils/assetPaths';

// Resolver that mimics the preload behaviour: relative paths become
// `om-asset:` URLs, absolute URLs are left untouched.
const resolver: AssetResolver = (ref) => {
  if (/^[a-z][a-z0-9+.-]+:/i.test(ref) || ref.startsWith('//')) {
    return null;
  }
  return `om-asset:///docs/${ref}`;
};

describe('rewriteSrcset', () => {
  it('rewrites a single-candidate srcset', () => {
    expect(rewriteSrcset('images/logo.svg', resolver)).toBe(
      'om-asset:///docs/images/logo.svg'
    );
  });

  it('preserves descriptors for each candidate', () => {
    const result = rewriteSrcset('a.png 1x, b.png 2x', resolver);
    expect(result).toBe('om-asset:///docs/a.png 1x, om-asset:///docs/b.png 2x');
  });

  it('leaves absolute URLs untouched', () => {
    expect(rewriteSrcset('https://example.com/a.png 2x', resolver)).toBe(
      'https://example.com/a.png 2x'
    );
  });

  it('ignores empty candidates', () => {
    expect(rewriteSrcset('a.png 1x, , b.png 2x', resolver)).toBe(
      'om-asset:///docs/a.png 1x, om-asset:///docs/b.png 2x'
    );
  });
});

describe('rewriteAssetPaths', () => {
  function render(html: string): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container;
  }

  it('rewrites a relative <img> src', () => {
    const container = render('<img src="images/logo.svg" alt="logo">');
    rewriteAssetPaths(container, resolver);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'om-asset:///docs/images/logo.svg'
    );
  });

  it('rewrites <picture> with <source srcset> and <img> fallback', () => {
    const container = render(`
      <picture>
        <source media="(prefers-color-scheme: light)" srcset="images/light.svg">
        <source media="(prefers-color-scheme: dark)" srcset="images/dark.svg">
        <img src="images/light.svg" alt="Logo">
      </picture>
    `);
    rewriteAssetPaths(container, resolver);

    const sources = container.querySelectorAll('source');
    expect(sources[0]?.getAttribute('srcset')).toBe(
      'om-asset:///docs/images/light.svg'
    );
    expect(sources[1]?.getAttribute('srcset')).toBe(
      'om-asset:///docs/images/dark.svg'
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'om-asset:///docs/images/light.svg'
    );
  });

  it('leaves remote images untouched', () => {
    const container = render('<img src="https://example.com/a.png">');
    rewriteAssetPaths(container, resolver);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/a.png'
    );
  });

  it('leaves data URIs untouched', () => {
    const dataUri = 'data:image/png;base64,AAAA';
    const container = render(`<img src="${dataUri}">`);
    rewriteAssetPaths(container, resolver);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(dataUri);
  });
});
