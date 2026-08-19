import { describe, expect, it } from 'vitest';
import {
  buildPatternPreviewParams,
  expandPatternPositions,
  MAX_PATTERN_POSITIONS,
} from '@/lib/macroGcode/expandPatternPositions';
import type { MacroParams } from '@/types/macros';

describe('expandPatternPositions', () => {
  it('cartesian 2x2 without rotation', () => {
    const p: MacroParams = {
      patternType: 'cartesian',
      startX: 10,
      startY: 20,
      spacingX: 5,
      spacingY: 7,
      columns: 2,
      rows: 2,
      rotationAngle: 0,
    };
    const pts = expandPatternPositions(p);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: 10, y: 20 });
    expect(pts[1]).toEqual({ x: 15, y: 20 });
    expect(pts[2]).toEqual({ x: 10, y: 27 });
    expect(pts[3]).toEqual({ x: 15, y: 27 });
  });

  it('polar full circle uses equal spacing by count with 0° at +Y', () => {
    const p: MacroParams = {
      patternType: 'polar',
      centerX: 0,
      centerY: 0,
      pitchCircleDiameter: 100,
      startAngle: 0,
      endAngle: 360,
      count: 4,
      stepAngle: 0,
    };
    const pts = expandPatternPositions(p);
    expect(pts).toHaveLength(4);
    // 0° = above centre (+Y), then CCW: −X, −Y, +X
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[0].y).toBeCloseTo(50, 5);
    expect(pts[1].x).toBeCloseTo(-50, 5);
    expect(pts[1].y).toBeCloseTo(0, 5);
  });

  it('rectangular matches cartesian expansion', () => {
    const p: MacroParams = {
      patternType: 'rectangular',
      startX: 1,
      startY: 2,
      spacingX: 3,
      spacingY: 4,
      columns: 2,
      rows: 2,
      rotationAngle: 0,
    };
    const q: MacroParams = { ...p, patternType: 'cartesian' };
    expect(expandPatternPositions(p)).toEqual(expandPatternPositions(q));
  });

  it('custom list expands to points', () => {
    const p: MacroParams = {
      patternType: 'custom',
      customPatternPoints: '[{"x":1,"y":2},{"x":3,"y":4}]',
    };
    expect(expandPatternPositions(p)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('custom list ignores stable id field on points', () => {
    const p: MacroParams = {
      patternType: 'custom',
      customPatternPoints: '[{"id":"a","x":1,"y":2},{"id":"b","x":3,"y":4}]',
    };
    expect(expandPatternPositions(p)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('custom rejects empty customPatternPoints', () => {
    expect(() =>
      expandPatternPositions({ patternType: 'custom', customPatternPoints: '' } as MacroParams),
    ).toThrow(/empty/);
  });

  it('custom rejects invalid JSON', () => {
    expect(() =>
      expandPatternPositions({ patternType: 'custom', customPatternPoints: '{' } as MacroParams),
    ).toThrow(/not valid JSON/);
  });

  it('custom rejects non-array JSON', () => {
    expect(() =>
      expandPatternPositions({ patternType: 'custom', customPatternPoints: '{}' } as MacroParams),
    ).toThrow(/array/);
  });

  it('custom rejects empty array', () => {
    expect(() =>
      expandPatternPositions({ patternType: 'custom', customPatternPoints: '[]' } as MacroParams),
    ).toThrow(/at least one position/);
  });

  it('custom rejects non-object row', () => {
    expect(() =>
      expandPatternPositions({ patternType: 'custom', customPatternPoints: '[1]' } as MacroParams),
    ).toThrow(/object with x and y/);
  });

  it('round uses full circle by count with first hole at +Y for startAngle 0', () => {
    const p: MacroParams = {
      patternType: 'round',
      centerX: 0,
      centerY: 0,
      pitchCircleDiameter: 100,
      startAngle: 0,
      count: 4,
    };
    const pts = expandPatternPositions(p);
    expect(pts).toHaveLength(4);
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[0].y).toBeCloseTo(50, 5);
  });

  it('round startAngle rotates entire circle with equal angular spacing', () => {
    const p: MacroParams = {
      patternType: 'round',
      centerX: 0,
      centerY: 0,
      pitchCircleDiameter: 100,
      startAngle: 10,
      count: 5,
    };
    const pts = expandPatternPositions(p);
    expect(pts).toHaveLength(5);
    const r = 50;
    // Documented convention: 0° = +Y, CCW → x = −r·sin(θ), y = r·cos(θ)
    const expected = [10, 82, 154, 226, 298].map((angDeg) => {
      const a = (angDeg * Math.PI) / 180;
      return { x: -r * Math.sin(a), y: r * Math.cos(a) };
    });
    for (let i = 0; i < 5; i++) {
      expect(pts[i].x).toBeCloseTo(expected[i].x, 5);
      expect(pts[i].y).toBeCloseTo(expected[i].y, 5);
    }
  });

  it('round startAngle 0 keeps first hole above centre for any count', () => {
    for (const count of [3, 5, 6, 8]) {
      const pts = expandPatternPositions({
        patternType: 'round',
        centerX: 10,
        centerY: 20,
        pitchCircleDiameter: 40,
        startAngle: 0,
        count,
      });
      expect(pts[0].x).toBeCloseTo(10, 5);
      expect(pts[0].y).toBeCloseTo(40, 5);
    }
  });

  it('rejects cartesian grids larger than MAX_PATTERN_POSITIONS', () => {
    const n = Math.ceil(Math.sqrt(MAX_PATTERN_POSITIONS)) + 2;
    const p: MacroParams = {
      patternType: 'cartesian',
      startX: 0,
      startY: 0,
      spacingX: 1,
      spacingY: 1,
      columns: n,
      rows: n,
      rotationAngle: 0,
    };
    expect(() => expandPatternPositions(p)).toThrow(/more than/);
  });
});

describe('buildPatternPreviewParams', () => {
  it('overlays a parsed macro draft onto a copy', () => {
    const base: MacroParams = {
      patternType: 'rectangular',
      startX: 0,
      startY: 0,
      spacingX: 10,
      spacingY: 10,
      columns: 2,
      rows: 1,
      rotationAngle: 0,
    };
    const live = { kind: 'macro' as const, field: 'startX', draft: '5+5' };
    const merged = buildPatternPreviewParams(base, live);
    expect(merged.startX).toBe('10');
    expect(expandPatternPositions(merged)[0].x).toBe(10);
  });

  it('falls back to base when macro draft is not yet a valid expression', () => {
    const base: MacroParams = {
      patternType: 'rectangular',
      startX: 3,
      startY: 0,
      spacingX: 1,
      spacingY: 1,
      columns: 1,
      rows: 1,
      rotationAngle: 0,
    };
    const merged = buildPatternPreviewParams(base, { kind: 'macro', field: 'startX', draft: '1+' });
    expect(merged).toBe(base);
  });

  it('returns base by reference for macro live draft that is only whitespace', () => {
    const base: MacroParams = {
      patternType: 'rectangular',
      startX: 3,
      startY: 0,
      spacingX: 1,
      spacingY: 1,
      columns: 1,
      rows: 1,
      rotationAngle: 0,
    };
    const merged = buildPatternPreviewParams(base, { kind: 'macro', field: 'startX', draft: '   \n' });
    expect(merged).toBe(base);
  });

  it('overlays a custom row axis from draft', () => {
    const base: MacroParams = {
      patternType: 'custom',
      customPatternPoints: '[{"id":"r1","x":0,"y":0},{"id":"r2","x":10,"y":10}]',
    };
    const merged = buildPatternPreviewParams(base, {
      kind: 'custom',
      rowId: 'r2',
      axis: 'x',
      draft: '20',
    });
    expect(expandPatternPositions(merged)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 10 },
    ]);
  });

  it('uses committed coordinate when custom live draft for axis is empty', () => {
    const base: MacroParams = {
      patternType: 'custom',
      customPatternPoints: '[{"id":"r1","x":5,"y":6}]',
    };
    const merged = buildPatternPreviewParams(base, {
      kind: 'custom',
      rowId: 'r1',
      axis: 'x',
      draft: '',
    });
    expect(expandPatternPositions(merged)).toEqual([{ x: 5, y: 6 }]);
  });
});
