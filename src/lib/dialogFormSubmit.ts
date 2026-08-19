import type { KeyboardEvent } from 'react';

/**
 * Enter: trigger primary form/dialog action (e.g. apply value) unless focus is on
 * button, textarea, or range slider — avoids double action with focused buttons.
 */
export function trySubmitDialogFormOnEnter(
  e: KeyboardEvent<HTMLDivElement>,
  canSubmit: boolean,
  submit: () => void,
): void {
  if (e.key !== 'Enter' || e.repeat || e.nativeEvent.isComposing) return;
  const t = e.target;
  if (t instanceof HTMLElement) {
    if (t.closest('button')) return;
    if (t.tagName === 'TEXTAREA') return;
    if (t instanceof HTMLInputElement && t.type === 'range') return;
  }
  if (!canSubmit) return;
  e.preventDefault();
  e.stopPropagation();
  submit();
}

/** Large touch-friendly buttons in dialog footers (spindle/feed, set axis, …). */
export const dialogFooterTouchButtonClass =
  'min-h-16 h-auto text-base touch-manipulation px-8 py-4';
