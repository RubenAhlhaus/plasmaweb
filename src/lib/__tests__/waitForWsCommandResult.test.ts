import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForWsCommandResult } from '@/lib/waitForWsCommandResult';
import { useAppStore } from '@/store';

describe('waitForWsCommandResult', () => {
  afterEach(() => {
    useAppStore.getState().setLastWsCommandResult(null);
    vi.useRealTimers();
  });

  it('resolves when commandResultHistory contains the awaited commandId', async () => {
    const promise = waitForWsCommandResult('exit-1', 5000);

    useAppStore.getState().setLastWsCommandResult({
      commandId: 'exit-1',
      ok: true,
    });

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('resolves with error payload when result is not ok', async () => {
    const promise = waitForWsCommandResult('exit-2', 5000);

    useAppStore.getState().setLastWsCommandResult({
      commandId: 'exit-2',
      ok: false,
      error: { code: 'app_exit', message: 'Rejected' },
    });

    await expect(promise).resolves.toEqual({
      ok: false,
      error: { code: 'app_exit', message: 'Rejected' },
    });
  });

  it('finds the result in history even after a newer unrelated result arrives', async () => {
    useAppStore.getState().setLastWsCommandResult({
      commandId: 'other',
      ok: true,
    });

    const promise = waitForWsCommandResult('target', 5000);

    useAppStore.getState().setLastWsCommandResult({
      commandId: 'target',
      ok: true,
    });

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('rejects on timeout when no matching result arrives', async () => {
    vi.useFakeTimers();

    const promise = waitForWsCommandResult('slow', 100);

    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow('timeout');
  });
});
