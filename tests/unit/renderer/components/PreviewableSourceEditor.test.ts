/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { PreviewableSourceEditor } from '../../../../src/renderer/components/PreviewableSourceEditor';
import type { PreviewablePlugin } from '../../../../src/plugins/types/preview';
import type { MarkdownSlice } from '../../../../src/renderer/services/MarkdownSlicer';
import type { MarkdownPlugin } from '../../../../src/shared/types';

function contentEl(html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'slice-content';
  el.insertAdjacentHTML('afterbegin', html);
  document.body.appendChild(el);
  return el;
}

function slice(partial: Partial<MarkdownSlice> = {}): MarkdownSlice {
  return { index: 0, type: 'code', raw: '```mermaid\nA --> B\n```', startLine: 0, endLine: 2, ...partial };
}

function fakePlugin(overrides: Partial<PreviewablePlugin> = {}): MarkdownPlugin & PreviewablePlugin {
  return {
    metadata: { id: 'fake', name: 'fake', version: '1.0.0', description: '' },
    apply: () => {},
    matchesSlice: () => true,
    extractSource: () => 'A --> B',
    renderPreview: vi.fn(() => Promise.resolve({ ok: true as const })),
    applySourceToRaw: (_s, source) => '```mermaid\n' + source + '\n```',
    ...overrides,
  };
}

