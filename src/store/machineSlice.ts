import { clampJogVelocityMmPerMin, jogVelocityLimitsFromIni } from '@/lib/jogVelocity';
import type { StateCreator } from 'zustand';
import type {
  BoundStore,
  Coordinates,
  IniRuntimeConfig,
  LinuxCncStatusRoot,
  ConnectionStatus,
  PendingToolChange,
} from './types';
import { DEFAULT_JOG_INCREMENTS_SPEC } from '@/config/machineIniConfig';
import { coordinatesNearlyEqual } from '@/lib/coordinatesNearlyEqual';

const initialCoordinates: Coordinates = {
  x: 0,
  y: 0,
  z: 0,
  a: 0,
  b: 0,
  c: 0,
  u: 0,
  v: 0,
  w: 0,
};

const initialLinuxCncStatus: LinuxCncStatusRoot = {
  machine: {},
  motion: {},
  io: {},
  program: {},
  overrides: {},
  spindle: [],
  joints: [],
  axes: [],
  tools: {},
};

const INITIAL_CONNECTION_STATUS: ConnectionStatus = 'disconnected';
const initialIniRuntimeConfig: IniRuntimeConfig = {
  jog_increments_spec: DEFAULT_JOG_INCREMENTS_SPEC,
  linear_units: null,
  angular_units: null,
  program_units: null,
  traj_coordinates: null,
  kins_kinematics: null,
  kins_coordinates: null,
  joint_home_sequences: [],
  display_lathe: false,
  default_linear_velocity: null,
  min_linear_velocity: null,
  max_linear_velocity: null,
  max_feed_override: null,
  min_spindle_override: null,
  max_spindle_override: null,
  user_macros: [],
  source: 'default',
  ini_path: null,
};

export const createMachineSlice: StateCreator<
  BoundStore,
  [],
  [],
  import('./types').MachineSlice
> = (set) => ({
  coordinates: initialCoordinates,
  connectionStatus: INITIAL_CONNECTION_STATUS,
  linuxCncStatus: initialLinuxCncStatus,
  iniRuntimeConfig: initialIniRuntimeConfig,
  backendWebSocketUrl: null,
  backendWebSocket: null,
  pendingToolChange: null,
  setBackendWebSocketUrl: (url) => set({ backendWebSocketUrl: url }),
  setCoordinates: (coordinates) =>
    set((state) =>
      coordinatesNearlyEqual(state.coordinates, coordinates) ? state : { coordinates },
    ),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLinuxCncStatus: (partial) =>
    set((state) => ({
      linuxCncStatus: {
        ...state.linuxCncStatus,
        ...partial,
        machine: {
          ...state.linuxCncStatus.machine,
          ...partial.machine,
        },
        motion: {
          ...state.linuxCncStatus.motion,
          ...partial.motion,
        },
        io: {
          ...state.linuxCncStatus.io,
          ...partial.io,
        },
        // Full snapshot always includes `program`; replace wholesale so gcodes/mcodes arrays
        // never keep stale references if merge order / partial keys ever diverge.
        program:
          partial.program !== undefined && partial.program !== null
            ? { ...partial.program }
            : { ...state.linuxCncStatus.program },
        overrides: {
          ...state.linuxCncStatus.overrides,
          ...partial.overrides,
        },
        spindle: partial.spindle ?? state.linuxCncStatus.spindle,
        joints: partial.joints ?? state.linuxCncStatus.joints,
        axes: partial.axes ?? state.linuxCncStatus.axes,
        tools: {
          ...state.linuxCncStatus.tools,
          ...partial.tools,
        },
      },
    })),
  setIniRuntimeConfig: (partial) =>
    set((state) => {
      const iniRuntimeConfig = { ...state.iniRuntimeConfig, ...partial };
      // The jog speed follows the INI: an operator still on the old default moves to the new
      // one, and any other speed is pulled inside the new range.
      const previous = jogVelocityLimitsFromIni(state.iniRuntimeConfig);
      const next = jogVelocityLimitsFromIni(iniRuntimeConfig);
      const jogVelocityMmPerMin =
        state.jogVelocityMmPerMin === previous.default
          ? next.default
          : clampJogVelocityMmPerMin(state.jogVelocityMmPerMin, next);
      return { iniRuntimeConfig, jogVelocityMmPerMin };
    }),
  setBackendWebSocket: (ws) => set({ backendWebSocket: ws }),
  setPendingToolChange: (value: PendingToolChange | null) =>
    set({ pendingToolChange: value }),
});
