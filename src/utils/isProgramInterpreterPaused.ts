import type { LinuxCncStatusRoot } from '@/store/types';
import { InterpState } from '@/store/types';

/** True when the task interpreter is paused (LinuxCNC `INTERP_PAUSED` or explicit `program.paused`). */
export function isProgramInterpreterPaused(status: LinuxCncStatusRoot): boolean {
  const p = status.program;
  if (p.paused === true) {
    return true;
  }
  return p.interp_state === InterpState.INTERP_PAUSED;
}
