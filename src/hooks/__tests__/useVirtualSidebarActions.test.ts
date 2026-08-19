import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVirtualSidebarActions } from '../useVirtualSidebarActions';
import { eventBus } from '@/eventBus';

describe('useVirtualSidebarActions', () => {
  afterEach(() => {
    // no store side effects
  });

  it('publishes ui.flood.toggle for button 9', () => {
    const received: Array<{ source: string }> = [];
    const unsub = eventBus.subscribe('ui.flood.toggle', (payload) => {
      received.push(payload);
    });

    const { result } = renderHook(() => useVirtualSidebarActions());
    act(() => {
      result.current.executeButton(9, 'virtualSidebar');
    });

    expect(received).toEqual([{ source: 'virtualSidebar' }]);
    unsub();
  });

  it('publishes ui.spindle.direction for spindle buttons', () => {
    const received: Array<{ direction: string; source: string }> = [];
    const unsub = eventBus.subscribe('ui.spindle.direction', (payload) => {
      received.push(payload);
    });

    const { result } = renderHook(() => useVirtualSidebarActions());
    act(() => {
      result.current.executeButton(10, 'hotkey');
      result.current.executeButton(11, 'hotkey');
      result.current.executeButton(12, 'hotkey');
    });

    expect(received).toEqual([
      { direction: 'reverse', source: 'hotkey' },
      { direction: 'stop', source: 'hotkey' },
      { direction: 'forward', source: 'hotkey' },
    ]);
    unsub();
  });

  it('publishes ui.hal.softkey for HAL softkey buttons', () => {
    const received: Array<{ slot: number; source: string }> = [];
    const unsub = eventBus.subscribe('ui.hal.softkey', (payload) => {
      received.push(payload);
    });

    const { result } = renderHook(() => useVirtualSidebarActions());
    act(() => {
      result.current.executeButton(8, 'virtualSidebar');
      result.current.executeButton(13, 'hotkey');
      result.current.executeButton(16, 'virtualSidebar');
    });

    expect(received).toEqual([
      { slot: 14, source: 'virtualSidebar' },
      { slot: 15, source: 'hotkey' },
      { slot: 16, source: 'virtualSidebar' },
    ]);
    unsub();
  });
});
