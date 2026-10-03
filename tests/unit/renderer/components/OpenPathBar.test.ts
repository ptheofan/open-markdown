/**
 * @vitest-environment jsdom
 *
 * The Open Path bar resolves what is typed as it is typed, shows where the
 * path lands, and opens it on Enter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  createOpenPathBar,
  type OpenPathBar,
  type OpenPathBarCallbacks,
} from '@renderer/components/OpenPathBar';
import type { PathResolveResult } from '@shared/types';

const ok = (filePath: string): PathResolveResult => ({
  success: true,
  filePath,
  resolvedFrom: 'document',
});

describe('OpenPathBar', () => {
  let container: HTMLElement;
  let bar: OpenPathBar;
  let callbacks: {
    resolve: ReturnType<typeof vi.fn<OpenPathBarCallbacks['resolve']>>;
    onOpen: ReturnType<typeof vi.fn<OpenPathBarCallbacks['onOpen']>>;
    getBaseDir: ReturnType<typeof vi.fn<OpenPathBarCallbacks['getBaseDir']>>;
  };

  const input = (): HTMLInputElement =>
    container.querySelector('.open-path-input') as HTMLInputElement;
  const status = (): HTMLElement =>
    container.querySelector('.open-path-status') as HTMLElement;
  const root = (): HTMLElement =>
    container.querySelector('.open-path-bar') as HTMLElement;

  const type = (value: string): void => {
    input().value = value;
    input().dispatchEvent(new Event('input', { bubbles: true }));
  };
  const press = (key: string): void => {
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
  };
  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(200);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    callbacks = {
      resolve: vi.fn<OpenPathBarCallbacks['resolve']>(),
      onOpen: vi.fn<OpenPathBarCallbacks['onOpen']>(),
      getBaseDir: vi.fn<OpenPathBarCallbacks['getBaseDir']>(
        () => '/docs/project'
      ),
    };
    bar = createOpenPathBar(container, callbacks);
  });

  afterEach(() => {
    bar.destroy();
    container.remove();
    vi.useRealTimers();
  });

  it('is hidden until shown, then focuses the box', () => {
    expect(bar.isVisible()).toBe(false);
    expect(root().classList.contains('open-path-bar-visible')).toBe(false);

    bar.show();

    expect(bar.isVisible()).toBe(true);
    expect(root().classList.contains('open-path-bar-visible')).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it('tells where relative paths start from while the box is empty', () => {
    bar.show();
    expect(status().textContent).toContain('/docs/project');

    callbacks.getBaseDir.mockReturnValue(null);
    bar.hide();
    bar.show();
    expect(status().textContent).toContain('home folder');
  });

  it('resolves as the user types, after a short pause', async () => {
    callbacks.resolve.mockResolvedValue(ok('/docs/project/spec.md'));
    bar.show();

    type('sp');
    type('spec.md');
    expect(callbacks.resolve).not.toHaveBeenCalled();

    await flush();

    expect(callbacks.resolve).toHaveBeenCalledTimes(1);
    expect(callbacks.resolve).toHaveBeenCalledWith('spec.md');
    expect(status().textContent).toBe('/docs/project/spec.md');
    expect(status().classList.contains('open-path-status-ok')).toBe(true);
  });

  it('shows the error and where it looked when the path cannot be opened', async () => {
    callbacks.resolve.mockResolvedValue({
      success: false,
      filePath: '/docs/project/nope.md',
      resolvedFrom: 'document',
      error: 'No such file.',
    });
    bar.show();

    type('nope.md');
    await flush();

    expect(status().textContent).toContain('/docs/project/nope.md');
    expect(status().textContent).toContain('No such file.');
    expect(status().classList.contains('open-path-status-error')).toBe(true);
  });

  it('ignores a slow answer for text that has since changed', async () => {
    let resolveFirst: (r: PathResolveResult) => void = () => {};
    callbacks.resolve
      .mockImplementationOnce(
        () =>
          new Promise<PathResolveResult>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(ok('/docs/project/b.md'));
    bar.show();

    type('a.md');
    await flush();
    type('b.md');
    await flush();
    resolveFirst(ok('/docs/project/a.md'));
    await flush();

    expect(status().textContent).toBe('/docs/project/b.md');
  });

  it('opens the resolved file on Enter and closes', async () => {
    callbacks.resolve.mockResolvedValue(ok('/docs/project/spec.md'));
    bar.show();

    type('spec.md');
    await flush();
    press('Enter');
    await flush();

    expect(callbacks.onOpen).toHaveBeenCalledWith('/docs/project/spec.md');
    expect(bar.isVisible()).toBe(false);
  });

  it('resolves first when Enter follows the paste immediately', async () => {
    callbacks.resolve.mockResolvedValue(ok('/docs/project/spec.md'));
    bar.show();

    type('spec.md');
    press('Enter');
    await flush();

    expect(callbacks.resolve).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpen).toHaveBeenCalledWith('/docs/project/spec.md');
  });

  it('does nothing on Enter when the path cannot be opened', async () => {
    callbacks.resolve.mockResolvedValue({
      success: false,
      error: 'No such file.',
    });
    bar.show();

    type('nope.md');
    press('Enter');
    await flush();

    expect(callbacks.onOpen).not.toHaveBeenCalled();
    expect(bar.isVisible()).toBe(true);
  });

  it('does nothing on Enter with an empty box', async () => {
    bar.show();
    press('Enter');
    await flush();

    expect(callbacks.resolve).not.toHaveBeenCalled();
    expect(callbacks.onOpen).not.toHaveBeenCalled();
  });

  it('keeps the text between showings so a path can be corrected', () => {
    bar.show();
    type('spec.md');
    bar.hide();
    bar.show();

    expect(input().value).toBe('spec.md');
  });

  it('closes on Escape, from the box and from the document', () => {
    bar.show();
    press('Escape');
    expect(bar.isVisible()).toBe(false);

    bar.show();
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(bar.isVisible()).toBe(false);
  });

  it('closes from the close button', () => {
    bar.show();
    (container.querySelector('.open-path-close') as HTMLButtonElement).click();
    expect(bar.isVisible()).toBe(false);
  });

  it('toggles', () => {
    bar.toggle();
    expect(bar.isVisible()).toBe(true);
    bar.toggle();
    expect(bar.isVisible()).toBe(false);
  });
});
