import type {
  Coordinates,
  LinuxCncStatusRoot,
  ConnectionStatus,
  IniRuntimeConfig,
} from '@/store/types';
import { TaskState } from '@/store/types';

const AXIS_INDEX_MAP: Record<keyof Coordinates, number> = {
  x: 0,
  y: 1,
  z: 2,
  a: 3,
  b: 4,
  c: 5,
  u: 6,
  v: 7,
  w: 8,
};

export interface LinuxCncStatusMessage {
  type: 'linuxcnc_status';
  // `coordinate_systems` is part of `LinuxCncStatusRoot` (optional, backend-prepared).
  payload: Partial<LinuxCncStatusRoot>;
}

export interface ErrorMessage {
  type: 'error';
  error: string;
  message?: string;
}

export interface MachineEventMessage {
  type: 'machine_event';
  protocolVersion?: 1;
  event: string;
  payload: Record<string, unknown>;
}

// Declared as a `type` (not `interface`) so it is assignable to `Record<string, unknown>`,
// which keeps the more specific event-message types assignable to `MachineEventMessage`.
export type MotionCoordinatesChangedEventPayload = {
  coordinates?: Partial<Coordinates>;
};

export interface MotionCoordinatesChangedEventMessage {
  type: 'machine_event';
  protocolVersion?: 1;
  event: 'motion.coordinates.changed';
  payload: MotionCoordinatesChangedEventPayload;
}

export type MachineIniConfigLoadedEventPayload = {
  jog_increments_spec?: string;
  linear_units?: string | null;
  angular_units?: string | null;
  program_units?: number | null;
  traj_coordinates?: string | null;
  kins_kinematics?: string | null;
  kins_coordinates?: string | null;
  joint_home_sequences?: unknown;
  display_lathe?: boolean;
  user_macros?: Array<{ name?: string; fileName?: string; path?: string }>;
  source?: string;
  ini_path?: string | null;
  loaded_at?: string;
};

export interface MachineIniConfigLoadedEventMessage {
  type: 'machine_event';
  protocolVersion?: 1;
  event: 'machine.ini_config.loaded';
  payload: MachineIniConfigLoadedEventPayload;
}

export interface ToolChangeRequestedEventPayload {
  tool_number: number;
  description?: string;
}

export interface ToolChangeRequestedEventMessage {
  type: 'machine_event';
  protocolVersion?: 1;
  event: 'machine.tool_change.requested';
  payload: ToolChangeRequestedEventPayload;
}

export interface PanelSidebarTriggerEventPayload {
  buttonId: number;
}

export interface PanelSidebarTriggerEventMessage {
  type: 'machine_event';
  protocolVersion?: 1;
  event: 'panel.sidebar.trigger';
  payload: PanelSidebarTriggerEventPayload;
}

/** Immediate ACK for async commands (e.g. motion.home); final result: command_completion */
export interface CommandResultMessage {
  type: 'command_result';
  protocolVersion?: 1;
  commandId: string;
  ok: boolean;
  category?: string;
  action?: string;
  asyncPending?: boolean;
  error?: { code: string; message: string };
  result?: Record<string, unknown>;
}

/** Completion of an async command (same commandId as the sent command) */
export interface CommandCompletionMessage {
  type: 'command_completion';
  protocolVersion?: 1;
  commandId: string;
  category: string;
  action: string;
  ok: boolean;
  error?: { code: string; message: string };
}

/** Ad hoc LinuxCNC error/text (error_channel), with no related command */
export interface LinuxCncErrorWsMessage {
  type: 'linuxcnc_error';
  protocolVersion?: 1;
  kind: string;
  message: string;
}

export type BackendMessage =
  | LinuxCncStatusMessage
  | MachineEventMessage
  | ErrorMessage
  | CommandResultMessage
  | CommandCompletionMessage
  | LinuxCncErrorWsMessage;

export interface StoreSnapshot {
  linuxCncStatus: LinuxCncStatusRoot;
  coordinates: Coordinates;
}

interface StoreUpdates {
  linuxCncStatusPartial?: Partial<LinuxCncStatusRoot>;
  coordinatesUpdate?: Coordinates;
  connectionStatus?: ConnectionStatus;
}

export function isLinuxCncStatusMessage(msg: BackendMessage): msg is LinuxCncStatusMessage {
  return msg.type === 'linuxcnc_status' && !!msg.payload;
}

