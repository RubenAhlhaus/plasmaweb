import { describe, expect, it } from 'vitest';
import {
  activeAxesForToolUi,
  normalizeAxisMaskForUi,
  parseTrajCoordinateLetters,
  resolveToolEditUiProfile,
} from '@/lib/machineToolUiProfile';

describe('machineToolUiProfile', () => {
  it('activeAxesForToolUi prefers axis_mask', () => {
    expect(activeAxesForToolUi(7, 'X Z')).toEqual(['x', 'y', 'z']);
  });

  it('activeAxesForToolUi accepts axis_mask as numeric string', () => {
    expect(activeAxesForToolUi('7', null)).toEqual(['x', 'y', 'z']);
  });

  it('normalizeAxisMaskForUi coerces strings', () => {
    expect(normalizeAxisMaskForUi('7')).toBe(7);
    expect(normalizeAxisMaskForUi(null)).toBeNull();
  });

  it('activeAxesForToolUi falls back to traj string', () => {
    expect(activeAxesForToolUi(undefined, 'X Z')).toEqual(['x', 'z']);
  });

  it('activeAxesForToolUi dedupes coordinate letters', () => {
    expect(parseTrajCoordinateLetters('X Y Y Z')).toEqual(['x', 'y', 'z']);
  });

  it('resolveToolEditUiProfile sets showLatheGeometry from display_lathe', () => {
    expect(
      resolveToolEditUiProfile({
        axisMask: 5,
        trajCoordinates: null,
        displayLathe: true,
      }).showLatheGeometry,
    ).toBe(true);
    expect(
      resolveToolEditUiProfile({
        axisMask: 5,
        trajCoordinates: null,
        displayLathe: false,
      }).showLatheGeometry,
    ).toBe(false);
  });
});
