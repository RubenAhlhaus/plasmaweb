import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  usePendingWsCommandResult,
  usePendingWsCommandResultMap,
  usePendingWsCommandResults,
  useWsCommandResultHistoryEffect,
} from '@/hooks/usePendingWsCommandResult';
import { useAppStore } from '@/store';

describe('usePendingWsCommandResult', () => {
  afterEach(() => {
    useAppStore.getState().setLastWsCommandResult(null);
  });

  it('calls onResult when commandResultHistory gains a matching entry', () => {
    const pendingRef = { current: 'cmd-1' as string | null };
    const onResult = vi.fn();

    renderHook(() => usePendingWsCommandResult(pendingRef, { onResult }));

    act(() => {
      useAppStore.getState().setLastWsCommandResult({ commandId: 'cmd-1', ok: true });
    });

    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith({ commandId: 'cmd-1', ok: true });
  });

  it('respects enabled: false', () => {
    const pendingRef = { current: 'cmd-2' as string | null };
    const onResult = vi.fn();

    renderHook(() =>
      usePendingWsCommandResult(pendingRef, { enabled: false, onResult }),
    );

    act(() => {
      useAppStore.getState().setLastWsCommandResult({ commandId: 'cmd-2', ok: true });
    });

    expect(onResult).not.toHaveBeenCalled();
  });

  it('deduplicates when history grows but pending ref stays set', () => {
    const pendingRef = { current: 'dup-cmd' as string | null };
    const onResult = vi.fn();

    renderHook(() => usePendingWsCommandResult(pendingRef, { onResult }));

    act(() => {
      useAppStore.getState().setLastWsCommandResult({ commandId: 'dup-cmd', ok: true });
      useAppStore.getState().setLastWsCommandResult({ commandId: 'other', ok: true });
    });

    expect(onResult).toHaveBeenCalledOnce();
  });

  it('resolves each pending id via usePendingWsCommandResults', () => {
    const pendingRef = { current: new Set(['a', 'b']) };
    const onResult = vi.fn();

    renderHook(() => usePendingWsCommandResults(pendingRef, { onResult }));

    act(() => {
      useAppStore.getState().setLastWsCommandResult({ commandId: 'a', ok: true });
      useAppStore.getState().setLastWsCommandResult({
        commandId: 'b',
        ok: false,
        error: { code: 'fail', message: 'nope' },
      });
    });

    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it('passes map metadata via usePendingWsCommandResultMap', () => {
    const pendingRef = { current: new Map([['read-1', '/tmp/foo.ngc']]) };
    const onResult = vi.fn();

    renderHook(() => usePendingWsCommandResultMap(pendingRef, { onResult }));

    act(() => {
      useAppStore.getState().setLastWsCommandResult({
        commandId: 'read-1',
        ok: true,
        result: { content: 'G0', path: '/tmp/foo.ngc' },
      });
    });

    expect(onResult).toHaveBeenCalledWith(
      'read-1',
      '/tmp/foo.ngc',
      expect.objectContaining({ commandId: 'read-1', ok: true }),
    );
  });

  it('runs useWsCommandResultHistoryEffect when history changes', () => {
    const effect = vi.fn();

    renderHook(() => useWsCommandResultHistoryEffect(effect));

    expect(effect).toHaveBeenCalledWith([]);

    act(() => {
      useAppStore.getState().setLastWsCommandResult({ commandId: 'x', ok: true });
    });

    expect(effect).toHaveBeenLastCalledWith([
      expect.objectContaining({ commandId: 'x', ok: true }),
    ]);
  });
});
