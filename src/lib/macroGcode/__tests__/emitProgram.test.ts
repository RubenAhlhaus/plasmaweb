import { describe, expect, it } from 'vitest';
import {
  BOHREN_NORMAL_MACRO_ID,
  BOHRFRAESEN_MACRO_ID,
  PLAN_FRAESEN_MACRO_ID,
} from '@/data/macroDefinitions';
import {
  DRILL_CHIP_BREAK_RETRACT_MM,
  generateMacroQueueProgram,
} from '@/lib/macroGcode/emitProgram';
import { formatGCodeNumber } from '@/lib/macroGcode/formatNumber';
import { resolveHelixPitchMmPerRev } from '@/lib/macroGcode/helixBoreAngle';
import type { QueueItem } from '@/types/macros';
import type { Tool } from '@/types/tools';

const minimalDrillTool = {
  id: 'drill-1',
  toolNumber: 2,
  name: 'Test',
} as Tool;

const minimalFaceTool = {
  id: 'face-1',
  toolNumber: 3,
  name: 'Face',
  diameter: 50,
} as Tool;

const minimalHelixTool = {
  id: 'helix-1',
  toolNumber: 4,
  name: 'Helix',
} as Tool;

/** Matches `callArgs` / `formatGCodeNumber` in `emitProgram.ts` — avoids brittle hand-written literals. */
function expectedLcncguiDrillCallLine(args: number[]): string {
  return `o<lcncgui_drill> call ${args.map((n) => `[${formatGCodeNumber(n)}]`).join(' ')}`;
}

