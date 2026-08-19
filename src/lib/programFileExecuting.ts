import type { LinuxCncStatusRoot } from '@/store/types';
import { InterpState, TaskMode } from '@/store/types';

/**
 * True while a program is actively interpreted in AUTO (running, waiting, paused).
 * Pure IDLE in auto mode allows editing again.
 */
export function isProgramFileExecuting(status: LinuxCncStatusRoot): boolean {
  const taskMode = status.machine?.task_mode;
  const interpState = status.program?.interp_state;
  return (
    taskMode === TaskMode.MODE_AUTO &&
    interpState !== undefined &&
    (interpState === InterpState.INTERP_READING ||
      interpState === InterpState.INTERP_WAITING ||
      interpState === InterpState.INTERP_PAUSED)
  );
}
