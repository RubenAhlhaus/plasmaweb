/**
 * Schedules work so rapid updates keep only the latest value,
 * then flush once after `delayMs` of quiet time.
 */
export function createLatestWinsScheduler<T>(
  delayMs: number,
  flush: (value: T) => void,
): {
  schedule: (value: T) => void;
  dispose: () => void;
} {
  let pending: T | null = null;
  let hasPending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(value: T) {
      pending = value;
      hasPending = true;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (!hasPending) return;
        const next = pending;
        pending = null;
        hasPending = false;
        flush(next as T);
      }, delayMs);
    },
    dispose() {
      clearTimer();
      pending = null;
      hasPending = false;
    },
  };
}