describe('generateMacroQueueProgram', () => {
  it('emits o<name> call for user [MACROS] subroutines', () => {
    const queue: QueueItem[] = [
      {
        id: 'u1',
        kind: 'macro',
        macroTypeId: 'user-ngc-go_home',
        params: {},
      },
    ];
    const r = generateMacroQueueProgram(queue, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('o<go_home> call');
    expect(r.content).toContain('( user subroutine go_home.ngc )');
  });

  it('rejects user machine macros nested inside a pattern block', () => {
    const queue: QueueItem[] = [
      {
        kind: 'pattern',
        id: 'p',
        params: {
          patternType: 'rectangular',
          startX: 0,
          startY: 0,
          spacingX: 1,
          spacingY: 1,
          columns: 1,
          rows: 1,
          rotationAngle: 0,
          surfaceZ: 0,
        },
        children: [
          {
            id: 'u1',
            kind: 'macro',
            macroTypeId: 'user-ngc-go_home',
            params: {},
          },
        ],
      },
    ];
    const r = generateMacroQueueProgram(queue, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/pattern block/i);
  });

  it('rejects empty pattern block', () => {
    const queue: QueueItem[] = [
      {
        kind: 'pattern',
        id: 'p',
        params: {
          patternType: 'cartesian',
          startX: 0,
          startY: 0,
          spacingX: 1,
          spacingY: 1,
          columns: 1,
          rows: 1,
          rotationAngle: 0,
          safeZ: 5,
          surfaceZ: 0,
        },
        children: [],
      },
    ];
    const r = generateMacroQueueProgram(queue, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/phase macros/i);
  });

  it('nested drill uses pattern surfaceZ and child safeZ when pattern has no pattern safeZ', () => {
    const queue: QueueItem[] = [
      {
        kind: 'pattern',
        id: 'p',
        params: {
          patternType: 'rectangular',
          startX: 1,
          startY: 2,
          spacingX: 10,
          spacingY: 0,
          columns: 1,
          rows: 1,
          rotationAngle: 0,
          surfaceZ: -1,
        },
        children: [
          {
            kind: 'macro',
            id: 'm',
            macroTypeId: BOHREN_NORMAL_MACRO_ID,
            params: {
              toolId: 'drill-1',
              presetId: '',
              spindle: '2400',
              feed: '120',
              safeZ: '9',
              depth: '5',
              vorschubHoeheMm: '3',
              x: '0',
              y: '0',
              coolantOn: false,
            },
          },
        ],
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // safeZ=9 (child), surfaceZ=-1 (pattern), approach=3, depth=5
      expect(r.content).toContain(
        expectedLcncguiDrillCallLine([1, 2, 9, -1, 3, 5, 120, 0, 0, 0, 0]),
      );
    }
  });

  it('emits subroutine call for valid drill macro', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '5',
          vorschubHoeheMm: '3',
          x: '11',
          y: '22',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toMatch(/G21 G90 G17 G54\nG53 G0 Z0\n/);
      const retractPos = r.content.indexOf('G53 G0 Z0');
      const toolPos = r.content.indexOf('T2 M6');
      expect(retractPos).toBeGreaterThan(-1);
      expect(toolPos).toBeGreaterThan(retractPos);
      expect(r.content).toContain('lcncgui_drill.ngc expects 11 call args');
      expect(r.content).toContain('o<lcncgui_drill> call');
      expect(r.content).toContain(
        expectedLcncguiDrillCallLine([11, 22, 10, 0, 3, 5, 120, 0, 0, 0, 0]),
      );
      expect(r.content).toContain('T2 M6');
      expect(r.content).toMatch(/T2 M6\nG43\n/);
      expect(r.content).toContain('M3 S2400');
      expect(r.content).toContain('M2');
    }
  });

  it('emits drill with dialog surfaceZ when not nested in a pattern', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          surfaceZ: '-2',
          safeZ: '8',
          depth: '5',
          vorschubHoeheMm: '3',
          x: '11',
          y: '22',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // safeZ=8, surfaceZ=-2, approach=3, depth=5
      expect(r.content).toContain(
        expectedLcncguiDrillCallLine([11, 22, 8, -2, 3, 5, 120, 0, 0, 0, 0]),
      );
    }
  });

  it('accepts legacy startZ as safe height when safeZ is absent', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          surfaceZ: '0',
          startZ: '7',
          depth: '5',
          vorschubHoeheMm: '3',
          x: '1',
          y: '2',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain(
        expectedLcncguiDrillCallLine([1, 2, 7, 0, 3, 5, 120, 0, 0, 0, 0]),
      );
    }
  });

  it('passes peck depth and chip-break retract for drill when einstechtiefe is below total depth', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm2',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '10',
          einstechtiefeMm: '3',
          vorschubHoeheMm: '3',
          x: '0',
          y: '0',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain(
        expectedLcncguiDrillCallLine([
          0, 0, 10, 0, 3, 10, 120, 3, 0, DRILL_CHIP_BREAK_RETRACT_MM, 0,
        ]),
      );
    }
  });

  it('passes full retract flag for drill pecking when fullRetract is on', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm2b',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '10',
          einstechtiefeMm: '3',
          vorschubHoeheMm: '3',
          x: '0',
          y: '0',
          coolantOn: false,
          fullRetract: true,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain(
        expectedLcncguiDrillCallLine([0, 0, 10, 0, 3, 10, 120, 3, 0, 0, 1]),
      );
    }
  });

  it('ignores fullRetract when einstechtiefe equals depth (no pecking)', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm2c',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '10',
          einstechtiefeMm: '10',
          vorschubHoeheMm: '3',
          x: '0',
          y: '0',
          coolantOn: false,
          fullRetract: true,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain(
        expectedLcncguiDrillCallLine([0, 0, 10, 0, 3, 10, 120, 10, 0, 0, 0]),
      );
    }
  });

  it('does not enable chip-break retract when einstechtiefe equals depth', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm3',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '10',
          einstechtiefeMm: '10',
          vorschubHoeheMm: '3',
          x: '1',
          y: '2',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain(
        expectedLcncguiDrillCallLine([1, 2, 10, 0, 3, 10, 120, 10, 0, 0, 0]),
      );
    }
  });

  it('emits helix bore from helix angle (pitch = π D tan(angle))', () => {
    const d = 10;
    const angleDeg = 45;
    const pitchOk = resolveHelixPitchMmPerRev(d, angleDeg);
    if (!pitchOk.ok) throw new Error('expected valid pitch');
    const expectedPitch = pitchOk.pitch;
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'h1',
        macroTypeId: BOHRFRAESEN_MACRO_ID,
        params: {
          toolId: 'helix-1',
          presetId: '',
          x: '1',
          y: '2',
          surfaceZ: 0,
          safeZ: '15',
          depth: '5',
          nominalDiameter: String(d),
          helixAngle: angleDeg,
          feedXY: '200',
          spindle: '3000',
          millingDirection: 'climb',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalHelixTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain('o<lcncgui_helix_bore> call');
      expect(r.content).toContain('T4 M6');
      expect(r.content).toMatch(/T4 M6\nG43\n/);
      expect(r.content).toContain(`[${formatGCodeNumber(expectedPitch)}]`);
    }
  });

  it('emits plan face subroutine call with cutter overhang (pattern arg reserved as 0)', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'p1',
        macroTypeId: PLAN_FRAESEN_MACRO_ID,
        params: {
          toolId: 'face-1',
          presetId: '',
          areaStartX: '0',
          areaStartY: '0',
          areaWidth: '80',
          areaHeight: '40',
          cutterOverhangMm: '2',
          surfaceZ: '0',
          vorschubHoeheMm: '5',
          targetZ: '-0.2',
          stepOver: '5',
          feedXY: '350',
          feedZ: '120',
          spindle: '3000',
          coolantOn: true,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalFaceTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain('o<lcncgui_plan_face> call');
      expect(r.content).toContain('T3 M6');
      expect(r.content).toMatch(/T3 M6\nG43\n/);
      expect(r.content).toContain('M3 S3000');
      expect(r.content).toContain('overhang=2');
      expect(r.content).toContain('[0] [0] [80] [40] [2] [0] [5]');
      expect(r.content).toMatch(/\[120\] \[0\] \[1\] \[50\]/);
    }
  });

  it('migrates legacy plan face stepDown to absolute target Z when emitting', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'p-legacy',
        macroTypeId: PLAN_FRAESEN_MACRO_ID,
        params: {
          toolId: 'face-1',
          presetId: '',
          areaStartX: '0',
          areaStartY: '0',
          areaWidth: '80',
          areaHeight: '40',
          cutterOverhangMm: '0',
          surfaceZ: '1',
          vorschubHoeheMm: '5',
          stepDown: '0.4',
          stepOver: '5',
          feedXY: '350',
          feedZ: '120',
          spindle: '3000',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalFaceTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // surfaceZ=1, stepDown=0.4 → targetZ=0.6 as call arg #8
      expect(r.content).toContain('[0] [0] [80] [40] [0] [1] [5] [0.6]');
    }
  });

  it('uses custom setup in preamble', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '5',
          vorschubHoeheMm: '3',
          x: '11',
          y: '22',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool], {
      workOffset: 'G56',
      units: 'G20',
      retractZToMachineZero: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toMatch(/G20 G90 G17 G56\nG53 G0 Z0\n/);
      const retractPos = r.content.indexOf('G53 G0 Z0');
      const callPos = r.content.indexOf('o<lcncgui_drill> call');
      expect(retractPos).toBeGreaterThan(-1);
      expect(callPos).toBeGreaterThan(retractPos);
    }
  });

  it('omits machine Z retract when disabled in setup', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '5',
          vorschubHoeheMm: '3',
          x: '11',
          y: '22',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool], {
      workOffset: 'G54',
      units: 'G21',
      retractZToMachineZero: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain('G21 G90 G17 G54');
      expect(r.content).not.toContain('G53 G0 Z0');
    }
  });

  it('retracts machine Z before a mid-queue tool change when retract is enabled', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm-drill',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '5',
          vorschubHoeheMm: '3',
          x: '11',
          y: '22',
          coolantOn: false,
        },
      },
      {
        kind: 'macro',
        id: 'm-face',
        macroTypeId: PLAN_FRAESEN_MACRO_ID,
        params: {
          toolId: 'face-1',
          presetId: '',
          areaStartX: '0',
          areaStartY: '0',
          areaWidth: '80',
          areaHeight: '40',
          cutterOverhangMm: '2',
          surfaceZ: '0',
          vorschubHoeheMm: '5',
          targetZ: '-0.2',
          stepOver: '5',
          feedXY: '350',
          feedZ: '120',
          spindle: '3000',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool, minimalFaceTool]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const retracts = [...r.content.matchAll(/G53 G0 Z0/g)];
      expect(retracts).toHaveLength(2);
      const firstTool = r.content.indexOf('T2 M6');
      const secondTool = r.content.indexOf('T3 M6');
      const preambleRetract = r.content.indexOf('G53 G0 Z0');
      const midRetract = r.content.indexOf('G53 G0 Z0', preambleRetract + 1);
      expect(preambleRetract).toBeGreaterThan(-1);
      expect(firstTool).toBeGreaterThan(preambleRetract);
      expect(midRetract).toBeGreaterThan(firstTool);
      expect(secondTool).toBeGreaterThan(midRetract);
      expect(r.content).toMatch(/T2 M6\nG43\n/);
      expect(r.content).toMatch(/T3 M6\nG43\n/);
      expect(r.content.match(/^G43$/gm)?.length).toBe(2);
    }
  });

  it('omits machine Z retract before mid-queue tool change when retract is disabled', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm-drill',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '5',
          vorschubHoeheMm: '3',
          x: '11',
          y: '22',
          coolantOn: false,
        },
      },
      {
        kind: 'macro',
        id: 'm-face',
        macroTypeId: PLAN_FRAESEN_MACRO_ID,
        params: {
          toolId: 'face-1',
          presetId: '',
          areaStartX: '0',
          areaStartY: '0',
          areaWidth: '80',
          areaHeight: '40',
          cutterOverhangMm: '2',
          surfaceZ: '0',
          vorschubHoeheMm: '5',
          targetZ: '-0.2',
          stepOver: '5',
          feedXY: '350',
          feedZ: '120',
          spindle: '3000',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool, minimalFaceTool], {
      workOffset: 'G54',
      units: 'G21',
      retractZToMachineZero: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).not.toContain('G53 G0 Z0');
      expect(r.content).toContain('T2 M6');
      expect(r.content).toContain('T3 M6');
      expect(r.content.match(/^G43$/gm)?.length).toBe(2);
    }
  });

  it('does not retract machine Z between invocations that keep the same tool', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'm1',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '5',
          vorschubHoeheMm: '3',
          x: '1',
          y: '2',
          coolantOn: false,
        },
      },
      {
        kind: 'macro',
        id: 'm2',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: {
          toolId: 'drill-1',
          presetId: '',
          spindle: '2400',
          feed: '120',
          safeZ: '10',
          depth: '5',
          vorschubHoeheMm: '3',
          x: '3',
          y: '4',
          coolantOn: false,
        },
      },
    ];
    const r = generateMacroQueueProgram(queue, [minimalDrillTool], {
      workOffset: 'G54',
      units: 'G21',
      retractZToMachineZero: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).not.toContain('G53 G0 Z0');
      expect(r.content.match(/T2 M6/g)).toHaveLength(2);
      expect(r.content.match(/^G43$/gm)?.length).toBe(2);
    }
  });
});
