import { describe, expect, it } from 'vitest';
import { BOHREN_NORMAL_MACRO_ID } from '@/data/macroDefinitions';
import { expandQueueToInvocations } from '@/lib/macroGcode/expandQueue';
import {
  PATTERN_SAFE_Z_KEY,
  PATTERN_SURFACE_Z_KEY,
} from '@/lib/macroGcode/patternContextKeys';
import type { MacroParams, QueueItem } from '@/types/macros';

describe('expandQueueToInvocations', () => {
  it('expands pattern as phase × position', () => {
    const patternParams: MacroParams = {
      patternType: 'cartesian',
      startX: 0,
      startY: 0,
      spacingX: 10,
      spacingY: 0,
      columns: 2,
      rows: 1,
      rotationAngle: 0,
      safeZ: 10,
      surfaceZ: 0,
    };
    const queue: QueueItem[] = [
      {
        kind: 'pattern',
        id: 'p1',
        params: patternParams,
        children: [
          {
            kind: 'macro',
            id: 'm1',
            macroTypeId: BOHREN_NORMAL_MACRO_ID,
            params: { depth: '5', x: '0', y: '0' } as MacroParams,
          },
          {
            kind: 'macro',
            id: 'm2',
            macroTypeId: BOHREN_NORMAL_MACRO_ID,
            params: { depth: '8', x: '0', y: '0' } as MacroParams,
          },
        ],
      },
    ];
    const inv = expandQueueToInvocations(queue);
    expect(inv).toHaveLength(4);
    expect(inv[0].macroTypeId).toBe(BOHREN_NORMAL_MACRO_ID);
    expect(inv[0].params.x).toBe('0');
    expect(inv[0].params[PATTERN_SURFACE_Z_KEY]).toBe(0);
    expect(inv[0].params[PATTERN_SAFE_Z_KEY]).toBe(10);
    expect(inv[1].params.x).toBe('10');
    expect(inv[2].params.x).toBe('0');
    expect(inv[2].params.depth).toBe('8');
    expect(inv[3].params.x).toBe('10');
  });

  it('omits pattern safe Z when the pattern has no safeZ (child safeZ is used)', () => {
    const queue: QueueItem[] = [
      {
        kind: 'pattern',
        id: 'p1',
        params: {
          patternType: 'rectangular',
          startX: 0,
          startY: 0,
          spacingX: 10,
          spacingY: 0,
          columns: 1,
          rows: 1,
          rotationAngle: 0,
          surfaceZ: -1.5,
        },
        children: [
          {
            kind: 'macro',
            id: 'm1',
            macroTypeId: BOHREN_NORMAL_MACRO_ID,
            params: { depth: '5', safeZ: '8', x: '0', y: '0' } as MacroParams,
          },
        ],
      },
    ];
    const inv = expandQueueToInvocations(queue);
    expect(inv).toHaveLength(1);
    expect(inv[0].params[PATTERN_SURFACE_Z_KEY]).toBe(-1.5);
    expect(inv[0].params[PATTERN_SAFE_Z_KEY]).toBeUndefined();
    expect(inv[0].params.safeZ).toBe('8');
  });

  it('root macro stays single invocation', () => {
    const queue: QueueItem[] = [
      {
        kind: 'macro',
        id: 'r1',
        macroTypeId: BOHREN_NORMAL_MACRO_ID,
        params: { x: '1', y: '2' } as MacroParams,
      },
    ];
    expect(expandQueueToInvocations(queue)).toHaveLength(1);
  });
});
