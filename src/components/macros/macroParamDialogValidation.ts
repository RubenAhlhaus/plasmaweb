import i18n from '@/i18n/config';
import {
  BOHRFRAESEN_MACRO_ID,
  PLAN_FRAESEN_MACRO_ID,
} from '@/data/macroDefinitions';
import { resolveHelixPitchMmPerRev } from '@/lib/macroGcode/helixBoreAngle';
import { parseMacroNumberStrict } from '@/lib/macroNumeric';
import { boolParam } from '@/lib/macroParams';
import type { MacroDefinition, MacroParams } from '@/types/macros';
import type { Tool } from '@/types/tools';

export type DrillSubmitResult =
  | { ok: true; resolved: MacroParams }
  | { ok: false; message: string };

export type GenericSubmitResult =
  | { ok: true; resolved: MacroParams }
  | { ok: false; message: string };

function mt(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'macros', ...options });
}

function drillNumericFieldLabel(key: string): string {
  if (key === 'depth') return mt('paramLabels.depthDrill');
  if (key === 'surfaceZ') return mt('paramLabels.surfaceZMm');
  if (key === 'safeZ') return mt('paramLabels.safeZMm');
  if (key === 'vorschubHoeheMm') return mt('paramLabels.vorschubHoeheMmDrill');
  return mt(`paramLabels.${key}`, { defaultValue: key });
}

/** Required numeric fields for drilling — same list as `validateDrillParamsForSubmit`. */
export const DRILL_NUMERIC_FIELD_KEYS = [
  'spindle',
  'feed',
  'surfaceZ',
  'safeZ',
  'depth',
  'vorschubHoeheMm',
  'x',
  'y',
] as const;

const GENERIC_REQUIRED_FIELDS: Record<string, string[]> = {
  bohrfraesen: ['toolId', 'x', 'y', 'nominalDiameter', 'depth', 'helixAngle', 'feedXY', 'spindle'],
  'gewinde-schneiden': ['toolId', 'processType', 'threadDepth', 'pitch', 'spindle'],
  taschenfraesen: ['toolId', 'pocketType', 'depth', 'stepDown', 'feedXY', 'feedZ', 'spindle'],
  kreisfraesen: ['toolId', 'diameter', 'depth', 'stepDown', 'feed', 'spindle'],
  konturfraesen: ['toolId', 'startX', 'startY', 'endX', 'endY', 'depth', 'feed', 'spindle'],
  nutfraesen: ['toolId', 'startX', 'startY', 'endX', 'endY', 'slotWidth', 'depth', 'feedXY', 'feedZ', 'spindle'],
  planfraesen: [
    'toolId',
    'areaStartX',
    'areaStartY',
    'areaWidth',
    'areaHeight',
    'cutterOverhangMm',
    'vorschubHoeheMm',
    'surfaceZ',
    'targetZ',
    'stepOver',
    'feedXY',
    'feedZ',
    'spindle',
  ],
  entgraten: ['toolId', 'pathType', 'x', 'y', 'zTop', 'feed', 'spindle'],
  gravieren: ['toolId', 'contentType', 'originX', 'originY', 'depth', 'feed', 'spindle'],
};

/** Per-macro overrides: value is suffix under `paramLabels` (e.g. `nominalDiameterBore`). */
const MACRO_PARAM_LABEL_OVERRIDES: Partial<Record<string, Record<string, string>>> = {
  [BOHRFRAESEN_MACRO_ID]: {
    nominalDiameter: 'nominalDiameterBore',
    safeZ: 'safeZMm',
  },
  [PLAN_FRAESEN_MACRO_ID]: {
    vorschubHoeheMm: 'vorschubHoeheMmPlan',
  },
};

function paramLabelForMacro(definition: MacroDefinition, key: string): string {
  const override = MACRO_PARAM_LABEL_OVERRIDES[definition.id]?.[key];
  const labelKey = override ?? key;
  return mt(`paramLabels.${labelKey}`, { defaultValue: key });
}

/**
 * Keep nested hole X/Y as stored (expansion overwrites them). Do not require or force `0`.
 */
function resolveOptionalNestedXy(params: MacroParams, key: 'x' | 'y'): string | number {
  const raw = String(params[key] ?? '').trim();
  if (raw === '') return '';
  const n = parseMacroNumberStrict(raw);
  return n !== null ? n : raw;
}

