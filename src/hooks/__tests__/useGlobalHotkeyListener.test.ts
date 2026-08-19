import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '@/eventBus';
import { useAppStore } from '@/store';
import { useGlobalHotkeyListener } from '../useGlobalHotkeyListener';

const executeButtonMock = vi.fn();

vi.mock('../useVirtualSidebarActions', () => ({
  useVirtualSidebarActions: () => ({ executeButton: executeButtonMock }),
}));

function dispatchKeyDown(
  init: Partial<KeyboardEventInit> & { key: string },
  target: EventTarget = document.body,
) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, 'target', { value: target });
  document.dispatchEvent(event);
  return event;
}

describe('useGlobalHotkeyListener', () => {
  beforeEach(() => {
    executeButtonMock.mockReset();
    useAppStore.setState({
      virtualSidebarHotkeys: { 2: { key: 'F9' } },
      feedOverrideHotkeys: { 8: { key: 'F8' } },
      spindleOverrideHotkeys: { 11: { key: 'F11' } },
    });
  });

  it('triggers the mapped action for a configured hotkey', () => {
    renderHook(() => useGlobalHotkeyListener());

    dispatchKeyDown({ key: 'F9' });

    expect(executeButtonMock).toHaveBeenCalledWith(2, 'hotkey');
  });

  it('publishes feed override preset for a configured hotkey', () => {
    const publishSpy = vi.spyOn(eventBus, 'publish');
    renderHook(() => useGlobalHotkeyListener());

    dispatchKeyDown({ key: 'F8' });

    expect(publishSpy).toHaveBeenCalledWith('ui.feed.setOverride', {
      percent: 80,
      source: 'hotkey',
    });
    expect(executeButtonMock).not.toHaveBeenCalled();
    publishSpy.mockRestore();
  });

  it('publishes spindle override preset for a configured hotkey', () => {
    const publishSpy = vi.spyOn(eventBus, 'publish');
    renderHook(() => useGlobalHotkeyListener());

    dispatchKeyDown({ key: 'F11' });

    expect(publishSpy).toHaveBeenCalledWith('ui.spindle.setOverride', {
      percent: 125,
      source: 'hotkey',
    });
    publishSpy.mockRestore();
  });

  it('ignores hotkeys while focus is in a text field', () => {
    renderHook(() => useGlobalHotkeyListener());
    const input = document.createElement('input');
    document.body.appendChild(input);

    dispatchKeyDown({ key: 'F9' }, input);

    expect(executeButtonMock).not.toHaveBeenCalled();
    input.remove();
  });

  it('fires hotkeys while focus is on the document body (e.g. Settings screen)', () => {
    renderHook(() => useGlobalHotkeyListener());

    dispatchKeyDown({ key: 'F9' }, document.body);

    expect(executeButtonMock).toHaveBeenCalledWith(2, 'hotkey');
  });

  it('does not trigger while a hotkey is being captured', () => {
    renderHook(() => useGlobalHotkeyListener());
    const captureRoot = document.createElement('div');
    captureRoot.setAttribute('data-hotkey-capture', 'true');
    const captureButton = document.createElement('button');
    captureRoot.appendChild(captureButton);
    document.body.appendChild(captureRoot);

    dispatchKeyDown({ key: 'F9' }, captureButton);

    expect(executeButtonMock).not.toHaveBeenCalled();
    captureRoot.remove();
  });
});
