import type { HomingAction, HomingAxis } from '@/api/homingTypes';
import { useSendCommand } from '@/api/backendCommands';
import { useAppStore } from '@/store';
import { TaskMode, TaskState } from '@/store/types';

export function useHomingCommands() {
  const sendCommand = useSendCommand();

  const handleHoming = (axis: HomingAxis, action: HomingAction = 'home') => {
    const linuxCncStatus = useAppStore.getState().linuxCncStatus;
    if (!linuxCncStatus || !linuxCncStatus.machine) {
      return;
    }

    const { machine } = linuxCncStatus;

    const errorFlag = (machine as unknown as { error?: boolean }).error;
    const isError =
      typeof errorFlag === 'boolean'
        ? errorFlag
        : machine.task_state === TaskState.STATE_ESTOP;

    const isManual = machine.task_mode === TaskMode.MODE_MANUAL;

    if (isError || !isManual) {
      return;
    }

    let joint: number;
    switch (axis) {
      case 'all':
        joint = -1;
        break;
      case 'x':
        joint = 0;
        break;
      case 'y':
        joint = 1;
        break;
      case 'z':
        joint = 2;
        break;
      default:
        return;
    }

    sendCommand('motion', action, { joint });
  };

  return { handleHoming };
}
