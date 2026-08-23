import { PLAN_FRAESEN_MACRO_ID } from '@/data/macroDefinitions';
import { MACRO_SUBROUTINE_O_NAME } from '@/data/macroSubroutineMap';
import { boolParam, numParam, strParam } from '@/lib/macroParams';
import { emitToolChange, createToolEmitState, type ToolEmitState } from '@/lib/macroGcode/emitToolChange';
import { formatGCodeNumber } from '@/lib/macroGcode/formatNumber';
import { resolvePlanFaceTargetZ } from '@/lib/macroGcode/planFaceHeights';
import type { MacroParams } from '@/types/macros';
import type { Tool } from '@/types/tools';

/**
 * LinuxCNC subroutine `o<lcncgui_plan_face> call` — parameter order must stay in sync
 * with `lcncgui_plan_face.ngc`.
 *
 * #1  areaStartX (mm)
 * #2  areaStartY (mm)
 * #3  areaWidth (mm)
 * #4  areaHeight (mm)
 * #5  cutterOverhangMm (mm)
 * #6  surfaceZ (absolute, mm) — current stock top
 * #7  vorschubHoeheMm — clearance above workpiece surface before engaging (mm)
 * #8  targetZ (absolute, mm) — finished face / cut height
 * #9  stepOver (mm)
 * #10 feedXY (mm/min)
 * #11 feedZ (mm/min)
 * #12 reserved (0) — future Bahnmuster / toolpath pattern (not in GUI yet)
 * #13 coolant: >0.5 → M8 in subroutine (optional; main may still set M3)
 * #14 tool diameter (mm) when the selected tool has `diameter` in plasmaweb; else 0
 *     (subroutine falls back to #9/0.45 for effective tool diameter)
 */
export const PLAN_FACE_SUB_O_NAME = MACRO_SUBROUTINE_O_NAME[PLAN_FRAESEN_MACRO_ID];

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

export function emitPlanFaceInvocation(
  params: MacroParams,
  tools: Tool[],
  lines: string[],
  errors: string[],
  toolState: ToolEmitState = createToolEmitState(),
): void {
  const areaStartX = numParam(params, 'areaStartX');
  const areaStartY = numParam(params, 'areaStartY');
  const areaWidth = numParam(params, 'areaWidth');
  const areaHeight = numParam(params, 'areaHeight');
  const cutterOverhangMm = numParam(params, 'cutterOverhangMm');
  const surfaceZ = numParam(params, 'surfaceZ');
  const vorschubHoeheMm = numParam(params, 'vorschubHoeheMm');
  const stepOver = numParam(params, 'stepOver');
  const feedXY = numParam(params, 'feedXY');
  const feedZ = numParam(params, 'feedZ');
  const spindle = numParam(params, 'spindle');

  if (areaStartX === null || areaStartY === null) {
    errors.push('Plan face: area start X and Y must be set.');
    return;
  }
  if (areaWidth === null || areaWidth <= 0) {
    errors.push('Plan face: area width must be greater than 0.');
    return;
  }
  if (areaHeight === null || areaHeight <= 0) {
    errors.push('Plan face: area height must be greater than 0.');
    return;
  }
  if (cutterOverhangMm === null || cutterOverhangMm < 0) {
    errors.push('Plan face: cutter overhang (mm) must be set and not negative.');
    return;
  }
  if (surfaceZ === null || !Number.isFinite(surfaceZ)) {
    errors.push('Plan face: surface Z must be set.');
    return;
  }
  if (vorschubHoeheMm === null || vorschubHoeheMm < 0) {
    errors.push('Plan face: approach height (mm) must be set and not negative.');
    return;
  }
  const targetZ = resolvePlanFaceTargetZ(params, surfaceZ);
  if (targetZ === null || !Number.isFinite(targetZ)) {
    errors.push('Plan face: target Z must be set.');
    return;
  }
  if (!(targetZ < surfaceZ)) {
    errors.push('Plan face: target Z must be below surface Z.');
    return;
  }
  if (stepOver === null || stepOver <= 0) {
    errors.push('Plan face: step over must be greater than 0.');
    return;
  }
  if (feedXY === null || feedXY <= 0) {
    errors.push('Plan face: XY feed must be greater than 0.');
    return;
  }
  if (feedZ === null || feedZ <= 0) {
    errors.push('Plan face: Z feed must be greater than 0.');
    return;
  }
  if (spindle === null || spindle <= 0) {
    errors.push('Plan face: spindle speed must be greater than 0.');
    return;
  }

  const toolId = strParam(params, 'toolId');
  const found = tools.find((x) => x.id === toolId);
  const tnum = resolveToolNumber(tools, toolId);
  if (toolId.trim() && tnum === null) {
    errors.push('Plan face: selected tool has no valid T number.');
    return;
  }
  if (!toolId.trim()) {
    errors.push('Plan face: please select a tool.');
    return;
  }

  const toolDiameterMm =
    found != null &&
    found.diameter != null &&
    Number.isFinite(found.diameter) &&
    found.diameter > 0
      ? found.diameter
      : 0;

  const coolant = boolParam(params, 'coolantOn') ? 1 : 0;
  const oName = PLAN_FACE_SUB_O_NAME;
  const patternReserved = 0;

  lines.push(
    `( Plan face X${fmt(areaStartX)} Y${fmt(areaStartY)} W${fmt(areaWidth)} H${fmt(areaHeight)} overhang=${fmt(cutterOverhangMm)} )`,
  );
  emitToolChange(lines, tnum, toolState);
  lines.push(`M3 S${fmt(spindle)}`);
  lines.push(
    `o<${oName}> call ${callArgs([
      areaStartX,
      areaStartY,
      areaWidth,
      areaHeight,
      cutterOverhangMm,
      surfaceZ,
      vorschubHoeheMm,
      targetZ,
      stepOver,
      feedXY,
      feedZ,
      patternReserved,
      coolant,
      toolDiameterMm,
    ])}`,
  );
  lines.push('M5');
  lines.push('');
}
