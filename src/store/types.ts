import type { MacroQueueProgramSetup } from '@/types/macroQueueSetup';
import type { QueueItem } from '@/types/macros';
import type { OverridePresetHotkeysMap } from '@/lib/overridePresetHotkeys';
import type { VirtualSidebarHotkeysMap } from '@/lib/virtualSidebarHotkeys';
import type { HalSoftkeyStatusKey } from '@/lib/virtualSidebarButtons';

/** Machine coordinates (e.g. from LinuxCNC) — all axes kept for future compatibility */
export interface Coordinates {
  x: number;
  y: number;
  z: number;
  a: number;
  b: number;
  c: number;
  u: number;
  v: number;
  w: number;
}

/** Connection state to the LinuxCNC instance */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/** Numeric enum values from linuxcnc.stat for task / interpreter / motion status, etc. */
export enum TaskState {
  STATE_ESTOP = 1,
  STATE_ESTOP_RESET = 2,
  // linuxcnc: EMC_TASK_STATE: OFF=3, ON=4
  STATE_OFF = 3,
  STATE_ON = 4,
}

export enum TaskMode {
  MODE_MANUAL = 1,
  MODE_AUTO = 2,
  MODE_MDI = 3,
}

export enum ExecState {
  EXEC_ERROR = 1,
  EXEC_DONE = 2,
  EXEC_WAITING_FOR_MOTION = 3,
  EXEC_WAITING_FOR_MOTION_QUEUE = 4,
  EXEC_WAITING_FOR_IO = 5,
  EXEC_WAITING_FOR_MOTION_AND_IO = 6,
  EXEC_WAITING_FOR_DELAY = 7,
  EXEC_WAITING_FOR_SYSTEM_CMD = 8,
  EXEC_WAITING_FOR_SPINDLE_ORIENTED = 9,
}

export enum InterpState {
  INTERP_IDLE = 1,
  INTERP_READING = 2,
  INTERP_PAUSED = 3,
  INTERP_WAITING = 4,
}

export enum InterpReturnCode {
  INTERP_OK = 1,
  INTERP_EXIT = 2,
  INTERP_EXECUTE_FINISH = 3,
  INTERP_ENDFILE = 4,
  INTERP_FILE_NOT_OPEN = 5,
  INTERP_ERROR = 6,
}

export enum MotionMode {
  TRAJ_MODE_COORD = 1,
  TRAJ_MODE_FREE = 2,
  TRAJ_MODE_TELEOP = 3,
}

export enum MotionType {
  MOTION_TYPE_NONE = 0,
  MOTION_TYPE_TRAVERSE = 1,
  MOTION_TYPE_FEED = 2,
  MOTION_TYPE_ARC = 3,
  MOTION_TYPE_TOOLCHANGE = 4,
  MOTION_TYPE_PROBING = 5,
  MOTION_TYPE_INDEXROTARY = 6,
}

export enum KinematicsType {
  KINEMATICS_IDENTITY = 1,
  KINEMATICS_FORWARD_ONLY = 2,
  KINEMATICS_INVERSE_ONLY = 3,
  KINEMATICS_BOTH = 4,
}

export enum ProgramUnits {
  CANON_UNITS_INCHES = 1,
  CANON_UNITS_MM = 2,
  CANON_UNITS_CM = 3,
}

/** Axis status per axis dictionary */
export interface LinuxCncAxisStatus {
  max_position_limit?: number;
  min_position_limit?: number;
  velocity?: number;
}

/** Joint status per joint dictionary */
export interface LinuxCncJointStatus {
  backlash?: number;
  enabled?: number;
  fault?: number;
  ferror_current?: number;
  ferror_highmark?: number;
  homed?: number;
  homing?: number;
  inpos?: number;
  input?: number;
  jointType?: number;
  max_ferror?: number;
  max_hard_limit?: number;
  max_position_limit?: number;
  max_soft_limit?: number;
  min_ferror?: number;
  min_hard_limit?: number;
  min_position_limit?: number;
  min_soft_limit?: number;
  output?: number;
  override_limits?: number;
  units?: number;
  velocity?: number;
}

