import type { MacroParams, PatternQueueItem, QueueItem } from '@/types/macros';
import { expandPatternPositions, type PatternPoint } from '@/lib/macroGcode/expandPatternPositions';
import { parseMacroNumberWithDefault } from '@/lib/macroNumeric';
import {
  PATTERN_SAFE_Z_KEY,
  PATTERN_SURFACE_Z_KEY,
} from '@/lib/macroGcode/patternContextKeys';
import { readOptionalPatternSafeZ } from '@/lib/macroGcode/patternHeightDefaults';

/** One flattened macro invocation after pattern expansion (phase × position). */
export type MacroInvocation = {
  macroTypeId: string;
  params: MacroParams;
};

function mergeXYIntoParams(base: MacroParams, pt: PatternPoint): MacroParams {
  return {
    ...base,
    x: formatMergeCoord(base.x, pt.x),
    y: formatMergeCoord(base.y, pt.y),
  };
}

function formatMergeCoord(_prev: string | number | boolean | undefined, v: number): string {
  return String(v);
}

/**
 * Nested pattern: for each phase (child order), for each pattern position — batch-friendly tool use.
 * @see src/lib/macroQueueDrag.ts
 */
export function expandPatternBlock(pattern: PatternQueueItem): MacroInvocation[] {
  const positions = expandPatternPositions(pattern.params);
  const surfaceZ = patternParamNumber(pattern.params, 'surfaceZ', 0);
  const safeZ = readOptionalPatternSafeZ(pattern.params);
  const out: MacroInvocation[] = [];
  for (const child of pattern.children) {
    for (const pt of positions) {
      out.push({
        macroTypeId: child.macroTypeId,
        params: withPatternContext(mergeXYIntoParams(child.params, pt), surfaceZ, safeZ),
      });
    }
  }
  return out;
}

function patternParamNumber(params: MacroParams, key: string, fallback: number): number {
  return parseMacroNumberWithDefault(params[key], fallback);
}

/** Attach pattern Z context for emitters (string keys for consistency). */
function withPatternContext(
  params: MacroParams,
  surfaceZ: number,
  safeZ: number | null,
): MacroParams {
  const next: MacroParams = {
    ...params,
    [PATTERN_SURFACE_Z_KEY]: surfaceZ,
  };
  if (safeZ !== null) {
    next[PATTERN_SAFE_Z_KEY] = safeZ;
  }
  return next;
}

export function expandQueueToInvocations(items: QueueItem[]): MacroInvocation[] {
  const out: MacroInvocation[] = [];
  for (const item of items) {
    if (item.kind === 'pattern') {
      out.push(...expandPatternBlock(item));
    } else {
      out.push({ macroTypeId: item.macroTypeId, params: { ...item.params } });
    }
  }
  return out;
}