export function isMotionCoordinatesChangedEventMessage(
  msg: BackendMessage,
): msg is MotionCoordinatesChangedEventMessage {
  return (
    msg.type === 'machine_event' &&
    msg.event === 'motion.coordinates.changed' &&
    typeof msg.payload === 'object' &&
    !!msg.payload
  );
}

export function isMachineIniConfigLoadedEventMessage(
  msg: BackendMessage,
): msg is MachineIniConfigLoadedEventMessage {
  return (
    msg.type === 'machine_event' &&
    msg.event === 'machine.ini_config.loaded' &&
    typeof msg.payload === 'object' &&
    !!msg.payload
  );
}

export function isToolChangeRequestedEventMessage(
  msg: BackendMessage,
): msg is ToolChangeRequestedEventMessage {
  return (
    msg.type === 'machine_event' &&
    msg.event === 'machine.tool_change.requested' &&
    typeof msg.payload === 'object' &&
    !!msg.payload &&
    typeof msg.payload.tool_number === 'number'
  );
}

export function isPanelSidebarTriggerEventMessage(
  msg: BackendMessage,
): msg is PanelSidebarTriggerEventMessage {
  return (
    msg.type === 'machine_event' &&
    msg.event === 'panel.sidebar.trigger' &&
    typeof msg.payload === 'object' &&
    !!msg.payload &&
    typeof msg.payload.buttonId === 'number'
  );
}

export function mapStatusMessageToStoreUpdates(
  msg: LinuxCncStatusMessage,
  snapshot: StoreSnapshot,
): StoreUpdates {
  const { linuxCncStatus, coordinates } = snapshot;
  const incomingStatus = msg.payload;
  const mappedStatus: Partial<LinuxCncStatusRoot> = { ...incomingStatus };

  if (incomingStatus.machine) {
    mappedStatus.machine = {
      ...incomingStatus.machine,
      ...(typeof incomingStatus.machine.task_state === 'number' && {
        task_state: incomingStatus.machine.task_state as TaskState,
      }),
    };
  }

  const motion = incomingStatus.motion ?? linuxCncStatus.motion;
  const actualPosition = motion.actual_position;

  // Optional: backend-prepared coordinate system list with offsets
  const coordinateSystems =
    incomingStatus.coordinate_systems ?? linuxCncStatus.coordinate_systems;

  type AxisKey = keyof Coordinates;

  let activeOffsets: Partial<Coordinates> = {};
  // Primary source: raw motion offsets (active system) from the status snapshot.
  // More robust than a coordinate_systems list that may arrive late.
  const g5xOffset = (motion.g5x_offset ?? []) as number[];
  const g92Offset = (motion.g92_offset ?? []) as number[];
  const toolOffsetArr = (motion.tool_offset ?? []) as number[];
  const hasRawMotionOffsets =
    Array.isArray(g5xOffset) &&
    Array.isArray(g92Offset) &&
    g5xOffset.length >= 9 &&
    g92Offset.length >= 9;
  const hasToolOffsetMotion = Array.isArray(toolOffsetArr) && toolOffsetArr.length >= 9;

  if (hasRawMotionOffsets) {
    const result: Partial<Coordinates> = {};
    (Object.keys(AXIS_INDEX_MAP) as AxisKey[]).forEach((axis) => {
      const idx = AXIS_INDEX_MAP[axis];
      const g5 = g5xOffset[idx];
      const g92 = g92Offset[idx];
      if (typeof g5 === 'number' && typeof g92 === 'number') {
        result[axis] = g5 + g92;
      }
    });
    activeOffsets = result;
  }

  // Fallback: backend-prepared list when motion offsets are not usable.
  if (Array.isArray(coordinateSystems)) {
    const active = coordinateSystems.find((cs) => Boolean(cs?.is_active));
    if (!hasRawMotionOffsets && active && active.offsets) {
      const rawOffsets = active.offsets;
      const result: Partial<Coordinates> = {};
      (Object.keys(rawOffsets) as AxisKey[]).forEach((axis) => {
        const v = rawOffsets[axis];
        if (typeof v === 'number') {
          result[axis] = v;
        }
      });
      activeOffsets = result;
    }
  }

  const toolPart = (axis: AxisKey): number => {
    if (!hasToolOffsetMotion) return 0;
    const idx = AXIS_INDEX_MAP[axis];
    const v = toolOffsetArr[idx];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };

  let coordinatesUpdate: Coordinates | undefined;
  if (actualPosition && actualPosition.length > 0) {
    const [mx, my, mz, ma, mb, mc, mu, mv, mw] = actualPosition;

    // Display coordinates = machine position - G5x/G92 - tool_offset (LinuxCNC DRO / Gmoccapy style)
    const off = activeOffsets;

    coordinatesUpdate = {
      ...coordinates,
      ...(mx !== undefined && { x: mx - (off.x ?? 0) - toolPart('x') }),
      ...(my !== undefined && { y: my - (off.y ?? 0) - toolPart('y') }),
      ...(mz !== undefined && { z: mz - (off.z ?? 0) - toolPart('z') }),
      ...(ma !== undefined && { a: ma - (off.a ?? 0) - toolPart('a') }),
      ...(mb !== undefined && { b: mb - (off.b ?? 0) - toolPart('b') }),
      ...(mc !== undefined && { c: mc - (off.c ?? 0) - toolPart('c') }),
      ...(mu !== undefined && { u: mu - (off.u ?? 0) - toolPart('u') }),
      ...(mv !== undefined && { v: mv - (off.v ?? 0) - toolPart('v') }),
      ...(mw !== undefined && { w: mw - (off.w ?? 0) - toolPart('w') }),
    };
  }

  return {
    linuxCncStatusPartial: mappedStatus,
    coordinatesUpdate,
    connectionStatus: 'connected',
  };
}

