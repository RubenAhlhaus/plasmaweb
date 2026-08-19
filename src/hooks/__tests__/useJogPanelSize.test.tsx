import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { useJogPanelSize } from '../useJogPanelSize';
import {
  JOG_CONTROL_FULL_MIN_WIDTH_PX,
  MACHINE_TWO_COLUMN_MIN_WIDTH_PX,
} from '@/lib/jogControlSize';

describe('useJogPanelSize', () => {
  let resizeObserverCallback: ResizeObserverCallback | null = null;

  beforeEach(() => {
    resizeObserverCallback = null;

    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(function MockResizeObserver(this: ResizeObserver, callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        this.unobserve = vi.fn();
      }),
    );

    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === `(min-width: ${MACHINE_TWO_COLUMN_MIN_WIDTH_PX}px)`,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns full size when the panel is wide enough in two-column layout', () => {
    const panelRef = createRef<HTMLDivElement>();
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      width: JOG_CONTROL_FULL_MIN_WIDTH_PX + 50,
      height: 400,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    });
    panelRef.current = element;

    const { result } = renderHook(() => useJogPanelSize(panelRef));

    expect(result.current).toBe('full');
  });

  it('returns compact when the panel is too narrow', () => {
    const panelRef = createRef<HTMLDivElement>();
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      width: JOG_CONTROL_FULL_MIN_WIDTH_PX - 20,
      height: 400,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    });
    panelRef.current = element;

    const { result } = renderHook(() => useJogPanelSize(panelRef));

    expect(result.current).toBe('compact');
  });

  it('updates when ResizeObserver fires', async () => {
    const panelRef = createRef<HTMLDivElement>();
    const element = document.createElement('div');
    const rectSpy = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 400,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    });
    panelRef.current = element;

    const { result } = renderHook(() => useJogPanelSize(panelRef));
    expect(result.current).toBe('compact');

    rectSpy.mockReturnValue({
      width: JOG_CONTROL_FULL_MIN_WIDTH_PX + 80,
      height: 400,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    });

    await act(async () => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current).toBe('full');
  });
});
