import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, it, expect } from 'vitest';

import { resolveAssetUrl } from '../../../src/preload/assetResolver';

const BASE = path.resolve('/docs/project/README.md');

function expectedUrl(absolutePath: string): string {
  return `om-asset://local${pathToFileURL(absolutePath).pathname}`;
}

describe('resolveAssetUrl', () => {
  it('resolves a relative path against the document directory', () => {
    const result = resolveAssetUrl(BASE, 'docs/images/logo.svg');
    expect(result).toBe(
      expectedUrl(path.resolve('/docs/project/docs/images/logo.svg'))
    );
  });

  it('resolves parent-relative paths', () => {
    const result = resolveAssetUrl(BASE, '../shared/pic.png');
    expect(result).toBe(
      expectedUrl(path.resolve('/docs/shared/pic.png'))
    );
  });

  it('resolves absolute filesystem paths', () => {
    const absolute = path.resolve('/var/assets/diagram.png');
    expect(resolveAssetUrl(BASE, absolute)).toBe(expectedUrl(absolute));
  });

  it('leaves http(s) URLs untouched', () => {
    expect(resolveAssetUrl(BASE, 'https://example.com/a.png')).toBeNull();
    expect(resolveAssetUrl(BASE, 'http://example.com/a.png')).toBeNull();
  });

  it('leaves data and blob URLs untouched', () => {
    expect(resolveAssetUrl(BASE, 'data:image/png;base64,AAAA')).toBeNull();
    expect(resolveAssetUrl(BASE, 'blob:abc-123')).toBeNull();
  });

  it('leaves protocol-relative URLs untouched', () => {
    expect(resolveAssetUrl(BASE, '//cdn.example.com/a.png')).toBeNull();
  });

  it('leaves in-document anchors untouched', () => {
    expect(resolveAssetUrl(BASE, '#section')).toBeNull();
  });

  it('returns null for empty references', () => {
    expect(resolveAssetUrl(BASE, '')).toBeNull();
    expect(resolveAssetUrl(BASE, '   ')).toBeNull();
    expect(resolveAssetUrl('', 'docs/logo.svg')).toBeNull();
  });

  it('strips query strings and fragments from references', () => {
    const result = resolveAssetUrl(BASE, 'images/logo.svg?v=2#frag');
    expect(result).toBe(
      expectedUrl(path.resolve('/docs/project/images/logo.svg'))
    );
  });

  it('decodes percent-encoded references', () => {
    const result = resolveAssetUrl(BASE, 'images/my%20logo.svg');
    expect(result).toBe(
      expectedUrl(path.resolve('/docs/project/images/my logo.svg'))
    );
  });
});
