import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HOTKEY_DISPLAY_LABELS,
  formatHotkey,
  shouldIgnoreGlobalHotkeyTarget,
} from '../virtualSidebarHotkeys';

describe('shouldIgnoreGlobalHotkeyTarget', () => {
  it('ignores text inputs and textareas', () => {
    expect(shouldIgnoreGlobalHotkeyTarget(document.createElement('input'))).toBe(true);
    expect(shouldIgnoreGlobalHotkeyTarget(document.createElement('textarea'))).toBe(true);
    expect(shouldIgnoreGlobalHotkeyTarget(document.createElement('select'))).toBe(true);
  });

  it('ignores contenteditable elements', () => {
    const editable = document.createElement('div');
    editable.isContentEditable = true;
    expect(shouldIgnoreGlobalHotkeyTarget(editable)).toBe(true);
  });

  it('ignores targets inside hotkey capture UI', () => {
    const root = document.createElement('div');
    root.setAttribute('data-hotkey-capture', 'true');
    const button = document.createElement('button');
    root.appendChild(button);
    expect(shouldIgnoreGlobalHotkeyTarget(button)).toBe(true);
  });

  it('does not ignore dialog buttons or document body', () => {
    const dialogButton = document.createElement('button');
    expect(shouldIgnoreGlobalHotkeyTarget(dialogButton)).toBe(false);
    expect(shouldIgnoreGlobalHotkeyTarget(document.body)).toBe(false);
  });
});

describe('formatHotkey localization', () => {
  it('uses custom modifier labels when provided', () => {
    expect(
      formatHotkey(
        { key: 'F1', ctrl: true, shift: true },
        { ...DEFAULT_HOTKEY_DISPLAY_LABELS, ctrl: 'Strg', shift: 'Umschalt' },
      ),
    ).toBe('Strg+Umschalt+F1');
  });
});
