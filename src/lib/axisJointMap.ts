/**
 * Axis letter → HAL joint index.
 *
 * LinuxCNC numbers joints by their position in the kinematics coordinates string, so the
 * mapping is only one-to-one on a plain XYZ machine. A gantry config such as
 * `trivkins coordinates=xyyz` has Y on joints 1 *and* 2, which puts Z on joint **3** — any
 * command that assumes `z === 2` there drives the wrong joint.
 *
 * Axis-mode motion (`linuxcnc.command.jog` with `JOGGING_AXIS`) is addressed by axis letter
 * and is unaffected. Joint-mode motion — homing, and jogging before an axis is homed — is
 * addressed by joint index and needs this map.
 *
 * Mirrors QtPlasmaC's `set_axes_and_joints`
 * (share/qtvcp/screens/qtplasmac/qtplasmac_handler.py).
 */

/** LinuxCNC axis letters, in the canonical order used by COORDINATES strings. */
const AXIS_LETTERS = 'xyzabcuvw';

export interface JointCoordinateSources {
  /** INI `[KINS] KINEMATICS`, e.g. `trivkins coordinates=xyyz`. Authoritative. */
  kinsKinematics?: string | null;
  /** INI `[KINS] COORDINATES`, used when KINEMATICS carries no `coordinates=` token. */
  kinsCoordinates?: string | null;
  /**
   * INI `[TRAJ] COORDINATES`. Last resort: it describes *axes*, which only coincides with
   * joints on trivkins machines without duplicated letters.
   */
  trajCoordinates?: string | null;
}

/** Machines with no usable kinematics info are treated as plain XYZ, as QtPlasmaC does. */
const DEFAULT_JOINT_COORDINATES = ['x', 'y', 'z'];

function lettersOf(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .toLowerCase()
    .split('')
    .filter((ch) => AXIS_LETTERS.includes(ch));
}

function coordinatesTokenOf(kinematics: string | null | undefined): string | null {
  if (!kinematics) {
    return null;
  }
  const token = kinematics
    .trim()
    .split(/\s+/)
    .find((part) => part.toLowerCase().startsWith('coordinates='));
  if (!token) {
    return null;
  }
  const value = token.slice(token.indexOf('=') + 1).trim();
  return value || null;
}

/**
 * One axis letter per joint, joint index = array index.
 *
 * @example parseJointCoordinates({ kinsKinematics: 'trivkins coordinates=xyyz' })
 *          // ['x', 'y', 'y', 'z'] — joint 3 is Z
 */
export function parseJointCoordinates(sources: JointCoordinateSources): string[] {
  const candidates = [
    coordinatesTokenOf(sources.kinsKinematics),
    sources.kinsCoordinates,
    sources.trajCoordinates,
  ];
  for (const candidate of candidates) {
    const letters = lettersOf(candidate);
    if (letters.length > 0) {
      return letters;
    }
  }
  return [...DEFAULT_JOINT_COORDINATES];
}

/** Every joint driving `axis`, ascending. Empty when the machine has no such axis. */
export function jointIndicesForAxis(jointCoordinates: string[], axis: string): number[] {
  const wanted = axis.trim().toLowerCase();
  if (!wanted) {
    return [];
  }
  return jointCoordinates.reduce<number[]>((acc, letter, index) => {
    if (letter === wanted) {
      acc.push(index);
    }
    return acc;
  }, []);
}

/**
 * The joint to address for `axis`, or null if the machine has no such axis.
 *
 * For a duplicated axis this is the first joint: LinuxCNC homes the rest of the set itself
 * via their negative `HOME_SEQUENCE`.
 */
export function primaryJointIndexForAxis(
  jointCoordinates: string[],
  axis: string,
): number | null {
  const [first] = jointIndicesForAxis(jointCoordinates, axis);
  return first === undefined ? null : first;
}

/**
 * Whether `axis` may only move as a synchronised set — more than one joint drives it, or a
 * joint of it declares a negative `HOME_SEQUENCE`.
 *
 * Such an axis must not be jogged in joint mode from an axis-labelled button: moving one
 * side of a gantry alone racks the machine. QtPlasmaC keeps the `all_homed` requirement on
 * those jog buttons for the same reason.
 *
 * @param homeSequences INI `[JOINT_n] HOME_SEQUENCE` values, joint index = array index.
 *                      Missing or unparsed entries count as "not synchronised".
 */
export function axisNeedsSynchronisedHoming(
  jointCoordinates: string[],
  axis: string,
  homeSequences: ReadonlyArray<string | number | null | undefined>,
): boolean {
  const joints = jointIndicesForAxis(jointCoordinates, axis);
  if (joints.length === 0) {
    return false;
  }
  if (joints.length > 1) {
    return true;
  }
  return joints.some((joint) => {
    const raw = homeSequences[joint];
    if (raw === null || raw === undefined) {
      return false;
    }
    return String(raw).trim().startsWith('-');
  });
}

/**
 * Joint coordinates from the INI runtime config the backend publishes with
 * `machine.ini_config.loaded`.
 */
export function jointCoordinatesFromIni(ini: {
  kins_kinematics?: string | null;
  kins_coordinates?: string | null;
  traj_coordinates?: string | null;
}): string[] {
  return parseJointCoordinates({
    kinsKinematics: ini.kins_kinematics,
    kinsCoordinates: ini.kins_coordinates,
    trajCoordinates: ini.traj_coordinates,
  });
}
