/** Work coordinate system selection for generated macro programs (LinuxCNC). */
export const MACRO_QUEUE_WORK_OFFSETS = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'] as const;
export type MacroQueueWorkOffset = (typeof MACRO_QUEUE_WORK_OFFSETS)[number];

/** Fixed “program header” settings (session store); not part of `macroQueueItems`. */
export interface MacroQueueProgramSetup {
  workOffset: MacroQueueWorkOffset;
  units: 'G20' | 'G21';
  /** When true, emit `G53 G0 Z0` after the preamble and before mid-queue tool changes. Default on. */
  retractZToMachineZero: boolean;
}

export function createDefaultMacroQueueProgramSetup(): MacroQueueProgramSetup {
  return {
    workOffset: 'G54',
    units: 'G21',
    retractZToMachineZero: true,
  };
}

/** Preamble lines: units, absolute mode, XY plane, WCS; optional machine-Z retract (also gates mid-queue tool-change clearance). */
export function formatMacroQueueSetupGcodeLines(setup: MacroQueueProgramSetup): string[] {
  const lines = [`${setup.units} G90 G17 ${setup.workOffset}`];
  if (setup.retractZToMachineZero) {
    lines.push('G53 G0 Z0');
  }
  return lines;
}

/** Summary / joined form of {@link formatMacroQueueSetupGcodeLines}. */
export function formatMacroQueueSetupGcode(setup: MacroQueueProgramSetup): string {
  return formatMacroQueueSetupGcodeLines(setup).join('\n');
}