/** Single source for completeness check (OK) and commit (`handleConfirm`). */
export function validateDrillParamsForSubmit(
  params: MacroParams,
  tools: Tool[],
  xyProvidedByPattern = false,
): DrillSubmitResult {
  const toolId = String(params.toolId ?? '').trim();
  const found = tools.find((t) => t.id === toolId);
  if (!found) {
    return { ok: false, message: mt('validation.selectTool') };
  }
  const presetId = String(params.presetId ?? '').trim();
  const resolved: MacroParams = { toolId, presetId };
  for (const key of DRILL_NUMERIC_FIELD_KEYS) {
    if (xyProvidedByPattern && (key === 'x' || key === 'y')) {
      resolved[key] = resolveOptionalNestedXy(params, key);
      continue;
    }
    const label = drillNumericFieldLabel(key);
    const raw = String(params[key] ?? '').trim();
    if (raw === '') {
      return { ok: false, message: mt('validation.fillField', { field: label }) };
    }
    const n = parseMacroNumberStrict(raw);
    if (n === null) {
      return {
        ok: false,
        message: mt('validation.invalidExpression', { field: label }),
      };
    }
    resolved[key] = n;
  }
  resolved.coolantOn = boolParam(params, 'coolantOn');
  resolved.fullRetract = boolParam(params, 'fullRetract');

  const einstRaw = String(params.einstechtiefeMm ?? '').trim();
  if (einstRaw === '') {
    resolved.einstechtiefeMm = '';
  } else {
    const n = parseMacroNumberStrict(einstRaw);
    if (n === null) {
      return {
        ok: false,
        message: mt('validation.invalidPlungeExpression'),
      };
    }
    if (n <= 0) {
      return { ok: false, message: mt('validation.plungeDepthPositive') };
    }
    resolved.einstechtiefeMm = n;
  }

  return { ok: true, resolved };
}

export function validateGenericParamsForSubmit(
  definition: MacroDefinition,
  params: MacroParams,
  tools: Tool[],
  xyProvidedByPattern = false,
): GenericSubmitResult {
  const required = (GENERIC_REQUIRED_FIELDS[definition.id] ?? []).filter(
    (key) => !(xyProvidedByPattern && (key === 'x' || key === 'y')),
  );
  for (const key of required) {
    const val = params[key];
    const label = paramLabelForMacro(definition, key);
    if (val === undefined || val === null) {
      return { ok: false, message: mt('validation.fillField', { field: label }) };
    }
    if (typeof val === 'string' && val.trim() === '') {
      return { ok: false, message: mt('validation.fillField', { field: label }) };
    }
  }

  const expectsTool = required.includes('toolId');
  if (expectsTool) {
    const toolId = String(params.toolId ?? '').trim();
    const found = tools.find((t) => t.id === toolId);
    if (!found) return { ok: false, message: mt('validation.selectTool') };
  }

  const resolved: MacroParams = { ...params };
  for (const key of Object.keys(resolved)) {
    if (xyProvidedByPattern && (key === 'x' || key === 'y')) {
      resolved[key] = resolveOptionalNestedXy(params, key as 'x' | 'y');
      continue;
    }
    const defVal = definition.defaultParams[key];
    if (typeof defVal !== 'number') continue;
    const raw = resolved[key];
    const str = String(raw ?? '').trim();
    if (str === '') {
      if (required.includes(key)) {
        const label = paramLabelForMacro(definition, key);
        return { ok: false, message: mt('validation.fillField', { field: label }) };
      }
      resolved[key] = defVal;
      continue;
    }
    const n = parseMacroNumberStrict(str);
    if (n === null) {
      const label = paramLabelForMacro(definition, key);
      return {
        ok: false,
        message: mt('validation.invalidExpression', { field: label }),
      };
    }
    resolved[key] = n;
  }

  if (definition.id === PLAN_FRAESEN_MACRO_ID) {
    const surfaceZ = Number(resolved.surfaceZ);
    const targetZ = Number(resolved.targetZ);
    if (!Number.isFinite(surfaceZ) || !Number.isFinite(targetZ) || !(targetZ < surfaceZ)) {
      return { ok: false, message: mt('validation.targetZBelowSurface') };
    }
    delete resolved.stepDown;
  }

  return { ok: true, resolved };
}

export function helixBoreSubmitReady(
  definition: MacroDefinition,
  params: MacroParams,
  tools: Tool[],
  xyProvidedByPattern = false,
): boolean {
  if (definition.id !== BOHRFRAESEN_MACRO_ID) return false;
  const r = validateGenericParamsForSubmit(definition, params, tools, xyProvidedByPattern);
  if (!r.ok) return false;
  const d = Number(r.resolved.nominalDiameter);
  if (!Number.isFinite(d) || d <= 0) return false;
  return resolveHelixPitchMmPerRev(d, r.resolved.helixAngle).ok;
}