/** Spindle status per spindle dictionary */
export interface LinuxCncSpindleStatus {
  brake?: number;
  direction?: number;
  enabled?: number;
  increasing?: number;
  orient_fault?: number;
  orient_state?: number;
  override?: number;
  override_enabled?: boolean;
  speed?: number;
}

export interface LinuxCncMachineStatus {
  state?: number;
  estop?: number;
  /** Hardware/input E-stop per linuxcnc.stat.estop (backend field `error` in snapshot). */
  error?: boolean;
  powerOn?: boolean;
  enabled?: boolean;
  task_state?: TaskState;
  task_mode?: TaskMode;
  task_paused?: number;
  kinematics_type?: KinematicsType;
  program_units?: ProgramUnits;
  linear_units?: number;
  angular_units?: number;
  joints?: number;
  spindles?: number;
  /** linuxcnc.stat.axis_mask; null if unavailable (JSON from backend). */
  axis_mask?: number | null;
  /** From INI [TRAJ] COORDINATES in snapshot, only when axis_mask is missing (tool UI fallback). */
  traj_coordinates_hint?: string | null;
  debug?: number;
  ini_filename?: string;
  heartbeat?: number;
  taskbeat?: number;
}

export interface LinuxCncMotionStatus {
  acceleration?: number;
  active_queue?: number;
  actual_position?: number[]; // machine units
  position?: number[];
  joint_position?: number[];
  joint_actual_position?: number[];
  distance_to_go?: number;
  dtg?: number[];
  current_vel?: number;
  velocity?: number;
  max_acceleration?: number;
  max_velocity?: number;
  motion_type?: MotionType;
  motion_mode?: MotionMode;
  queue?: number;
  queue_full?: boolean;
  rotation_xy?: number;
  g5x_index?: number;
  g5x_offset?: number[];
  g92_offset?: number[];
  /** Current tool offset (linuxcnc.stat.tool_offset), axes x..w — for DRO including G43 */
  tool_offset?: number[];
  homed?: number[];
  inpos?: boolean;
  limit?: number[];
  probe_tripped?: boolean;
  probe_val?: number;
  probed_position?: number[];
  probing?: boolean;
}

export type { HalSoftkeyStatusKey };

export interface LinuxCncIOStatus {
  din?: number[];
  dout?: number[];
  ain?: number[];
  aout?: number[];
  flood?: number;
  mist?: number;
  /** HAL feedback for custom sidebar softkeys 14–16 (1 = active; missing key = unreadable/off). */
  hal_softkeys?: Partial<Record<HalSoftkeyStatusKey, number>>;
  block_delete?: boolean;
  optional_stop?: number;
  input_timeout?: boolean;
}

export interface LinuxCncProgramStatus {
  file?: string;
  command?: string;
  current_line?: number;
  read_line?: number;
  motion_line?: number;
  id?: number;
  exec_state?: ExecState;
  interp_state?: InterpState;
  interpreter_errcode?: InterpReturnCode;
  gcodes?: number[];
  mcodes?: number[];
  settings?: number[];
  call_level?: number;
  delay_left?: number;
  cycle_time?: number;
  echo_serial_number?: number;
  paused?: boolean;
  single_stepping?: boolean;
  feed_override_enabled?: boolean;
  adaptive_feed_enabled?: boolean;
}

export interface LinuxCncOverridesStatus {
  feedrate?: number;
  rapidrate?: number;
}

/** One row from `linuxcnc.stat.tool_table` (backend JSON snapshot). */
export interface LinuxCncToolTableRow {
  toolno?: number;
  id?: number;
  /** Some LinuxCNC builds expose only this; backend also normalizes to `pocket`. */
  pocketno?: number;
  pocket?: number;
  diameter?: number;
  xoffset?: number;
  yoffset?: number;
  zoffset?: number;
  aoffset?: number;
  boffset?: number;
  coffset?: number;
  uoffset?: number;
  voffset?: number;
  woffset?: number;
  frontangle?: number;
  backangle?: number;
  orientation?: number;
  comment?: string;
  /** lcncgui sidecar: library meta per T (source of truth alongside .tbl). */
  lcncgui_meta?: Record<string, unknown>;
  lcncgui_presets?: unknown[];
}

