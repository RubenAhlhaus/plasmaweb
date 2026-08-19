import { useMemo } from 'react';
import { useAppStore } from '@/store';
import { resolveToolEditUiProfile } from '@/lib/machineToolUiProfile';

/**
 * Machine profile for tool UI (axes from status/INI, lathe geometry from [DISPLAY] LATHE).
 * See `docs/features/05_TOOL_TABLE.md` → dynamic fields.
 */
export function useToolMachineUiProfile() {
  const axisMask = useAppStore((s) => s.linuxCncStatus.machine.axis_mask);
  const trajCoordinatesHint = useAppStore((s) => s.linuxCncStatus.machine.traj_coordinates_hint);
  const trajCoordinatesIni = useAppStore((s) => s.iniRuntimeConfig.traj_coordinates);
  const displayLathe = useAppStore((s) => s.iniRuntimeConfig.display_lathe);

  const trajCoordinatesForUi = trajCoordinatesIni ?? trajCoordinatesHint ?? null;

  return useMemo(
    () =>
      resolveToolEditUiProfile({
        axisMask,
        trajCoordinates: trajCoordinatesForUi,
        displayLathe,
      }),
    [axisMask, trajCoordinatesForUi, displayLathe],
  );
}
