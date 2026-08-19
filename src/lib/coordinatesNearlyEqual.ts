import type { Coordinates } from '@/store/types';
import { COORDINATE_DISPLAY_DECIMALS } from '@/lib/formatCoordinates';

const COORDINATE_AXIS_KEYS: Array<keyof Coordinates> = [
  'x',
  'y',
  'z',
  'a',
  'b',
  'c',
  'u',
  'v',
  'w',
];

/** Half of one display step — matches backend coordinate publish rounding (3 decimals). */
const COORDINATE_EPSILON = 10 ** -COORDINATE_DISPLAY_DECIMALS / 2;

export function coordinatesNearlyEqual(a: Coordinates, b: Coordinates): boolean {
  return COORDINATE_AXIS_KEYS.every((axis) => Math.abs(a[axis] - b[axis]) < COORDINATE_EPSILON);
}