export interface LinuxCncToolStatus {
  tool_in_spindle?: number;
  pocket_prepped?: number;
  tool_from_pocket?: number;
  /**
   * Reserved / currently unused in the WebSocket snapshot. Active axis offsets for the DRO
   * (same as `linuxcnc.stat.tool_offset`) live under `LinuxCncMotionStatus.tool_offset`.
   */
  tool_offset?: number[];
  tool_table?: LinuxCncToolTableRow[];
}

export interface ErrorToastItem {
  id: string;
  message: string;
  kind?: string;
  /** Default `error` — `info` for neutral notices (e.g. delayed LinuxCNC reload). */
  tone?: 'error' | 'info';
}

/**
 * Backend-prepared coordinate system entry (offsets per axis) — optional and not part of the
 * raw `linuxcnc.stat` tree. Populated by `backend/coordinate_systems.list_coordinate_systems`.
 */
export interface CoordinateSystemSnapshot {
  id?: string;
  label?: string;
  is_active?: boolean;
  offsets?: Record<string, number>;
}

export interface LinuxCncStatusRoot {
  /** Raw coordinates from linuxcnc.stat (e.g. actual_position) — in addition to convenience `coordinates` in the slice */
  machine: LinuxCncMachineStatus;
  motion: LinuxCncMotionStatus;
  io: LinuxCncIOStatus;
  program: LinuxCncProgramStatus;
  overrides: LinuxCncOverridesStatus;
  spindle: LinuxCncSpindleStatus[];
  joints: LinuxCncJointStatus[];
  axes: LinuxCncAxisStatus[];
  tools: LinuxCncToolStatus;
  /**
   * Optional backend-prepared coordinate system list with offsets. Not emitted by raw
   * `linuxcnc.stat`; arrives alongside the status snapshot when the backend computes it.
   */
  coordinate_systems?: CoordinateSystemSnapshot[];
}

export interface IniRuntimeConfig {
  jog_increments_spec: string;
  linear_units?: string | null;
  angular_units?: string | null;
  program_units?: ProgramUnits | number | null;
  /** Raw string from INI [TRAJ] COORDINATES, e.g. "X Y Z" — tool UI fallback when no axis_mask. */
  traj_coordinates?: string | null;
  /**
   * Raw INI [KINS] KINEMATICS, e.g. "trivkins coordinates=xyyz". Authoritative source for
   * axis→joint mapping (see lib/axisJointMap.ts); [TRAJ] COORDINATES lists axes, not joints.
   */
  kins_kinematics?: string | null;
  /** Raw INI [KINS] COORDINATES — used when KINEMATICS carries no `coordinates=` token. */
  kins_coordinates?: string | null;
  /**
   * INI [JOINT_n] HOME_SEQUENCE, joint index = array position. A negative value means the
   * joint homes as a synchronised set (gantry), which forbids joint-mode jogging of it.
   */
  joint_home_sequences?: string[];
  /** From INI [DISPLAY] LATHE — controls lathe-specific tool fields. */
  display_lathe?: boolean;
  /**
   * User macros from INI `[MACROS]` that resolve under `SUBROUTINE_PATH`
   * (Macros screen “Machine” tiles). From `machine.ini_config.loaded`.
   */
  user_macros?: Array<{ name: string; fileName: string; path?: string }>;
  source?: string;
  ini_path?: string | null;
  loaded_at?: string;
}

/** Latest WebSocket `command_result` (for UI that must correlate by commandId, e.g. program.open). */
export type LastWsCommandResult = {
  commandId: string;
  ok: boolean;
  /** Set by backend — e.g. `program` for local error display without toast */
  category?: string;
  action?: string;
  error?: { code: string; message: string; path?: string };
  /** Success payload (e.g. `program.list` / `program.read` / `program.write`) */
  result?: Record<string, unknown>;
};

/** Program editor (Program screen) in the app store; details: `docs/features/06_PROGRAM_SCREEN.md`. */
export type ProgramEditorState = {
  content: string;
  filePath: string | null;
  currentLineIndex: number | null;
  runFromLineInput: string;
  /**
   * Next `startLine` for `program.auto` / `run` on Cycle Start (0 = from start of file).
   * Reset to 0 after a sent `run`.
   */
  pendingAutoRunStartLine: number;
  /** `program.open` / `program.read` (auto + manual reload); see `docs/features/06_PROGRAM_SCREEN.md`. */
  openError: string | null;
  writeError: string | null;
};

