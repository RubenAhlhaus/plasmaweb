import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMacroToolPreset } from '@/components/macros/MacroToolPresetFields';
import type { Tool } from '@/types/tools';

const tools: Tool[] = [
  {
    id: 'mill-1',
    toolNumber: 3,
    name: 'Endmill',
    lcncguiPresets: [
      { id: 'rough', name: 'Rough', spindle_rpm: 8000, feed_mm_min: 500 },
    ],
  } as Tool,
];

describe('useMacroToolPreset', () => {
  it('applies preset spindle and feed keys from MDI', () => {
    const setParams = vi.fn();
    const setCommitError = vi.fn();

    const { result } = renderHook(() =>
      useMacroToolPreset({
        tools,
        params: { toolId: 'mill-1', presetId: '', spindle: '', feed: '' },
        setParams,
        setCommitError,
        feedKeys: ['feed'],
      }),
    );

    act(() => {
      result.current.onPresetChange('rough');
    });

    expect(setCommitError).toHaveBeenCalledWith(null);
    expect(setParams).toHaveBeenCalledOnce();
    const updater = setParams.mock.calls[0][0] as (prev: Record<string, string>) => Record<string, string>;
    expect(updater({ toolId: 'mill-1', presetId: '', spindle: '', feed: '' })).toMatchObject({
      presetId: 'rough',
      spindle: '8000',
      feed: '500',
    });
  });

  it('clears configured feed keys when tool changes', () => {
    const setParams = vi.fn();
    const setCommitError = vi.fn();

    const { result } = renderHook(() =>
      useMacroToolPreset({
        tools,
        params: { toolId: '', presetId: 'rough', spindle: '8000', feedXY: '500', feedZ: '500' },
        setParams,
        setCommitError,
        feedKeys: ['feedXY', 'feedZ'],
      }),
    );

    act(() => {
      result.current.onToolChange('mill-1');
    });

    const updater = setParams.mock.calls[0][0] as (prev: Record<string, string>) => Record<string, string>;
    expect(updater({
      toolId: '',
      presetId: 'rough',
      spindle: '8000',
      feedXY: '500',
      feedZ: '500',
    })).toEqual({
      toolId: 'mill-1',
      presetId: '',
      spindle: '',
      feedXY: '',
      feedZ: '',
    });
  });
});
