import { describe, expect, it } from 'vitest';
import {
  BOHREN_NORMAL_MACRO_ID,
  BOHRFRAESEN_MACRO_ID,
  PLAN_FRAESEN_MACRO_ID,
  getMacroDefinitionById,
} from '@/data/macroDefinitions';
import {
  buildDrillDialogInitialParams,
  buildHelixBoreDialogInitialParams,
  buildPlanDialogInitialParams,
} from '@/components/macros/MacroParamDialog';
import type { Tool } from '@/types/tools';

const planDefinition = getMacroDefinitionById(PLAN_FRAESEN_MACRO_ID);
const drillDefinition = getMacroDefinitionById(BOHREN_NORMAL_MACRO_ID);
const helixDefinition = getMacroDefinitionById(BOHRFRAESEN_MACRO_ID);

describe('buildPlanDialogInitialParams', () => {
  it('prefills tool and machine coordinates for new entries', () => {
    if (!planDefinition) throw new Error('Missing plan macro definition');
    const tools: Tool[] = [
      { id: 'face-a', toolNumber: 7, name: 'Face A' } as Tool,
      { id: 'face-b', toolNumber: 8, name: 'Face B' } as Tool,
    ];

    const result = buildPlanDialogInitialParams({
      definition: planDefinition,
      initialParams: null,
      toolsNow: tools,
      activeToolId: 'face-b',
      coordinates: { x: 12.34567, y: -4.2, z: 3.5 },
    });

    expect(result.toolId).toBe('face-b');
    expect(result.areaStartX).toBe('12.346');
    expect(result.areaStartY).toBe('-4.200');
    expect(result.surfaceZ).toBe(3.5);
    expect(result.targetZ).toBe(3.3);
  });

  it('maps legacy numeric tool and keeps explicit initial params', () => {
    if (!planDefinition) throw new Error('Missing plan macro definition');
    const tools: Tool[] = [{ id: 'face-a', toolNumber: 7, name: 'Face A' } as Tool];

    const result = buildPlanDialogInitialParams({
      definition: planDefinition,
      initialParams: {
        tool: 7,
        areaStartX: '99',
        areaStartY: '88',
        surfaceZ: '1.25',
        coolantOn: 'false',
      },
      toolsNow: tools,
      activeToolId: null,
      coordinates: { x: 1, y: 2, z: 3 },
    });

    expect(result.toolId).toBe('face-a');
    expect(result.areaStartX).toBe('99');
    expect(result.areaStartY).toBe('88');
    expect(result.surfaceZ).toBe(1.25);
    expect(result.targetZ).toBe(1.05);
    expect(result.coolantOn).toBe(false);
  });

  it('migrates legacy stepDown to targetZ', () => {
    if (!planDefinition) throw new Error('Missing plan macro definition');
    const tools: Tool[] = [{ id: 'face-a', toolNumber: 7, name: 'Face A' } as Tool];

    const result = buildPlanDialogInitialParams({
      definition: planDefinition,
      initialParams: {
        toolId: 'face-a',
        surfaceZ: '1',
        stepDown: '0.4',
      },
      toolsNow: tools,
      activeToolId: null,
      coordinates: { x: 0, y: 0, z: 0 },
    });

    expect(result.surfaceZ).toBe(1);
    expect(result.targetZ).toBe(0.6);
    expect(result.stepDown).toBeUndefined();
  });
});

describe('buildDrillDialogInitialParams', () => {
  it('prefills machine XY/Z for root entries', () => {
    if (!drillDefinition) throw new Error('Missing drill macro definition');
    const tools: Tool[] = [{ id: 'drill-a', toolNumber: 2, name: 'Drill A' } as Tool];

    const result = buildDrillDialogInitialParams({
      definition: drillDefinition,
      initialParams: null,
      toolsNow: tools,
      activeToolId: 'drill-a',
      coordinates: { x: 1.1, y: 2.2, z: 30 },
    });

    expect(result.toolId).toBe('drill-a');
    expect(result.x).toBe('1.100');
    expect(result.y).toBe('2.200');
    expect(result.surfaceZ).toBe(0);
    expect(result.safeZ).toBe('30.000');
  });

  it('prefills surfaceZ and safeZ from pattern heights when nested and skips machine XY', () => {
    if (!drillDefinition) throw new Error('Missing drill macro definition');
    const tools: Tool[] = [{ id: 'drill-a', toolNumber: 2, name: 'Drill A' } as Tool];

    const result = buildDrillDialogInitialParams({
      definition: drillDefinition,
      initialParams: null,
      toolsNow: tools,
      activeToolId: 'drill-a',
      coordinates: { x: 1.1, y: 2.2, z: 30 },
      xyProvidedByPattern: true,
      patternHeightDefaults: { surfaceZ: -1.5, safeZ: 3.5 },
    });

    expect(result.x).toBe('');
    expect(result.y).toBe('');
    expect(result.surfaceZ).toBe(-1.5);
    expect(result.safeZ).toBe('3.5');
  });

  it('keeps stored safeZ and surfaceZ when editing', () => {
    if (!drillDefinition) throw new Error('Missing drill macro definition');
    const tools: Tool[] = [{ id: 'drill-a', toolNumber: 2, name: 'Drill A' } as Tool];

    const result = buildDrillDialogInitialParams({
      definition: drillDefinition,
      initialParams: { toolId: 'drill-a', surfaceZ: '-0.5', safeZ: '12', depth: '5' },
      toolsNow: tools,
      activeToolId: null,
      coordinates: { x: 0, y: 0, z: 99 },
      xyProvidedByPattern: true,
      patternHeightDefaults: { surfaceZ: 0, safeZ: 5 },
    });

    expect(result.surfaceZ).toBe(-0.5);
    expect(result.safeZ).toBe('12');
  });

  it('migrates legacy startZ to safeZ when editing', () => {
    if (!drillDefinition) throw new Error('Missing drill macro definition');
    const tools: Tool[] = [{ id: 'drill-a', toolNumber: 2, name: 'Drill A' } as Tool];

    const result = buildDrillDialogInitialParams({
      definition: drillDefinition,
      initialParams: { toolId: 'drill-a', startZ: '12', depth: '5' },
      toolsNow: tools,
      activeToolId: null,
      coordinates: { x: 0, y: 0, z: 99 },
    });

    expect(result.safeZ).toBe('12');
    expect(result.startZ).toBeUndefined();
  });
});

describe('buildHelixBoreDialogInitialParams', () => {
  it('prefills surfaceZ and safeZ from pattern when nested', () => {
    if (!helixDefinition) throw new Error('Missing helix macro definition');
    const tools: Tool[] = [{ id: 'helix-a', toolNumber: 4, name: 'Helix A' } as Tool];

    const result = buildHelixBoreDialogInitialParams({
      definition: helixDefinition,
      initialParams: null,
      toolsNow: tools,
      activeToolId: 'helix-a',
      coordinates: { x: 9, y: 8, z: 40 },
      xyProvidedByPattern: true,
      patternHeightDefaults: { surfaceZ: -2, safeZ: 3 },
    });

    expect(result.x).toBe('');
    expect(result.y).toBe('');
    expect(result.surfaceZ).toBe(-2);
    expect(result.safeZ).toBe('3');
  });
});