export interface UISlice {
  activeMenuIndex: number;
  setActiveMenuIndex: (index: number) => void;
  /** Visibility of the virtual left button sidebar */
  showVirtualSidebar: boolean;
  /** Config/bootstrap only — use `setShowVirtualSidebarPreference` from settings UI. */
  setShowVirtualSidebar: (show: boolean) => void;
  /** Hotkeys for virtual sidebar buttons (persisted in localStorage). */
  virtualSidebarHotkeys: VirtualSidebarHotkeysMap;
  /** Hotkeys for feed override rotary presets 0–15 (localStorage). */
  feedOverrideHotkeys: OverridePresetHotkeysMap;
  /** Hotkeys for spindle override rotary presets 0–15 (localStorage). */
  spindleOverrideHotkeys: OverridePresetHotkeysMap;
  /** Launch in kiosk/fullscreen vs normal window (effective after restart) */
  kioskMode: boolean;
  setKioskMode: (kiosk: boolean) => void;
  /** True when GET /api/user-preferences failed at bootstrap (Settings shows config fallback). */
  userPreferencesLoadFailed: boolean;
  setUserPreferencesLoadFailed: (failed: boolean) => void;
  /** Start LinuxCNC at graphical session login (XDG autostart). */
  runLinuxCncAtStartup: boolean;
  setRunLinuxCncAtStartup: (enabled: boolean) => void;
  /** INI path stored for autostart (from user preferences). */
  linuxCncIniPath: string | null;
  setLinuxCncIniPath: (path: string | null) => void;
  /** Last tool-in-spindle number persisted for restore after homing (gmoccapy-style). */
  toolInSpindlePreference: number;
  setToolInSpindlePreference: (toolNumber: number) => void;
  /** When true, restore last tool via M61 after axes are homed. */
  reloadToolOnStartup: boolean;
  setReloadToolOnStartup: (enabled: boolean) => void;
  /** Current jog mode: incremental jogs vs continuous jog */
  jogMode: 'incremental' | 'continuous';
  setJogMode: (mode: 'incremental' | 'continuous') => void;
  /** Selected jog increment in machine units (e.g. mm) */
  selectedJogIncrement: number;
  setSelectedJogIncrement: (value: number) => void;
  /** Jog button speed in mm/min (session-local; same unit as `motion.jog` velocity) */
  jogVelocityMmPerMin: number;
  setJogVelocityMmPerMin: (value: number) => void;
  /** Enables debug logging for event bus and WebSocket messages (session-local only) */
  debugLoggingEnabled: boolean;
  setDebugLoggingEnabled: (enabled: boolean) => void;
  /** Finer debug logging: log frontend event-bus events */
  debugLogEventBus: boolean;
  setDebugLogEventBus: (enabled: boolean) => void;
  /** Finer debug logging: log outgoing WebSocket messages */
  debugLogWsOutgoing: boolean;
  setDebugLogWsOutgoing: (enabled: boolean) => void;
  /** Finer debug logging: log incoming WebSocket messages */
  debugLogWsIncoming: boolean;
  setDebugLogWsIncoming: (enabled: boolean) => void;
  /** DRO coordinate store flush interval (ms); from `lcncgui-config.json` */
  coordinateUiFlushMs: number;
  setCoordinateUiFlushMs: (ms: number) => void;

  /** Latest `command_result` from backend (broadcast; consumers filter by commandId) */
  lastWsCommandResult: LastWsCommandResult | null;
  /**
   * Chronological sequence of recent `command_result` messages (ring, max 64).
   * Allows correlation when several commands finish in quick succession.
   */
  commandResultHistory: LastWsCommandResult[];
  setLastWsCommandResult: (result: LastWsCommandResult | null) => void;

  /**
   * Sent MDI lines (home MDI console), chronological; ring capped by
   * `MAX_MDI_COMMAND_HISTORY` in `src/store/mdiHistoryConstants.ts`.
   * Persists for the app session across screen changes.
   */
  mdiCommandHistory: string[];
  /** Expects an already trimmed, non-empty line (see `MDIConsole`). */
  appendMdiCommandHistory: (trimmedCommand: string) => void;

