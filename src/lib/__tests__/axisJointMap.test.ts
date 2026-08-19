import { describe, expect, it } from 'vitest';
import {
  axisNeedsSynchronisedHoming,
  jointCoordinatesFromIni,
  jointIndicesForAxis,
  parseJointCoordinates,
  primaryJointIndexForAxis,
} from '../axisJointMap';

describe('parseJointCoordinates', () => {
  it('reads coordinates= out of [KINS] KINEMATICS', () => {
    expect(parseJointCoordinates({ kinsKinematics: 'trivkins coordinates=xyyz' })).toEqual([
      'x',
      'y',
      'y',
      'z',
    ]);
  });

  it('lowercases and ignores other kinematics tokens', () => {
    expect(
      parseJointCoordinates({ kinsKinematics: 'trivkins coordinates=XYZ kinstype=BOTH' }),
    ).toEqual(['x', 'y', 'z']);
  });

  it('falls back to [KINS] COORDINATES when KINEMATICS has no coordinates token', () => {
    expect(
      parseJointCoordinates({ kinsKinematics: 'genhexkins', kinsCoordinates: 'X Y Y Z' }),
    ).toEqual(['x', 'y', 'y', 'z']);
  });

  it('falls back to [TRAJ] COORDINATES last', () => {
    expect(parseJointCoordinates({ trajCoordinates: 'X Y Z A' })).toEqual(['x', 'y', 'z', 'a']);
  });

  it('prefers KINS over TRAJ — they differ on gantry machines', () => {
    expect(
      parseJointCoordinates({
        kinsKinematics: 'trivkins coordinates=xyyz',
        trajCoordinates: 'XYZ',
      }),
    ).toEqual(['x', 'y', 'y', 'z']);
  });

  it('defaults to xyz when nothing is known', () => {
    expect(parseJointCoordinates({})).toEqual(['x', 'y', 'z']);
    expect(parseJointCoordinates({ kinsKinematics: null, trajCoordinates: '' })).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('drops characters that are not axis letters', () => {
    expect(parseJointCoordinates({ trajCoordinates: 'X,Y,Z' })).toEqual(['x', 'y', 'z']);
    expect(parseJointCoordinates({ kinsKinematics: 'trivkins coordinates=xy1z' })).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('accepts every LinuxCNC axis letter', () => {
    expect(parseJointCoordinates({ trajCoordinates: 'XYZABCUVW' })).toEqual([
      'x',
      'y',
      'z',
      'a',
      'b',
      'c',
      'u',
      'v',
      'w',
    ]);
  });
});

describe('jointIndicesForAxis', () => {
  const xyyz = ['x', 'y', 'y', 'z'];

  it('maps Z to joint 3 on an XYYZ gantry — not joint 2', () => {
    expect(jointIndicesForAxis(xyyz, 'z')).toEqual([3]);
  });

  it('returns every joint of a duplicated axis', () => {
    expect(jointIndicesForAxis(xyyz, 'y')).toEqual([1, 2]);
  });

  it('maps the trivial case one-to-one', () => {
    expect(jointIndicesForAxis(['x', 'y', 'z'], 'x')).toEqual([0]);
    expect(jointIndicesForAxis(['x', 'y', 'z'], 'z')).toEqual([2]);
  });

  it('returns nothing for an axis the machine does not have', () => {
    expect(jointIndicesForAxis(['x', 'z'], 'y')).toEqual([]);
  });

  it('is case-insensitive on the axis argument', () => {
    expect(jointIndicesForAxis(xyyz, 'Z')).toEqual([3]);
  });
});

describe('primaryJointIndexForAxis', () => {
  it('returns the first joint of the axis', () => {
    expect(primaryJointIndexForAxis(['x', 'y', 'y', 'z'], 'y')).toBe(1);
    expect(primaryJointIndexForAxis(['x', 'y', 'y', 'z'], 'z')).toBe(3);
  });

  it('returns null for a missing axis', () => {
    expect(primaryJointIndexForAxis(['x', 'y', 'z'], 'a')).toBeNull();
  });
});

describe('axisNeedsSynchronisedHoming', () => {
  const xyyz = ['x', 'y', 'y', 'z'];

  it('is true for an axis driven by more than one joint', () => {
    expect(axisNeedsSynchronisedHoming(xyyz, 'y', [])).toBe(true);
  });

  it('is true when any joint of the axis has a negative HOME_SEQUENCE', () => {
    expect(axisNeedsSynchronisedHoming(xyyz, 'z', ['1', '-2', '-2', '-3'])).toBe(true);
  });

  it('is false for a single joint with a positive sequence', () => {
    expect(axisNeedsSynchronisedHoming(xyyz, 'z', ['1', '-2', '-2', '0'])).toBe(false);
  });

  it('is false when sequences are unknown and the axis has one joint', () => {
    expect(axisNeedsSynchronisedHoming(xyyz, 'x', [])).toBe(false);
    expect(axisNeedsSynchronisedHoming(xyyz, 'x', [null, null, null, null])).toBe(false);
  });

  it('tolerates whitespace and a signed-positive sequence', () => {
    expect(axisNeedsSynchronisedHoming(xyyz, 'z', ['0', '-2', '-2', ' -3 '])).toBe(true);
    expect(axisNeedsSynchronisedHoming(xyyz, 'z', ['0', '-2', '-2', '+3'])).toBe(false);
  });

  it('is false for a missing axis (nothing to synchronise)', () => {
    expect(axisNeedsSynchronisedHoming(['x', 'z'], 'y', [])).toBe(false);
  });
});

describe('jointCoordinatesFromIni', () => {
  it('reads the kinematics string the backend publishes', () => {
    expect(
      jointCoordinatesFromIni({
        kins_kinematics: 'trivkins coordinates=xyyz',
        kins_coordinates: null,
        traj_coordinates: 'XYYZ',
      }),
    ).toEqual(['x', 'y', 'y', 'z']);
  });

  it('defaults to xyz for an empty config', () => {
    expect(jointCoordinatesFromIni({})).toEqual(['x', 'y', 'z']);
  });
});
