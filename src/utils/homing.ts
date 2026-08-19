import type { LinuxCncStatusRoot } from '@/store/types';
import type { JogAxis } from '@/api/jogTypes';
import { jointIndicesForAxis } from '@/lib/axisJointMap';

const JOG_AXES: readonly JogAxis[] = ['x', 'y', 'z'];

/** Plain XYZ machine: joint index equals axis index. */
const DEFAULT_JOINT_COORDINATES = ['x', 'y', 'z'];

export type HomingStatusSource = Pick<LinuxCncStatusRoot, 'motion' | 'joints'>;

function isTruthyFlag(value: number | undefined | null): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  return value !== 0;
}

function jointHomedFlag(
  status: HomingStatusSource,
  joint: number,
): boolean | undefined {
  const motionHomed = status.motion?.homed;
  if (Array.isArray(motionHomed) && joint >= 0 && joint < motionHomed.length) {
    if (motionHomed[joint] !== undefined && motionHomed[joint] !== null) {
      return isTruthyFlag(motionHomed[joint]);
    }
  }

  const joints = status.joints;
  if (Array.isArray(joints) && joint >= 0 && joint < joints.length) {
    const jointHomed = joints[joint]?.homed;
    if (jointHomed !== undefined && jointHomed !== null) {
      return isTruthyFlag(jointHomed);
    }
  }

  return undefined;
}

/**
 * Whether every joint driving `axis` reports homed.
 *
 * `stat.homed` and `stat.joint[]` are indexed by **joint**, not by axis, so the two only
 * coincide on a plain XYZ machine. Pass `jointCoordinates` (from
 * `jointCoordinatesFromIni`) to read the right entries on a gantry — with
 * `trivkins coordinates=xyyz`, Z is joint 3 and Y needs both joints 1 and 2 homed.
 *
 * Omitting `jointCoordinates` keeps the plain XYZ mapping.
 */
export function isAxisHomed(
  status: HomingStatusSource | undefined | null,
  axis: JogAxis,
  jointCoordinates: string[] = DEFAULT_JOINT_COORDINATES,
): boolean {
  if (!status) {
    return false;
  }

  const joints = jointIndicesForAxis(jointCoordinates, axis);
  if (joints.length === 0) {
    return false;
  }

  return joints.every((joint) => jointHomedFlag(status, joint) === true);
}

/** Axes the machine has that are not fully homed. See {@link isAxisHomed}. */
export function getUnhomedAxes(
  status: HomingStatusSource | undefined | null,
  jointCoordinates: string[] = DEFAULT_JOINT_COORDINATES,
): JogAxis[] {
  return JOG_AXES.filter(
    (axis) =>
      jointIndicesForAxis(jointCoordinates, axis).length > 0 &&
      !isAxisHomed(status, axis, jointCoordinates),
  );
}