  /** Backend errors as toast stack (dismiss with X) */
  errorToasts: ErrorToastItem[];
  showErrorToast: (toast: Omit<ErrorToastItem, 'id'>) => void;
  dismissErrorToast: (id: string) => void;
  clearErrorToasts: () => void;
  /** Tracks axes for which the unhomed jog hint dialog was already shown (per homing cycle) */
  shownUnhomedJogDialogAxes: Record<string, boolean>;
  setUnhomedJogDialogShownForAxis: (axis: string) => void;
  resetUnhomedJogDialogForAxis: (axis: string) => void;

  programEditor: ProgramEditorState;
  setProgramEditor: (partial: Partial<ProgramEditorState>) => void;
  /**
   * Clears editor, paths, error banners, next Cycle Start (`pendingAutoRunStartLine`), the
   * macro queue (`macroQueueItems`), and the macro program header (`macroQueueProgramSetup`).
   * Debug / manual reset.
   */
  resetProgramEditor: () => void;

  /**
   * Programmkopf für die Makro-Warteschlange (Koordinatensystem, Einheiten); feste Karte,
   * nicht in `macroQueueItems`. Wird mit `resetProgramEditor` zurückgesetzt.
   */
  macroQueueProgramSetup: MacroQueueProgramSetup;
  setMacroQueueProgramSetup: (
    updater:
      | MacroQueueProgramSetup
      | ((prev: MacroQueueProgramSetup) => MacroQueueProgramSetup),
  ) => void;

  /**
   * Programm-Warteschlange (Makros-Screen); bleibt über Sidebar-Wechsel und Remount von
   * `MacrosScreen` erhalten (Session-lokal, kein localStorage).
   */
  macroQueueItems: QueueItem[];
  /** Wie `setState`: volles Array oder Updater-Funktion. */
  setMacroQueueItems: (
    updater: QueueItem[] | ((prev: QueueItem[]) => QueueItem[]),
  ) => void;
}

/** HAL manual tool change: payload from `machine.tool_change.requested` */
export interface PendingToolChange {
  toolNumber: number;
  description: string;
}

export interface MachineSlice {
  coordinates: Coordinates;
  /** Connection state to the LinuxCNC instance */
  connectionStatus: ConnectionStatus;
  /** Full status tree from linuxcnc.stat, grouped by topic */
  linuxCncStatus: LinuxCncStatusRoot;
  iniRuntimeConfig: IniRuntimeConfig;
  /**
   * WebSocket URL from `public/lcncgui-config.json`, set after config load.
   * `null` until the file was fetched and parsed successfully.
   */
  backendWebSocketUrl: string | null;
  setBackendWebSocketUrl: (url: string | null) => void;
  /** Current WebSocket connection to the backend, if any */
  backendWebSocket: WebSocket | null;
  setCoordinates: (coordinates: Coordinates) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Merges a partial LinuxCNC status update into current state */
  setLinuxCncStatus: (partial: Partial<LinuxCncStatusRoot>) => void;
  setIniRuntimeConfig: (partial: Partial<IniRuntimeConfig>) => void;
  /** Registers/removes the WebSocket handle for the backend */
  setBackendWebSocket: (ws: WebSocket | null) => void;
  /** HAL tool change: null = no dialog */
  pendingToolChange: PendingToolChange | null;
  setPendingToolChange: (value: PendingToolChange | null) => void;
}

/** One HAL pin value as it arrives over the wire. */
export type PlasmaPinValue = boolean | number;

/** Pin values per component, keyed by the dashed HAL pin name without its prefix. */
export interface PlasmaPinValues {
  plasmac: Record<string, PlasmaPinValue>;
  qtplasmac: Record<string, PlasmaPinValue>;
}

/** Decoded `plasmac.state-out` / `stop-type-out` (see backend/plasma/state.py). */
export interface PlasmaState {
  state: number | null;
  stateName: string | null;
  stateDescription: string | null;
  stopType: number | null;
  stopTypeName: string | null;
  isCutting: boolean;
}

/**
 * One cut material from `<machine>_material.cfg`.
 *
 * The twelve numbers are QtPlasmaC's fourteen keys minus `NAME`, camelCased. `temporary` is
 * true for the numbers from 1000000 up, which a G-code program declares and which are never
 * written to the file — those cannot be edited or deleted here.
 */