describe('PreviewableSourceEditor lifecycle', () => {
  it('start() builds preview/error-chip/textarea structure inside contentEl', () => {
    const el = contentEl('<div class="mermaid-container"><svg>old</svg></div>');
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit: vi.fn() });
    editor.start();
    expect(el.querySelector('.preview-source-preview')).not.toBe(null);
    expect(el.querySelector('.preview-source-error')).not.toBe(null);
    expect(el.querySelector('textarea.slice-raw-editor')).not.toBe(null);
    // existing rendered SVG was moved into the preview area
    const movedSvg = el.querySelector('.preview-source-preview .mermaid-container svg');
    expect(movedSvg).not.toBe(null);
    expect(movedSvg!.textContent).toBe('old');
  });

  it('start() seeds textarea with plugin.extractSource and focuses it', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit: vi.fn() });
    editor.start();
    const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(ta.value).toBe('A --> B');
    expect(document.activeElement).toBe(ta);
  });

  it('start() hides the error chip initially', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit: vi.fn() });
    editor.start();
    expect(el.querySelector<HTMLElement>('.preview-source-error')!.hidden).toBe(true);
  });

  it('commit() calls plugin.applySourceToRaw with the textarea value and forwards to onCommit', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const onCommit = vi.fn();
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit });
    editor.start();
    el.querySelector<HTMLTextAreaElement>('textarea')!.value = 'C --> D';
    editor.commit();
    expect(onCommit).toHaveBeenCalledWith('```mermaid\nC --> D\n```');
  });

  it('commit() is idempotent — a second call is a no-op', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const onCommit = vi.fn();
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit });
    editor.start();
    editor.commit();
    editor.commit();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe('PreviewableSourceEditor debounced render', () => {
  it('calls plugin.renderPreview after a 250ms pause in typing', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"></div>');
      const plugin = fakePlugin();
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = 'X --> Y';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      expect(plugin.renderPreview).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(plugin.renderPreview).toHaveBeenCalledTimes(1);
      expect(plugin.renderPreview).toHaveBeenCalledWith('X --> Y', expect.any(HTMLElement));
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces rapid keystrokes into one render after the pause', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"></div>');
      const plugin = fakePlugin();
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      for (const v of ['a', 'ab', 'abc', 'abcd']) {
        ta.value = v;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(100); // less than 250ms
      }
      expect(plugin.renderPreview).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(plugin.renderPreview).toHaveBeenCalledTimes(1);
      expect(plugin.renderPreview).toHaveBeenCalledWith('abcd', expect.any(HTMLElement));
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces preview contents on { ok: true }', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"><svg>old</svg></div>');
      const plugin = fakePlugin({
        renderPreview: vi.fn((_src, target) => {
          target.replaceChildren();
          target.insertAdjacentHTML('afterbegin', '<svg>new</svg>');
          return Promise.resolve({ ok: true as const });
        }),
      });
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = 'X --> Y';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTimersAsync();
      const previewSvg = el.querySelector('.preview-source-preview > svg');
      expect(previewSvg).not.toBe(null);
      expect(previewSvg!.textContent).toBe('new');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending debounced render when commit is called', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"></div>');
      const plugin = fakePlugin();
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = 'X --> Y';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      editor.commit();
      await vi.advanceTimersByTimeAsync(500);
      expect(plugin.renderPreview).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PreviewableSourceEditor race control', () => {
  it('drops a slow earlier render result when a newer render has fired', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container">initial</div>');
      let resolveFirst!: () => void;
      const firstPromise = new Promise<void>((r) => { resolveFirst = r; });
      const renderPreview = vi.fn(async (source: string, target: HTMLElement) => {
        if (source === 'slow') {
          await firstPromise;
          target.replaceChildren();
          target.insertAdjacentHTML('afterbegin', '<svg>slow</svg>');
          return { ok: true as const };
        }
        target.replaceChildren();
        target.insertAdjacentHTML('afterbegin', '<svg>fast</svg>');
        return { ok: true as const };
      });
      const plugin = fakePlugin({ renderPreview });
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;

      ta.value = 'slow';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250); // first render starts but awaits

      ta.value = 'fast';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250); // second render starts and completes
      await vi.runAllTimersAsync();

      // Now release the slow first render — it should NOT overwrite "fast".
      resolveFirst();
      await vi.runAllTimersAsync();

      const previewSvg = el.querySelector('.preview-source-preview > svg');
      expect(previewSvg).not.toBe(null);
      expect(previewSvg!.textContent).toBe('fast');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PreviewableSourceEditor error handling', () => {
  it('keeps the previous preview and shows the error chip on { ok: false }', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"><svg>good</svg></div>');
      const plugin = fakePlugin({
        renderPreview: vi.fn(() => Promise.resolve({ ok: false as const, error: 'Syntax error: foo' })),
      });
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = 'bad';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTimersAsync();

      // Previous preview untouched
      const previewSvg = el.querySelector('.preview-source-preview .mermaid-container svg');
      expect(previewSvg!.textContent).toBe('good');
      // Error chip visible with the message
      const errorChip = el.querySelector<HTMLElement>('.preview-source-error')!;
      expect(errorChip.hidden).toBe(false);
      expect(errorChip.querySelector('.preview-source-error-text')!.textContent).toBe('Syntax error: foo');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the error chip again on the next successful render', async () => {
    vi.useFakeTimers();
    try {
      const el = contentEl('<div class="mermaid-container"><svg>good</svg></div>');
      let next: { ok: true } | { ok: false; error: string } = { ok: false, error: 'oops' };
      const plugin = fakePlugin({
        renderPreview: vi.fn((_src, target) => {
          if (next.ok) {
            target.replaceChildren();
            target.insertAdjacentHTML('afterbegin', '<svg>new</svg>');
          }
          return Promise.resolve(next);
        }),
      });
      const editor = new PreviewableSourceEditor(el, slice(), plugin, { onCommit: vi.fn() });
      editor.start();
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;

      ta.value = 'bad';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTimersAsync();
      expect(el.querySelector<HTMLElement>('.preview-source-error')!.hidden).toBe(false);

      next = { ok: true };
      ta.value = 'good';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTimersAsync();
      expect(el.querySelector<HTMLElement>('.preview-source-error')!.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PreviewableSourceEditor Esc', () => {
  it('Escape on the textarea commits the session', () => {
    const el = contentEl('<div class="mermaid-container"></div>');
    const onCommit = vi.fn();
    const editor = new PreviewableSourceEditor(el, slice(), fakePlugin(), { onCommit });
    editor.start();
    const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'C --> D';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onCommit).toHaveBeenCalledWith('```mermaid\nC --> D\n```');
  });
});
