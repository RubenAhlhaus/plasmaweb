import {
  BOHREN_NORMAL_MACRO_ID,
  BOHRFRAESEN_MACRO_ID,
  PLAN_FRAESEN_MACRO_ID,
} from '@/data/macroDefinitions';
import { emitPlanFaceInvocation } from '@/lib/macroGcode/emitPlanFace';
import { MACRO_SUBROUTINE_O_NAME, macroTypeHasSubroutine } from '@/data/macroSubroutineMap';
import {
  isUserSubroutineMacroId,
  userSubroutineNameFromMacroId,
} from '@/data/userSubroutineMacros';
import { boolParam, numParam, numSafeZParam, strParam } from '@/lib/macroParams';
import {
  resolveHelixPitchMmPerRev,
} from '@/lib/macroGcode/helixBoreAngle';
import { expandQueueToInvocations, type MacroInvocation } from '@/lib/macroGcode/expandQueue';
import { createToolEmitState, emitToolChange, type ToolEmitState } from '@/lib/macroGcode/emitToolChange';
import { formatGCodeNumber } from '@/lib/macroGcode/formatNumber';
import {
  PATTERN_SAFE_Z_KEY,
  PATTERN_SURFACE_Z_KEY,
} from '@/lib/macroGcode/patternContextKeys';
import {
  defaultSafeZAboveSurface,
  PATTERN_DEFAULT_SAFE_CLEARANCE_MM,
} from '@/lib/macroGcode/patternHeightDefaults';
import type { MacroParams, QueueItem } from '@/types/macros';
import {
  createDefaultMacroQueueProgramSetup,
  formatMacroQueueSetupGcodeLines,
  type MacroQueueProgramSetup,
} from '@/types/macroQueueSetup';
import type { Tool } from '@/types/tools';

const BR = '\n';

