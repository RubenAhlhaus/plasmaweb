import { describe, expect, it } from 'vitest';
import { createToolEmitState, emitToolChange } from '@/lib/macroGcode/emitToolChange';

describe('emitToolChange', () => {
  it('emits T/M6 and G43 for the first tool', () => {
    const lines: string[] = [];
    const state = createToolEmitState(true);
    emitToolChange(lines, 2, state);
    expect(lines).toEqual(['T2 M6', 'G43']);
    expect(state.lastToolNumber).toBe(2);
  });

  it('prepends G53 G0 Z0 when retract is on and the tool number changes', () => {
    const lines: string[] = [];
    const state = createToolEmitState(true);
    emitToolChange(lines, 2, state);
    emitToolChange(lines, 5, state);
    expect(lines).toEqual(['T2 M6', 'G43', 'G53 G0 Z0', 'T5 M6', 'G43']);
    expect(state.lastToolNumber).toBe(5);
  });

  it('does not retract when the same tool is selected again', () => {
    const lines: string[] = [];
    const state = createToolEmitState(true);
    emitToolChange(lines, 2, state);
    emitToolChange(lines, 2, state);
    expect(lines).toEqual(['T2 M6', 'G43', 'T2 M6', 'G43']);
  });

  it('does not retract on tool change when retractZToMachineZero is off', () => {
    const lines: string[] = [];
    const state = createToolEmitState(false);
    emitToolChange(lines, 2, state);
    emitToolChange(lines, 5, state);
    expect(lines).toEqual(['T2 M6', 'G43', 'T5 M6', 'G43']);
  });
});
