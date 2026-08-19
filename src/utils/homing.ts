import type { LinuxCncStatusRoot } from '@/store/types';
import type { JogAxis } from '@/api/jogTypes';

const JOG_AXES: readonly JogAxis[] = ['x', 'y', 'z'];

const AXIS_INDEX: Record<JogAxis, number> = {
  x: 0,
  y: 1,
  z: 2,
};

export type HomingStatusSource = Pick<LinuxCncStatusRoot, 'motion' | 'joints'>;

function isTruthyFlag(value: number | undefined | null): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  return value !== 0;
}

export function isAxisHomed(status: HomingStatusSource | undefined | null, axis: JogAxis): boolean {
  if (!status) {
    return false;
  }

  const index = AXIS_INDEX[axis];

  const motionHomed = status.motion?.homed;
  if (Array.isArray(motionHomed) && index >= 0 && index < motionHomed.length) {
    if (motionHomed[index] !== undefined && motionHomed[index] !== null) {
      return isTruthyFlag(motionHomed[index]);
    }
  }

  const joints = status.joints;
  if (Array.isArray(joints) && index >= 0 && index < joints.length) {
    const jointHomed = joints[index]?.homed;
    if (jointHomed !== undefined && jointHomed !== null) {
      return isTruthyFlag(jointHomed);
    }
  }

  return false;
}

export function getUnhomedAxes(status: HomingStatusSource | undefined | null): JogAxis[] {
  return JOG_AXES.filter((axis) => !isAxisHomed(status, axis));
}

