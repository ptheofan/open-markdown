/**
 * FindBar - Floating search bar for find-in-page functionality
 */
import type { FindResult } from '@shared/types';

export interface FindBarCallbacks {
  onFind: (text: string, options: { matchCase: boolean }) => void;
  onFindNext: (text: string, options: { matchCase: boolean; forward: boolean }) => void;
  onStopFinding: () => void;
}

const FIND_BAR_CLASS = 'find-bar';
const FIND_BAR_VISIBLE_CLASS = 'find-bar-visible';
const DEBOUNCE_MS = 150;

export class FindBar {
  private readonly container: HTMLElement;
  private readonly element: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly countDisplay: HTMLSpanElement;
  private readonly caseToggle: HTMLButtonElement;
  private readonly callbacks: FindBarCallbacks;
  private readonly handleKeydown: (e: KeyboardEvent) => void;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private matchCase = false;
  private currentText = '';
  private isVisible = false;

  constructor(container: HTMLElement, callbacks: FindBarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.element = this.createElement();
    this.input = this.element.querySelector('.find-bar-input') as HTMLInputElement;
    this.countDisplay = this.element.querySelector('.find-bar-count') as HTMLSpanElement;
    this.caseToggle = this.element.querySelector('.find-bar-toggle-case') as HTMLButtonElement;

    this.handleKeydown = (e: KeyboardEvent) => this.onGlobalKeydown(e);

    this.setupEventListeners();
    this.container.appendChild(this.element);
  }

  show(): void {
    if (this.isVisible) {
      this.input.focus();
      this.input.select();
      return;
    }

    this.isVisible = true;
    this.element.classList.add(FIND_BAR_VISIBLE_CLASS);

    // Pre-fill with selection if available
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      this.input.value = selection.toString().trim();
      this.currentText = this.input.value;
    }

    this.input.focus();
    this.input.select();

    // Trigger initial search if there's text
    if (this.currentText) {
      this.callbacks.onFind(this.currentText, { matchCase: this.matchCase });
    }

    document.addEventListener('keydown', this.handleKeydown);
  }

  hide(): void {
    if (!this.isVisible) return;

    this.isVisible = false;
    this.element.classList.remove(FIND_BAR_VISIBLE_CLASS);
    this.callbacks.onStopFinding();
    this.countDisplay.textContent = '';
    document.removeEventListener('keydown', this.handleKeydown);
  }

  updateResult(result: FindResult): void {
    if (result.matches === 0) {
      this.countDisplay.textContent = 'No results';
      this.countDisplay.classList.add('find-bar-no-results');
    } else {
      this.countDisplay.textContent = `${result.activeMatchOrdinal} of ${result.matches}`;
      this.countDisplay.classList.remove('find-bar-no-results');
    }
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKeydown);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.element.remove();
  }

  private createElement(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = FIND_BAR_CLASS;
    el.innerHTML = `
      <input class="find-bar-input" type="text" placeholder="Find..." />
      <span class="find-bar-count"></span>
      <button class="find-bar-toggle-case" title="Match Case">Aa</button>
      <button class="find-bar-prev" title="Previous Match (Shift+Enter)">&#x2191;</button>
      <button class="find-bar-next" title="Next Match (Enter)">&#x2193;</button>
      <button class="find-bar-close" title="Close (Escape)">&#x2715;</button>
    `;
    return el;
  }

  private setupEventListeners(): void {
    // Input with debounce
    this.input.addEventListener('input', () => {
      this.currentText = this.input.value;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);

      if (!this.currentText) {
        this.callbacks.onStopFinding();
        this.countDisplay.textContent = '';
        this.countDisplay.classList.remove('find-bar-no-results');
        return;
      }

      this.debounceTimer = setTimeout(() => {
        this.callbacks.onFind(this.currentText, { matchCase: this.matchCase });
      }, DEBOUNCE_MS);
    });

    // Enter / Shift+Enter in input
    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.currentText) {
          this.callbacks.onFindNext(this.currentText, {
            matchCase: this.matchCase,
            forward: !e.shiftKey,
          });
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });

    // Case toggle
    this.caseToggle.addEventListener('click', () => {
      this.matchCase = !this.matchCase;
      this.caseToggle.classList.toggle('find-bar-toggle-active', this.matchCase);
      if (this.currentText) {
        this.callbacks.onFind(this.currentText, { matchCase: this.matchCase });
      }
    });

    // Prev / Next buttons
    this.element.querySelector('.find-bar-prev')!.addEventListener('click', () => {
      if (this.currentText) {
        this.callbacks.onFindNext(this.currentText, {
          matchCase: this.matchCase,
          forward: false,
        });
      }
    });

    this.element.querySelector('.find-bar-next')!.addEventListener('click', () => {
      if (this.currentText) {
        this.callbacks.onFindNext(this.currentText, {
          matchCase: this.matchCase,
          forward: true,
        });
      }
    });

    // Close button
    this.element.querySelector('.find-bar-close')!.addEventListener('click', () => {
      this.hide();
    });
  }

  private onGlobalKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.isVisible) {
      e.preventDefault();
      this.hide();
    }
  }
}

export function createFindBar(container: HTMLElement, callbacks: FindBarCallbacks): FindBar {
  return new FindBar(container, callbacks);
}
