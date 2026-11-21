import { useEffect, useState } from "react";
import { fetchUpdateInfo } from "@/lib/updateApi";

const POLL_INTERVAL_MS = 2000;
/** LinuxCNC on a Pi takes 20-40 s to come back; well past that, something went wrong. */
export const RESTART_TIMEOUT_MS = 180_000;

/**
 * While `active`, waits for LinuxCNC to come back from a restart and reloads the page once the
 * backend answers with `expectedVersion` (or, when that is null, once it answers again after
 * having gone away). Reloading earlier would load the new UI against the old backend.
 *
 * Returns whether it gave up waiting.
 */
export function useReloadWhenRestarted(
  active: boolean,
  expectedVersion: string | null,
): boolean {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!active) return;
    setTimedOut(false);
    let wentAway = false;
    let stopped = false;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > RESTART_TIMEOUT_MS) {
        window.clearInterval(timer);
        setTimedOut(true);
        return;
      }
      void fetchUpdateInfo().then((info) => {
        if (stopped) return;
        if (info === null) {
          wentAway = true;
          return;
        }
        const back =
          expectedVersion !== null
            ? info.runningVersion === expectedVersion
            : wentAway;
        if (back) {
          stopped = true;
          window.clearInterval(timer);
          window.location.reload();
        }
      });
    }, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, expectedVersion]);

  return timedOut;
}
