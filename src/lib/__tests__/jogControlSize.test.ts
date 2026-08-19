import { describe, expect, it } from 'vitest';
import {
  isMachineTwoColumnLayout,
  JOG_CONTROL_FULL_MIN_WIDTH_PX,
  MACHINE_TWO_COLUMN_MIN_WIDTH_PX,
  resolveJogControlSize,
} from '../jogControlSize';

describe('jogControlSize', () => {
  describe('isMachineTwoColumnLayout', () => {
    it('returns true at xl breakpoint', () => {
      expect(isMachineTwoColumnLayout(MACHINE_TWO_COLUMN_MIN_WIDTH_PX)).toBe(true);
    });

    it('returns false below xl breakpoint', () => {
      expect(isMachineTwoColumnLayout(MACHINE_TWO_COLUMN_MIN_WIDTH_PX - 1)).toBe(false);
    });
  });

  describe('resolveJogControlSize', () => {
    it('returns compact when stacked (single column)', () => {
      expect(resolveJogControlSize(900, false)).toBe('compact');
    });

    it('returns full when two-column and panel is wide enough', () => {
      expect(resolveJogControlSize(JOG_CONTROL_FULL_MIN_WIDTH_PX, true)).toBe('full');
      expect(resolveJogControlSize(JOG_CONTROL_FULL_MIN_WIDTH_PX + 100, true)).toBe('full');
    });

    it('returns compact when two-column but panel is too narrow', () => {
      expect(resolveJogControlSize(JOG_CONTROL_FULL_MIN_WIDTH_PX - 1, true)).toBe('compact');
    });
  });
});
