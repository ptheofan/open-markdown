/**
 * ChangeGutter - Visual indicators for changed lines in the rendered markdown
 */
import type { DiffResult, LineChange } from '@shared/types';

export interface ChangeGutterOptions {
  scrollContainer: HTMLElement;
  contentContainer: HTMLElement;
  onReset: () => void;
}

const ADDED_CLASS = 'change-gutter-added';
const MODIFIED_CLASS = 'change-gutter-modified';
const DELETED_CLASS = 'change-gutter-deleted';
const RESET_BTN_CLASS = 'change-gutter-reset-btn';
const DELETED_MARKER_ATTR = 'data-change-gutter-deleted';

export class ChangeGutter {
  private readonly scrollContainer: HTMLElement;
  private readonly contentContainer: HTMLElement;
  private readonly onReset: () => void;
  private readonly resetButton: HTMLButtonElement;
  private readonly handleResetClick: () => void;

  constructor(options: ChangeGutterOptions) {
    this.scrollContainer = options.scrollContainer;
    this.contentContainer = options.contentContainer;
    this.onReset = options.onReset;
    this.handleResetClick = () => this.onReset();
    this.resetButton = this.createResetButton();
  }

  applyChanges(diffResult: DiffResult): void {
    this.clearIndicators();

    if (!diffResult.hasChanges) {
      return;
    }

    const elements = this.contentContainer.querySelectorAll('[data-source-lines]');

    for (const el of elements) {
      const attr = el.getAttribute('data-source-lines');
      if (!attr) continue;

      const [startStr, endStr] = attr.split('-');
      const elStart = Number(startStr);
      const elEnd = Number(endStr);

      if (isNaN(elStart) || isNaN(elEnd)) continue;

      for (const change of diffResult.changes) {
        if (change.type === 'deleted') continue;

        if (this.rangesOverlap(elStart, elEnd, change.startLine, change.endLine)) {
          const cssClass = change.type === 'added' ? ADDED_CLASS : MODIFIED_CLASS;
          el.classList.add(cssClass);
          break;
        }
      }
    }

    for (const change of diffResult.changes) {
      if (change.type !== 'deleted') continue;
      this.insertDeletionMarker(change, elements);
    }

    this.showResetButton();
  }

  clearIndicators(): void {
    const added = this.contentContainer.querySelectorAll(`.${ADDED_CLASS}`);
    const modified = this.contentContainer.querySelectorAll(`.${MODIFIED_CLASS}`);
    for (const el of added) el.classList.remove(ADDED_CLASS);
    for (const el of modified) el.classList.remove(MODIFIED_CLASS);

    const markers = this.contentContainer.querySelectorAll(`[${DELETED_MARKER_ATTR}]`);
    for (const marker of markers) marker.remove();

    this.hideResetButton();
  }

  destroy(): void {
    this.clearIndicators();
    this.resetButton.removeEventListener('click', this.handleResetClick);
    this.resetButton.remove();
  }

  private rangesOverlap(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number,
  ): boolean {
    return aStart < bEnd && bStart < aEnd;
  }

  private insertDeletionMarker(
    change: LineChange,
    elements: NodeListOf<Element>,
  ): void {
    let targetElement: Element | null = null;

    for (const el of elements) {
      const attr = el.getAttribute('data-source-lines');
      if (!attr) continue;

      const [startStr] = attr.split('-');
      const elStart = Number(startStr);

      if (elStart >= change.startLine) {
        targetElement = el;
        break;
      }
    }

    const marker = document.createElement('div');
    marker.className = DELETED_CLASS;
    marker.setAttribute(DELETED_MARKER_ATTR, '');

    if (targetElement) {
      targetElement.parentElement?.insertBefore(marker, targetElement);
    } else {
      this.contentContainer.appendChild(marker);
    }
  }

  private createResetButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = RESET_BTN_CLASS;
    btn.textContent = 'Reset';
    btn.title = 'Accept current content as new baseline';
    btn.style.display = 'none';
    btn.addEventListener('click', this.handleResetClick);
    this.scrollContainer.appendChild(btn);
    return btn;
  }

  private showResetButton(): void {
    this.resetButton.style.display = '';
  }

  private hideResetButton(): void {
    this.resetButton.style.display = 'none';
  }
}

export function createChangeGutter(options: ChangeGutterOptions): ChangeGutter {
  return new ChangeGutter(options);
}