export interface PlasmaMaterial {
  number: number;
  name: string;
  temporary: boolean;
  kerfWidth: number;
  pierceHeight: number;
  pierceDelay: number;
  puddleJumpHeight: number;
  puddleJumpDelay: number;
  cutHeight: number;
  cutSpeed: number;
  cutAmps: number;
  cutVolts: number;
  pauseAtEnd: number;
  gasPressure: number;
  cutMode: number;
  thickness: number;
}

/** Payload of `plasma.materials.changed` and of the `plasma.get_materials` result. */
export interface PlasmaMaterials {
  materials: PlasmaMaterial[];
  /** The material whose values are on the `plasmac.*` setpoints right now. */
  selected: number | null;
  /** The one selected at startup, and what `material_change_number = -1` means. */
  default: number | null;
  path: string;
}

/**
 * Payload of `plasma.parameters.changed` and of the `plasma.get_parameters` result.
 *
 * `values` is keyed by QtPlasmaC's own prefs keys (`"Pid P Gain"`), because those keys are
 * the contract with the file and with QtPlasmaC itself — renaming them in the UI layer would
 * mean two names for one thing. `enables` is keyed by dashed `plasmac.*` pin name.
 */
export interface PlasmaParameters {
  values: Record<string, number>;
  defaults: Record<string, number>;
  enables: Record<string, boolean>;
  /** 1 on a metric machine, 0.03937 on an imperial one (QtPlasmaC's own constant). */
  unitsPerMm: number;
  path: string;
}

/**
 * One polyline of the preview: a run of same-kind moves from one G-code line.
 *
 * `line` is the source line the interpreter was on, which is what makes clicking a segment a
 * run-from-line gesture rather than a decoration.
 */
export interface PlasmaToolpathSegment {
  kind: 'rapid' | 'feed';
  line: number;
  pts: number[][];
}

/** Payload of the `plasma.toolpath` result: LinuxCNC's interpreter run over a program. */
export interface PlasmaToolpath {
  path: string;
  segments: PlasmaToolpathSegment[];
  extents: { min: number[]; max: number[] } | null;
  points: number;
  /** True when the program was larger than the point budget and the tail is missing. */
  truncated: boolean;
  units: 'mm' | 'inch';
}

/** Payload of `plasma.pins.snapshot` and of the `plasma.get_snapshot` result. */
export interface PlasmaSnapshot {
  pins: Partial<PlasmaPinValues>;
  state?: PlasmaState;
  /** `plasmac.*` pins this LinuxCNC build does not have (2.9.4 lacks 18 of them). */
  missingPins?: string[];
  /** Present when the backend found the machine's config files. */
  materials?: PlasmaMaterials;
  parameters?: PlasmaParameters;
}

export interface PlasmaSlice {
  /** True once a plasma snapshot arrived; false on machines without the plasma HAL layer. */
  plasmaAvailable: boolean;
  plasmaPins: PlasmaPinValues;
  plasmaState: PlasmaState;
  plasmaMissingPins: string[];
  /** Null until the backend reports them; stays null without an INI to find the files in. */
  plasmaMaterials: PlasmaMaterials | null;
  plasmaParameters: PlasmaParameters | null;
  /** Preview of the loaded program; null while none has been parsed. */
  plasmaToolpath: PlasmaToolpath | null;
  /** Why the last preview failed (a G-code error, usually), for the screen to show. */
  plasmaToolpathError: string | null;
  plasmaToolpathLoading: boolean;
  setPlasmaSnapshot: (snapshot: PlasmaSnapshot) => void;
  mergePlasmaPins: (diff: Partial<PlasmaPinValues>) => void;
  setPlasmaState: (state: PlasmaState) => void;
  setPlasmaMaterials: (materials: PlasmaMaterials) => void;
  setPlasmaParameters: (parameters: PlasmaParameters) => void;
  setPlasmaToolpath: (toolpath: PlasmaToolpath | null) => void;
  setPlasmaToolpathError: (message: string | null) => void;
  setPlasmaToolpathLoading: (loading: boolean) => void;
  resetPlasma: () => void;
}

export type BoundStore = UISlice & MachineSlice & PlasmaSlice;
