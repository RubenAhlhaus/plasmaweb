import type { HomingAction, HomingAxis } from '@/api/homingTypes';
import { useSendCommand } from '@/api/backendCommands';
import { useAppStore } from '@/store';
import { TaskMode, TaskState } from '@/store/types';
import { jointCoordinatesFromIni, primaryJointIndexForAxis } from '@/lib/axisJointMap';

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

    if (axis === 'all') {
      sendCommand('motion', action, { joint: -1 });
      return;
    }

    // Joint index, not axis index: on a gantry (e.g. trivkins coordinates=xyyz) Y owns two
    // joints, which puts Z on joint 3. Homing the first joint of a set is enough — LinuxCNC
    // brings the rest along via their negative HOME_SEQUENCE.
    const jointCoordinates = jointCoordinatesFromIni(useAppStore.getState().iniRuntimeConfig);
    const joint = primaryJointIndexForAxis(jointCoordinates, axis);
    if (joint === null) {
      return;
    }

    sendCommand('motion', action, { joint });
  };

  return { handleHoming };
}
