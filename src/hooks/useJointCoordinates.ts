import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store';
import { parseJointCoordinates } from '@/lib/axisJointMap';

/**
 * Axis letter per HAL joint, from the INI runtime config — `['x','y','y','z']` for a gantry.
 *
 * Anything reading `stat.homed` / `stat.joint[]` or issuing a joint-mode motion command needs
 * this, because those are joint-indexed. See `lib/axisJointMap.ts`.
 */
export function useJointCoordinates(): string[] {
  const [kinsKinematics, kinsCoordinates, trajCoordinates] = useAppStore(
    useShallow((s) => [
      s.iniRuntimeConfig.kins_kinematics ?? null,
      s.iniRuntimeConfig.kins_coordinates ?? null,
      s.iniRuntimeConfig.traj_coordinates ?? null,
    ]),
  );

  return useMemo(
    () => parseJointCoordinates({ kinsKinematics, kinsCoordinates, trajCoordinates }),
    [kinsKinematics, kinsCoordinates, trajCoordinates],
  );
}
