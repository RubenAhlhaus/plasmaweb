/**
 * Tracks the last tool number emitted in a generated macro-queue program so
 * mid-program tool switches can retract Z in machine coordinates first.
 */
export type ToolEmitState = {
  lastToolNumber: number | null;
  /** Same flag as program-header `retractZToMachineZero` (preamble + mid-queue). */
  retractZToMachineZero: boolean;
};

export function createToolEmitState(retractZToMachineZero = true): ToolEmitState {
  return { lastToolNumber: null, retractZToMachineZero };
}

/**
 * Emits `T… M6` then `G43` (tool length compensation — `M6` alone does not apply it).
 * When machine-Z retract is enabled and the tool number differs from a previously
 * emitted tool, prepends `G53 G0 Z0` so the spindle clears the workpiece for a
 * manual/ATC change. The first tool select does not emit this mid-queue retract
 * (the preamble already emits optional `G53 G0 Z0` when the same flag is on).
 */
export function emitToolChange(lines: string[], toolNumber: number, state: ToolEmitState): void {
  if (
    state.retractZToMachineZero &&
    state.lastToolNumber !== null &&
    state.lastToolNumber !== toolNumber
  ) {
    lines.push('G53 G0 Z0');
  }
  lines.push(`T${toolNumber} M6`);
  lines.push('G43');
  state.lastToolNumber = toolNumber;
}
