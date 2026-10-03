/**
 * @vitest-environment jsdom
 *
 * The outline panel mirrors the document's headings, follows the section at
 * the top of the viewport, and lets clicks travel both ways between the
 * panel and the document.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createOutlinePanel,
  type OutlinePanel,
} from '@renderer/components/OutlinePanel';

/** Fake vertical layout: each element gets a fixed top; the scroll container
 *  shifts everything by its scrollTop. Enough to drive the active logic. */
function layout(
  scroller: HTMLElement,
  tops: Map<Element | undefined, number>
): void {
  const rect = (top: number, height = 20) =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      height,
      x: 0,
      y: top,
      toJSON() {},
    }) as DOMRect;
  scroller.getBoundingClientRect = () => rect(0, 500);
  for (const [el, top] of tops) {
    (el as HTMLElement).getBoundingClientRect = () =>
      rect(top - scroller.scrollTop);
  }
}

function makeDocument(html: string) {
  document.body.innerHTML = `
    <aside id="outline-panel" class="outline-panel"></aside>
    <article id="markdown-viewer"><div id="markdown-content">${html}</div></article>
  `;
  const panel = document.getElementById('outline-panel')!;
  const scroller = document.getElementById('markdown-viewer')!;
  const content = document.getElementById('markdown-content')!;
  return { panel, scroller, content };
}

const items = (panel: HTMLElement) =>
  Array.from(panel.querySelectorAll<HTMLElement>('.outline-item'));
const activeText = (panel: HTMLElement) =>
  panel.querySelector('.outline-item-active')?.textContent ?? null;

async function flush(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
}

describe('OutlinePanel', () => {
  let outline: OutlinePanel | null = null;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0)
    );
  });

  afterEach(() => {
    outline?.destroy();
    outline = null;
    vi.unstubAllGlobals();
  });

  it('lists headings in document order, indented relative to the shallowest level', () => {
    const { panel, scroller, content } = makeDocument(
      '<h2 id="a">Alpha</h2><p>x</p><h3 id="b">Beta</h3><h2 id="c">Gamma</h2>'
    );
    outline = createOutlinePanel({
      panel,
      scrollContainer: scroller,
      contentContainer: content,
    });

    const list = items(panel);
    expect(list.map((i) => i.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(
      list.map((i) => i.style.getPropertyValue('--outline-depth'))
    ).toEqual(['0', '1', '0']);
    expect(panel.classList.contains('outline-panel-collapsed')).toBe(false);
  });

  it('collapses when the document has no headings and reappears once it does', async () => {
    const { panel, scroller, content } = makeDocument('<p>just text</p>');
    outline = createOutlinePanel({
      panel,
      scrollContainer: scroller,
      contentContainer: content,
    });
    expect(panel.classList.contains('outline-panel-collapsed')).toBe(true);

    content.innerHTML = '<h1>Title</h1>';
    await flush();

    expect(panel.classList.contains('outline-panel-collapsed')).toBe(false);
    expect(items(panel).map((i) => i.textContent)).toEqual(['Title']);
  });

  it('highlights the last heading at or above the top of the viewport', async () => {
    const { panel, scroller, content } = makeDocument(
      '<h1>One</h1><h2>Two</h2><h2>Three</h2>'
    );
    const [h1, h2a, h2b] = Array.from(content.querySelectorAll('h1, h2'));
    layout(
      scroller,
      new Map([
        [h1, 0],
        [h2a, 300],
        [h2b, 600],
      ])
    );
    outline = createOutlinePanel({
      panel,
      scrollContainer: scroller,
      contentContainer: content,
    });

    expect(activeText(panel)).toBe('One');

    scroller.scrollTop = 310;
    scroller.dispatchEvent(new Event('scroll'));
    await flush();

    expect(activeText(panel)).toBe('Two');
  });

  it('falls back to the first heading when every heading is below the top', () => {
    const { panel, scroller, content } = makeDocument(
      '<p>intro</p><h1>One</h1><h2>Two</h2>'
    );
    const [h1, h2] = Array.from(content.querySelectorAll('h1, h2'));
    layout(
      scroller,
      new Map([
        [h1, 200],
        [h2, 400],
      ])
    );
    outline = createOutlinePanel({
      panel,
      scrollContainer: scroller,
      contentContainer: content,
    });

    expect(activeText(panel)).toBe('One');
  });

  it('clicking an entry scrolls the document to that heading and highlights it', () => {
    const { panel, scroller, content } = makeDocument(
      '<h1>One</h1><h2>Two</h2>'
    );
    const [h1, h2] = Array.from(content.querySelectorAll('h1, h2'));
    layout(
      scroller,
      new Map([
        [h1, 0],
        [h2, 350],
      ])
    );
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    outline = createOutlinePanel({
      panel,
      scrollContainer: scroller,
      contentContainer: content,
    });

    items(panel)[1]?.click();

    expect(scrollTo).toHaveBeenCalledWith({ top: 350, behavior: 'smooth' });
    expect(activeText(panel)).toBe('Two');
  });

  it('clicking inside a section of the document moves the panel to that section', () => {
    const { panel, scroller, content } = makeDocument(
      '<h1>One</h1><p id="p1">a</p><h2>Two</h2><p id="p2">b</p><h2>Three</h2>'
    );
    const [h1, h2a, h2b] = Array.from(content.querySelectorAll('h1, h2'));
    layout(
      scroller,
      new Map([
        [h1, 0],
        [h2a, 100],
        [h2b, 200],
      ])
    );
    outline = createOutlinePanel({
      panel,
      scrollContainer: scroller,
      contentContainer: content,
    });

    document
      .getElementById('p2')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(activeText(panel)).toBe('Two');

    document
      .getElementById('p1')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(activeText(panel)).toBe('One');
  });

  it('a section chosen by click stays highlighted until the user scrolls', async () => {
    const { panel, scroller, content } = makeDocument(
      '<h1>One</h1><p id="p1">a</p><h2>Two</h2>'
    );
    const [h1, h2] = Array.from(content.querySelectorAll('h1, h2'));
    layout(
      scroller,
      new Map([
        [h1, 0],
        [h2, 100],
      ])
    );
    outline = createOutlinePanel({
      panel,
      scrollContainer: scroller,
      contentContainer: content,
    });

    content
      .querySelector('h2')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(activeText(panel)).toBe('Two');

    scroller.dispatchEvent(new Event('scroll'));
    await flush();
    expect(activeText(panel)).toBe('One');
  });

  it('toggles visibility and reports it', () => {
    const { panel, scroller, content } = makeDocument('<h1>One</h1>');
    const onVisibilityChange = vi.fn();
    outline = createOutlinePanel({
      panel,
      scrollContainer: scroller,
      contentContainer: content,
      onVisibilityChange,
    });

    outline.toggle();
    expect(outline.isVisible()).toBe(false);
    expect(panel.classList.contains('outline-panel-collapsed')).toBe(true);
    expect(onVisibilityChange).toHaveBeenCalledWith(false);

    outline.toggle();
    expect(panel.classList.contains('outline-panel-collapsed')).toBe(false);
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true);
  });

  it('rebuilds when the document re-renders', async () => {
    const { panel, scroller, content } = makeDocument('<h1>Old</h1>');
    outline = createOutlinePanel({
      panel,
      scrollContainer: scroller,
      contentContainer: content,
    });

    content.innerHTML = '<h1>New</h1><h2>Child</h2>';
    await flush();

    expect(items(panel).map((i) => i.textContent)).toEqual(['New', 'Child']);
  });
});
