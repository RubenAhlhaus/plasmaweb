import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { RESTART_TIMEOUT_MS, useReloadWhenRestarted } from '../useReloadWhenRestarted';

const fetchUpdateInfo = vi.fn();
vi.mock('@/lib/updateApi', () => ({ fetchUpdateInfo: () => fetchUpdateInfo() }));

const reload = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchUpdateInfo.mockReset();
  reload.mockReset();
  vi.stubGlobal('location', { ...window.location, reload });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useReloadWhenRestarted', () => {
  it('reloads once the backend answers with the new version, not before', async () => {
    fetchUpdateInfo
      .mockResolvedValueOnce({ runningVersion: '1.1.8' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ runningVersion: '1.1.9' });
    renderHook(() => useReloadWhenRestarted(true, '1.1.9'));

    await tick(2000);
    await tick(2000);
    expect(reload).not.toHaveBeenCalled();
    await tick(2000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('without a version, reloads once the backend is back after going away', async () => {
    fetchUpdateInfo
      .mockResolvedValueOnce({ runningVersion: '1.1.8' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ runningVersion: '1.1.8' });
    renderHook(() => useReloadWhenRestarted(true, null));

    await tick(4000);
    expect(reload).not.toHaveBeenCalled();
    await tick(2000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('gives up after the timeout', async () => {
    fetchUpdateInfo.mockResolvedValue(null);
    const { result } = renderHook(() => useReloadWhenRestarted(true, '1.1.9'));

    await tick(RESTART_TIMEOUT_MS + 4000);

    expect(result.current).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing while inactive', async () => {
    renderHook(() => useReloadWhenRestarted(false, '1.1.9'));

    await tick(10_000);

    expect(fetchUpdateInfo).not.toHaveBeenCalled();
  });
});
