import type { Coordinates } from '@/store/types';

/** Default DRO coordinate store flush interval (~15 fps). */
export const DEFAULT_COORDINATE_UI_FLUSH_MS = 66;

/** Allowed range for `ui.coordinateUiFlushMs` in lcncgui-config.json. */
export const MIN_COORDINATE_UI_FLUSH_MS = 16;
export const MAX_COORDINATE_UI_FLUSH_MS = 500;

/** Target max UI refresh rate for DRO coordinates (~15 fps). */
export const COORDINATE_UI_FLUSH_MS = DEFAULT_COORDINATE_UI_FLUSH_MS;

type CommitCoordinates = (coordinates: Coordinates) => void;

export function clampCoordinateUiFlushMs(ms: number): number {
  if (!Number.isFinite(ms)) {
    return DEFAULT_COORDINATE_UI_FLUSH_MS;
  }
  return Math.min(MAX_COORDINATE_UI_FLUSH_MS, Math.max(MIN_COORDINATE_UI_FLUSH_MS, Math.round(ms)));
}

/**
 * Trailing-edge throttle for high-frequency WebSocket coordinate streams.
 * Keeps only the latest snapshot and commits at most once per interval.
 */
export function createCoordinateUpdateBatcher(
  commit: CommitCoordinates,
  intervalMs: number = COORDINATE_UI_FLUSH_MS,
) {
  let pending: Coordinates | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (pending === null) {
      return;
    }
    const next = pending;
    pending = null;
    commit(next);
  };

  return {
    schedule(coordinates: Coordinates) {
      pending = coordinates;
      if (timer === null) {
        timer = setTimeout(flush, intervalMs);
      }
    },
    flushNow() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
