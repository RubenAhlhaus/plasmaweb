import { useTranslation } from 'react-i18next';
import type { MacroDefinition } from '@/types/macros';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/** Resolve tile / queue title for built-in (i18n) or user (literal) macros. */
export function macroDefinitionTitle(definition: MacroDefinition, t: TranslateFn): string {
  if (definition.title != null && definition.title !== '') return definition.title;
  if (definition.titleKey) return t(definition.titleKey);
  return definition.id;
}

export function macroDefinitionSubtitle(definition: MacroDefinition, t: TranslateFn): string {
  if (definition.subtitle != null && definition.subtitle !== '') return definition.subtitle;
  if (definition.subtitleKey) return t(definition.subtitleKey);
  return '';
}

/** Hook-friendly wrappers (same as helpers; keeps MacroTile concise). */
export function useMacroDefinitionLabels(definition: MacroDefinition) {
  const { t } = useTranslation('macros');
  return {
    title: macroDefinitionTitle(definition, t),
    subtitle: macroDefinitionSubtitle(definition, t),
  };
}