function patternSurfaceZ(p: MacroParams): number | null {
  const v = p[PATTERN_SURFACE_Z_KEY];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function patternSafeZ(p: MacroParams): number | null {
  const v = p[PATTERN_SAFE_Z_KEY];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function fmt(n: number): string {
  return formatGCodeNumber(n);
}

function callArgs(values: number[]): string {
  return values.map((v) => `[${fmt(v)}]`).join(' ');
}

function resolveToolNumber(tools: Tool[], toolId: string): number | null {
  if (!toolId.trim()) return null;
  const t = tools.find((x) => x.id === toolId);
  if (t == null || t.toolNumber == null || t.toolNumber <= 0) return null;
  return t.toolNumber;
}

function validateQueueStructure(items: QueueItem[]): string | null {
  for (const item of items) {
    if (item.kind === 'pattern' && item.children.length === 0) {
      return 'Pattern block has no phase macros.';
    }
    if (item.kind === 'pattern') {
      for (const child of item.children) {
        if (isUserSubroutineMacroId(child.macroTypeId)) {
          return (
            'Machine macros (INI [MACROS]) cannot be used inside a pattern block — ' +
            'move them to the root program queue.'
          );
        }
      }
    }
  }
  return null;
}

/**
 * Chip-break retract (mm) passed as subroutine **#10** when pecking (arguments satisfy 0 < #8 < #6)
 * and full retract (**#11**) is off.
 * Keep in sync with the default `1.0` in `resources/linuxcnc-subroutines/lcncgui_drill.ngc` when #10 ≤ 0.
 */
export const DRILL_CHIP_BREAK_RETRACT_MM = 1;

function emitDrillInvocation(
  params: MacroParams,
  tools: Tool[],
  lines: string[],
  errors: string[],
  toolState: ToolEmitState,
): void {
  const x = numParam(params, 'x');
  const y = numParam(params, 'y');
  const depth = numParam(params, 'depth');
  const feed = numParam(params, 'feed');
  const spindle = numParam(params, 'spindle');
  const vh = numParam(params, 'vorschubHoeheMm');
  const childSafeZ = numSafeZParam(params);
  const peckParsed = numParam(params, 'einstechtiefeMm');
  const ps = patternSurfaceZ(params);
  const pz = patternSafeZ(params);
  const paramSurfaceZ = numParam(params, 'surfaceZ');

  const surfaceZ = ps ?? paramSurfaceZ ?? 0;
  if (x === null || y === null) {
    errors.push('Drill: X and Y must be set.');
    return;
  }
  if (depth === null || depth <= 0) {
    errors.push('Drill: depth must be greater than 0.');
    return;
  }
  if (feed === null || feed <= 0) {
    errors.push('Drill: feed must be greater than 0.');
    return;
  }
  if (spindle === null || spindle <= 0) {
    errors.push('Drill: spindle speed must be greater than 0.');
    return;
  }
  if (vh === null || vh < 0) {
    errors.push('Drill: approach height (mm) must be set.');
    return;
  }

  const peckMm = peckParsed !== null && peckParsed > 0 ? peckParsed : 0;

  let safeZ: number;
  if (pz != null) {
    safeZ = pz;
  } else if (childSafeZ !== null && Number.isFinite(childSafeZ)) {
    safeZ = childSafeZ;
  } else {
    safeZ = defaultSafeZAboveSurface(surfaceZ);
  }

  const toolId = strParam(params, 'toolId');
  const tnum = resolveToolNumber(tools, toolId);
  if (toolId.trim() && tnum === null) {
    errors.push('Drill: selected tool has no valid T number.');
    return;
  }
  if (!toolId.trim()) {
    errors.push('Drill: please select a tool.');
    return;
  }

  const coolant = boolParam(params, 'coolantOn') ? 1 : 0;
  const pecking = peckMm > 0 && peckMm < depth;
  const fullRetract = pecking && boolParam(params, 'fullRetract') ? 1 : 0;
  const oName = MACRO_SUBROUTINE_O_NAME[BOHREN_NORMAL_MACRO_ID];
  const chipRetractMm = pecking && fullRetract === 0 ? DRILL_CHIP_BREAK_RETRACT_MM : 0;

  lines.push(`( Drill X${fmt(x)} Y${fmt(y)} SurfaceZ=${fmt(surfaceZ)} )`);
  emitToolChange(lines, tnum, toolState);
  lines.push(`M3 S${fmt(spindle)}`);
  lines.push(
    `o<${oName}> call ${callArgs([
      x,
      y,
      safeZ,
      surfaceZ,
      vh,
      depth,
      feed,
      peckMm,
      coolant,
      chipRetractMm,
      fullRetract,
    ])}`,
  );
  lines.push('M5');
  lines.push('');
}

function emitHelixBoreInvocation(
  params: MacroParams,
  tools: Tool[],
  lines: string[],
  errors: string[],
  toolState: ToolEmitState,
): void {
  const x = numParam(params, 'x');
  const y = numParam(params, 'y');
  const surfaceZ = numParam(params, 'surfaceZ') ?? 0;
  const childSafeZ = numSafeZParam(params);
  const depth = numParam(params, 'depth');
  const nominalDiameter = numParam(params, 'nominalDiameter');
  const feedXY = numParam(params, 'feedXY');
  const spindle = numParam(params, 'spindle');
  const millingDirection = strParam(params, 'millingDirection') || 'climb';

  if (x === null || y === null) {
    errors.push('Helix bore: X and Y must be set.');
    return;
  }
  if (depth === null || depth <= 0) {
    errors.push('Helix bore: depth must be greater than 0.');
    return;
  }
  if (nominalDiameter === null || nominalDiameter <= 0) {
    errors.push('Helix bore: diameter must be greater than 0.');
    return;
  }
  const pitchRes = resolveHelixPitchMmPerRev(nominalDiameter, params.helixAngle);
  if (!pitchRes.ok) {
    errors.push(
      pitchRes.code === 'angle_range'
        ? 'Helix bore: helix angle must be between 0° and 90° (exclusive).'
        : 'Helix bore: could not derive helix pitch from angle and diameter.',
    );
    return;
  }
  const helixPitch = pitchRes.pitch;
  if (feedXY === null || feedXY <= 0) {
    errors.push('Helix bore: XY feed must be greater than 0.');
    return;
  }
  if (spindle === null || spindle <= 0) {
    errors.push('Helix bore: spindle speed must be greater than 0.');
    return;
  }

  const ps = patternSurfaceZ(params);
  const pSafe = patternSafeZ(params);
  const effSurface = ps ?? surfaceZ;
  const bottomZ = effSurface - depth;
  const safeZ =
    pSafe ??
    (childSafeZ !== null && childSafeZ > effSurface
      ? childSafeZ
      : effSurface + Math.max(PATTERN_DEFAULT_SAFE_CLEARANCE_MM, depth * 0.5));
  const zCutStart = effSurface;
  const climb = millingDirection !== 'conventional';
  const coolant = boolParam(params, 'coolantOn') ? 1 : 0;

  const toolId = strParam(params, 'toolId');
  const tnum = resolveToolNumber(tools, toolId);
  if (toolId.trim() && tnum === null) {
    errors.push('Helix bore: selected tool has no valid T number.');
    return;
  }
  if (!toolId.trim()) {
    errors.push('Helix bore: please select a tool.');
    return;
  }

  const oName = MACRO_SUBROUTINE_O_NAME[BOHRFRAESEN_MACRO_ID];
  lines.push(`( Helix bore D${fmt(nominalDiameter)} X${fmt(x)} Y${fmt(y)} )`);
  emitToolChange(lines, tnum, toolState);
  lines.push(`M3 S${fmt(spindle)}`);
  lines.push(
    `o<${oName}> call ${callArgs([
      x,
      y,
      safeZ,
      zCutStart,
      bottomZ,
      nominalDiameter,
      helixPitch,
      feedXY,
      0,
      coolant,
      climb ? 1 : -1,
    ])}`,
  );
  lines.push('M5');
  lines.push('');
}

function emitInvocation(
  inv: MacroInvocation,
  tools: Tool[],
  lines: string[],
  errors: string[],
  toolState: ToolEmitState,
): void {
  const { macroTypeId, params } = inv;
  if (!macroTypeHasSubroutine(macroTypeId)) {
    errors.push(
      `Macro type "${macroTypeId}" has no G-code subroutine yet (see macroSubroutineMap / emitProgram).`,
    );
    return;
  }
  if (isUserSubroutineMacroId(macroTypeId)) {
    const oName = userSubroutineNameFromMacroId(macroTypeId);
    if (!oName) {
      errors.push(`Invalid user subroutine macro id "${macroTypeId}".`);
      return;
    }
    lines.push(`( user subroutine ${oName}.ngc )`);
    lines.push(`o<${oName}> call`);
    lines.push('');
    return;
  }
  if (macroTypeId === BOHREN_NORMAL_MACRO_ID) {
    emitDrillInvocation(params, tools, lines, errors, toolState);
    return;
  }
  if (macroTypeId === BOHRFRAESEN_MACRO_ID) {
    emitHelixBoreInvocation(params, tools, lines, errors, toolState);
    return;
  }
  if (macroTypeId === PLAN_FRAESEN_MACRO_ID) {
    emitPlanFaceInvocation(params, tools, lines, errors, toolState);
    return;
  }
  errors.push(`Internal error: missing emitter for "${macroTypeId}".`);
}

export type MacroQueueProgramResult =
  | { ok: true; content: string }
  | { ok: false; errors: string[] };

export function generateMacroQueueProgram(
  queue: QueueItem[],
  tools: Tool[],
  setup: MacroQueueProgramSetup = createDefaultMacroQueueProgramSetup(),
): MacroQueueProgramResult {
  const structural = validateQueueStructure(queue);
  if (structural) {
    return { ok: false, errors: [structural] };
  }
  if (queue.length === 0) {
    return { ok: false, errors: ['The program queue is empty.'] };
  }

  let invocations: MacroInvocation[];
  try {
    invocations = expandQueueToInvocations(queue);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [msg] };
  }
  const lines: string[] = [
    '( plasmaweb - generated from macro queue )',
    '( Subroutines in SUBROUTINE_PATH: lcncgui_drill.ngc expects 11 call args; lcncgui_helix_bore.ngc; lcncgui_plan_face.ngc expects 14 call args )',
    ...formatMacroQueueSetupGcodeLines(setup),
    '',
  ];
  const errors: string[] = [];
  const toolState = createToolEmitState(setup.retractZToMachineZero);
  for (const inv of invocations) {
    emitInvocation(inv, tools, lines, errors, toolState);
  }
  lines.push('M2');

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, content: lines.join(BR) };
}

export function buildGeneratedProgramFilename(): string {
  return `lcncgui_queue_${Date.now()}.ngc`;
}
