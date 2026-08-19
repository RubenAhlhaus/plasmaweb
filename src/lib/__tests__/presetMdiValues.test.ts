import { describe, expect, it } from 'vitest';

import {
  formatPresetMdiLine,
  presetDisplayLabel,
  presetMdiValues,
  presetSelectOptions,
} from '@/lib/presetMdiValues';
import type { ToolPreset } from '@/types/tools';

const basePreset = (overrides: Partial<ToolPreset> = {}): ToolPreset => ({
  id: 'p1',
  name: 'Roughing',
  spindle_rpm: 12000.4,
  feed_mm_min: 800.6,
  ...overrides,
});

describe('presetMdiValues', () => {
  it('returns rounded S/F for valid preset', () => {
    expect(presetMdiValues(basePreset())).toEqual({ s: 12000, f: 801 });
  });

  it('returns null when feed or rpm missing or feed not positive', () => {
    expect(presetMdiValues(undefined)).toBeNull();
    expect(presetMdiValues(basePreset({ spindle_rpm: undefined }))).toBeNull();
    expect(presetMdiValues(basePreset({ feed_mm_min: 0 }))).toBeNull();
  });
});

describe('presetDisplayLabel', () => {
  it('prefers trimmed name, otherwise id', () => {
    expect(presetDisplayLabel(basePreset())).toBe('Roughing');
    expect(presetDisplayLabel(basePreset({ name: '  ' }))).toBe('p1');
    expect(presetDisplayLabel(basePreset({ name: '' }))).toBe('p1');
  });
});

describe('formatPresetMdiLine', () => {
  it('formats S/F only without label', () => {
    expect(formatPresetMdiLine({ s: 5000, f: 1200 })).toBe('S5000 F1200');
  });

  it('appends G-code comment with preset label', () => {
    expect(formatPresetMdiLine({ s: 5000, f: 1200 }, 'Roughing')).toBe(
      'S5000 F1200 ; Roughing',
    );
  });

  it('ignores blank preset label', () => {
    expect(formatPresetMdiLine({ s: 1, f: 2 }, '   ')).toBe('S1 F2');
  });
});

describe('presetSelectOptions', () => {
  it('uses presetDisplayLabel for option labels', () => {
    expect(
      presetSelectOptions([basePreset(), basePreset({ id: 'p2', name: '  ' })]),
    ).toEqual([
      { value: 'p1', label: 'Roughing' },
      { value: 'p2', label: 'p2' },
    ]);
  });
});