export function mapCoordinatesChangedEventToStoreUpdates(
  msg: MotionCoordinatesChangedEventMessage,
  snapshot: StoreSnapshot,
): StoreUpdates {
  const incoming = msg.payload?.coordinates;
  if (!incoming || typeof incoming !== 'object') return {};

  // Defensive: sanitize incoming coordinates from high-frequency stream.
  // We only accept finite numbers; NaN/Infinity (or non-numbers) must not
  // poison the zustand state.
  const sanitized: Partial<Coordinates> = {};
  (Object.keys(snapshot.coordinates) as Array<keyof Coordinates>).forEach((axis) => {
    const v = incoming[axis];
    if (typeof v === 'number' && Number.isFinite(v)) {
      sanitized[axis] = v;
    }
  });

  const coordinatesUpdate: Coordinates = {
    ...snapshot.coordinates,
    ...sanitized,
  };

  return {
    coordinatesUpdate,
  };
}

export function mapIniConfigLoadedEventToStoreUpdates(
  msg: MachineIniConfigLoadedEventMessage,
  current: IniRuntimeConfig,
): Partial<IniRuntimeConfig> {
  const payload = msg.payload ?? {};

  const traj =
    typeof payload.traj_coordinates === 'string' && payload.traj_coordinates.trim().length > 0
      ? payload.traj_coordinates.trim()
      : null;

  const userMacros = Array.isArray(payload.user_macros)
    ? payload.user_macros
        .filter(
          (m): m is { name: string; fileName: string; path?: string } =>
            !!m &&
            typeof m.name === 'string' &&
            m.name.trim().length > 0 &&
            typeof m.fileName === 'string' &&
            m.fileName.trim().length > 0,
        )
        .map((m) => ({
          name: m.name.trim(),
          fileName: m.fileName.trim(),
          ...(typeof m.path === 'string' && m.path.trim() ? { path: m.path.trim() } : {}),
        }))
    : [];

  const homeSequences = Array.isArray(payload.joint_home_sequences)
    ? payload.joint_home_sequences
        .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
        .map((v) => String(v).trim())
    : [];

  return {
    jog_increments_spec:
      typeof payload.jog_increments_spec === 'string' && payload.jog_increments_spec.trim().length > 0
        ? payload.jog_increments_spec
        : current.jog_increments_spec,
    linear_units: typeof payload.linear_units === 'string' ? payload.linear_units : null,
    angular_units: typeof payload.angular_units === 'string' ? payload.angular_units : null,
    program_units: typeof payload.program_units === 'number' ? payload.program_units : null,
    traj_coordinates: traj,
    kins_kinematics:
      typeof payload.kins_kinematics === 'string' && payload.kins_kinematics.trim()
        ? payload.kins_kinematics.trim()
        : null,
    kins_coordinates:
      typeof payload.kins_coordinates === 'string' && payload.kins_coordinates.trim()
        ? payload.kins_coordinates.trim()
        : null,
    joint_home_sequences: homeSequences,
    display_lathe: typeof payload.display_lathe === 'boolean' ? payload.display_lathe : false,
    user_macros: userMacros,
    source: typeof payload.source === 'string' ? payload.source : current.source,
    ini_path: typeof payload.ini_path === 'string' ? payload.ini_path : null,
    loaded_at: typeof payload.loaded_at === 'string' ? payload.loaded_at : current.loaded_at,
  };
}

