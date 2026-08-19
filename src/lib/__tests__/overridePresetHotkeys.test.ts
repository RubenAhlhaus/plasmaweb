import { describe, expect, it } from 'vitest';

import {
  findGlobalHotkeyConflict,
  findOverridePositionForHotkey,
  overridePercentForPosition,
  parseOverridePresetHotkeysMap,
  type OverridePresetPosition,
} from '../overridePresetHotkeys';

describe('overridePercentForPosition', () => {
  it('maps 0–10 to 0–100 in steps of 10', () => {
    for (let p = 0; p <= 10; p++) {
      expect(overridePercentForPosition(p as OverridePresetPosition)).toBe(p * 10);
    }
  });

  it('maps 11–15 to 125–200 in steps of 25 (capped at 200)', () => {
    expect(overridePercentForPosition(11)).toBe(125);
    expect(overridePercentForPosition(12)).toBe(150);
    expect(overridePercentForPosition(13)).toBe(175);
    expect(overridePercentForPosition(14)).toBe(200);
    expect(overridePercentForPosition(15)).toBe(200);
  });
});

describe('parseOverridePresetHotkeysMap', () => {
  it('keeps valid positions and ignores invalid entries', () => {
    expect(
      parseOverridePresetHotkeysMap({
        '0': { key: 'a' },
        '8': { key: 'b', ctrl: true },
        '16': { key: 'c' },
        'x': { key: 'd' },
        '3': { nope: true },
      }),
    ).toEqual({
      0: { key: 'a' },
      8: { key: 'b', ctrl: true },
    });
  });
});

describe('findOverridePositionForHotkey', () => {
  it('returns the matching position', () => {
    const map = {
      2: { key: 'F2' },
      14: { key: 'F14', shift: true },
    };
    expect(findOverridePositionForHotkey(map, { key: 'F14', shift: true })).toBe(14);
    expect(findOverridePositionForHotkey(map, { key: 'F14' })).toBeNull();
  });
});

describe('findGlobalHotkeyConflict', () => {
  const maps = {
    virtualSidebar: { 1: { key: 'F1' } },
    feed: { 8: { key: 'a' } },
    spindle: { 3: { key: 's', ctrl: true } },
  };

  it('detects sidebar conflicts', () => {
    expect(
      findGlobalHotkeyConflict({ key: 'F1' }, maps, { scope: 'feed', position: 0 }),
    ).toEqual({ scope: 'virtualSidebar', buttonId: 1 });
  });

  it('detects feed conflicts', () => {
    expect(
      findGlobalHotkeyConflict({ key: 'a' }, maps, { scope: 'spindle', position: 0 }),
    ).toEqual({ scope: 'feed', position: 8 });
  });

  it('ignores the excluded slot', () => {
    expect(
      findGlobalHotkeyConflict({ key: 'a' }, maps, { scope: 'feed', position: 8 }),
    ).toBeNull();
  });
});
