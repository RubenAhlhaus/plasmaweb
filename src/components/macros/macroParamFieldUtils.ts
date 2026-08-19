import { getMacroDefinitionById } from '@/data/macroDefinitions';
import type { MacroHintDefinition } from '@/data/macroHintDefinitions';
import type { MacroParamSection } from '@/types/macros';
import type { Tool } from '@/types/tools';

export const MACRO_PARAM_FIELD_CLASS = 'min-w-0 w-full';

export type { MacroParamFieldsCommonProps, TouchNumericStackProps } from '@/types/macros';

/** Returns the field key for hint highlighting when a hint graphic exists; otherwise null. */
export function macroHintKeyForField(
  hintDefinition: MacroHintDefinition | null,
  fieldKey: string,
): string | null {
  return hintDefinition ? fieldKey : null;
}

// Re-exported from the canonical module so existing importers keep working.
export { strParam, boolParam, numParam } from '@/lib/macroParams';

export function macroToolSelectOptions(tools: Tool[]): Array<{ value: string; label: string }> {
  return tools.map((t) => ({
    value: t.id,
    label:
      t.toolNumber != null && t.toolNumber > 0
        ? `T${t.toolNumber}${t.name ? ` — ${t.name}` : ''}`
        : t.name || t.id,
  }));
}

/** Prefer explicit `paramSections` from the dialog; otherwise use the live macro definition (single source of truth). */
export function resolvedMacroParamSections(
  macroId: string,
  paramSections?: MacroParamSection[],
): MacroParamSection[] {
  if (paramSections && paramSections.length > 0) return paramSections;
  return getMacroDefinitionById(macroId)?.paramSections ?? [];
}

const PATTERN_PROVIDED_PARAM_KEYS = new Set(['x', 'y', 'surfaceZ']);

/**
 * Drop keys supplied by the parent drill pattern (hole X/Y and surface Z)
 * and remove empty sections.
 */
export function omitPatternProvidedFields(sections: MacroParamSection[]): MacroParamSection[] {
  return sections
    .map((section) => ({
      ...section,
      keys: section.keys.filter((k) => !PATTERN_PROVIDED_PARAM_KEYS.has(k)),
    }))
    .filter((section) => section.keys.length > 0);
}

/** @deprecated Prefer {@link omitPatternProvidedFields}. */
export function omitXySections(sections: MacroParamSection[]): MacroParamSection[] {
  return omitPatternProvidedFields(sections);
}
