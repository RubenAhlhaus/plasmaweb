import { findLatestCommandResultForId } from '@/lib/wsCommandResults';
import { useAppStore } from '@/store';

export interface WaitForWsCommandResultOutcome {
  ok: boolean;
  error?: { code: string; message: string };
}

/**
 * Resolves when `commandResultHistory` contains a result for `commandId`
 * (same WebSocket connection). Rejects on timeout.
 */
export function waitForWsCommandResult(
  commandId: string,
  timeoutMs = 10_000,
): Promise<WaitForWsCommandResultOutcome> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let settled = false;

    const finish = (r: WaitForWsCommandResultOutcome) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe?.();
      resolve(r);
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      reject(new Error('timeout'));
    }, timeoutMs);

    const check = (state: ReturnType<typeof useAppStore.getState>) => {
      const r = findLatestCommandResultForId(state.commandResultHistory, commandId);
      if (!r) return;
      finish({ ok: r.ok, error: r.error });
    };

    unsubscribe = useAppStore.subscribe(check);
    check(useAppStore.getState());
  });
}
