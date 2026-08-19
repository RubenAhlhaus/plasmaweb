import { describe, expect, it } from 'vitest';
import {
  validateDrillParamsForSubmit,
  validateGenericParamsForSubmit,
} from '@/components/macros/macroParamDialogValidation';
import { omitPatternProvidedFields } from '@/components/macros/macroParamFieldUtils';
import {
  BOHRFRAESEN_MACRO_ID,
  PLAN_FRAESEN_MACRO_ID,
  getMacroDefinitionById,
} from '@/data/macroDefinitions';
import type { MacroParams } from '@/types/macros';
import type { Tool } from '@/types/tools';

const tools: Tool[] = [
  {
    id: 'tool-1',
    toolNumber: 1,
    name: 'Drill',
    diameter: 6,
  },
];

function baseDrillParams(overrides: MacroParams = {}): MacroParams {
  return {
    toolId: 'tool-1',
    presetId: '',
    spindle: '2000',
    feed: '100',
    surfaceZ: '0',
    safeZ: '5',
    depth: '10',
    vorschubHoeheMm: '2',
    x: '12.5',
    y: '-3',
    coolantOn: false,
    ...overrides,
  };
}

describe('omitPatternProvidedFields', () => {
  it('removes x/y/surfaceZ keys and drops empty sections', () => {
    const sections = omitPatternProvidedFields([
      { headingKey: 'sections.tool', keys: ['toolId'] },
      { headingKey: 'sections.positions', keys: ['x', 'y'] },
      { headingKey: 'sections.heights', keys: ['surfaceZ', 'safeZ'] },
      { headingKey: 'sections.hole', keys: ['x', 'y', 'nominalDiameter'] },
    ]);
    expect(sections).toEqual([
      { headingKey: 'sections.tool', keys: ['toolId'] },
      { headingKey: 'sections.heights', keys: ['safeZ'] },
      { headingKey: 'sections.hole', keys: ['nominalDiameter'] },
    ]);
  });
});

describe('validateDrillParamsForSubmit', () => {
  it('requires x/y when not nested in a pattern', () => {
    const result = validateDrillParamsForSubmit(
      baseDrillParams({ x: '', y: '' }),
      tools,
      false,
    );
    expect(result.ok).toBe(false);
  });

  it('allows empty x/y when nested and preserves existing values', () => {
    const emptyXy = validateDrillParamsForSubmit(
      baseDrillParams({ x: '', y: '' }),
      tools,
      true,
    );
    expect(emptyXy.ok).toBe(true);
    if (emptyXy.ok) {
      expect(emptyXy.resolved.x).toBe('');
      expect(emptyXy.resolved.y).toBe('');
    }

    const kept = validateDrillParamsForSubmit(baseDrillParams(), tools, true);
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.resolved.x).toBe(12.5);
      expect(kept.resolved.y).toBe(-3);
    }
  });

  it('persists fullRetract on submit', () => {
    const on = validateDrillParamsForSubmit(
      baseDrillParams({ fullRetract: true }),
      tools,
    );
    expect(on.ok).toBe(true);
    if (on.ok) {
      expect(on.resolved.fullRetract).toBe(true);
    }

    const fromString = validateDrillParamsForSubmit(
      baseDrillParams({ fullRetract: 'true' }),
      tools,
    );
    expect(fromString.ok).toBe(true);
    if (fromString.ok) {
      expect(fromString.resolved.fullRetract).toBe(true);
    }

    const off = validateDrillParamsForSubmit(
      baseDrillParams({ fullRetract: false }),
      tools,
    );
    expect(off.ok).toBe(true);
    if (off.ok) {
      expect(off.resolved.fullRetract).toBe(false);
    }
  });
});

describe('validateGenericParamsForSubmit (helix)', () => {
  const definition = getMacroDefinitionById(BOHRFRAESEN_MACRO_ID)!;

  function baseHelixParams(overrides: MacroParams = {}): MacroParams {
    return {
      toolId: 'tool-1',
      presetId: '',
      spindle: '3000',
      feedXY: '200',
      surfaceZ: 0,
      safeZ: '5',
      x: '8',
      y: '9',
      depth: '12',
      nominalDiameter: '10',
      helixAngle: 3,
      millingDirection: 'climb',
      coolantOn: true,
      ...overrides,
    };
  }

  it('requires x/y when not nested', () => {
    const result = validateGenericParamsForSubmit(
      definition,
      baseHelixParams({ x: '', y: '' }),
      tools,
      false,
    );
    expect(result.ok).toBe(false);
  });

  it('skips requiring x/y when nested and keeps stored coordinates', () => {
    const result = validateGenericParamsForSubmit(
      definition,
      baseHelixParams({ x: '8', y: '9' }),
      tools,
      true,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.x).toBe(8);
      expect(result.resolved.y).toBe(9);
    }

    const empty = validateGenericParamsForSubmit(
      definition,
      baseHelixParams({ x: '', y: '' }),
      tools,
      true,
    );
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.resolved.x).toBe('');
      expect(empty.resolved.y).toBe('');
    }
  });

  it('still validates other required helix fields when nested', () => {
    const result = validateGenericParamsForSubmit(
      definition,
      baseHelixParams({ nominalDiameter: '' }),
      tools,
      true,
    );
    expect(result.ok).toBe(false);
  });
});

describe('validateGenericParamsForSubmit (plan face)', () => {
  const definition = getMacroDefinitionById(PLAN_FRAESEN_MACRO_ID)!;

  function basePlanParams(overrides: MacroParams = {}): MacroParams {
    return {
      toolId: 'tool-1',
      presetId: '',
      areaStartX: 0,
      areaStartY: 0,
      areaWidth: 80,
      areaHeight: 40,
      cutterOverhangMm: 0,
      vorschubHoeheMm: 5,
      surfaceZ: 1,
      targetZ: 0.6,
      stepOver: 5,
      feedXY: 350,
      feedZ: 120,
      spindle: 3000,
      coolantOn: true,
      ...overrides,
    };
  }

  it('accepts targetZ below surfaceZ', () => {
    const result = validateGenericParamsForSubmit(definition, basePlanParams(), tools);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.targetZ).toBe(0.6);
      expect(result.resolved.stepDown).toBeUndefined();
    }
  });

  it('rejects targetZ equal to surfaceZ', () => {
    const result = validateGenericParamsForSubmit(
      definition,
      basePlanParams({ targetZ: 1 }),
      tools,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/below/i);
    }
  });

  it('rejects targetZ above surfaceZ', () => {
    const result = validateGenericParamsForSubmit(
      definition,
      basePlanParams({ targetZ: 1.2 }),
      tools,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/below/i);
    }
  });
});
