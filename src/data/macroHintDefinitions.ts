import {
  BOHREN_NORMAL_MACRO_ID,
  BOHRFRAESEN_MACRO_ID,
  PLAN_FRAESEN_MACRO_ID,
} from '@/data/macroDefinitions';

/**
 * Hint graphic per macro: one SVG under `public/macro/`, driven by `data-active` on the root
 * `<svg>` (param field key, e.g. `depth`). `sidebarWidthClass` is set as CSS variable
 * `--macro-hint-sidebar` (see DrillMacroParamFields).
 */
export type MacroHintDefinition = {
  svgPath: string;
  /** i18n key under the `macros` namespace (e.g. `hints.bohren-normal`). */
  ariaLabelKey: string;
  sidebarWidthClass: string;
};

const MACRO_HINT_DEFINITIONS: Record<string, MacroHintDefinition> = {
  [BOHREN_NORMAL_MACRO_ID]: {
    svgPath: '/macro/bohrmakro.svg',
    ariaLabelKey: 'hints.bohren-normal',
    sidebarWidthClass: '24rem',
  },
  [PLAN_FRAESEN_MACRO_ID]: {
    svgPath: '/macro/planen.svg',
    ariaLabelKey: 'hints.planfraesen',
    sidebarWidthClass: '22rem',
  },
  [BOHRFRAESEN_MACRO_ID]: {
    svgPath: '/macro/bohrfraesen.svg',
    ariaLabelKey: 'hints.bohrfraesen',
    sidebarWidthClass: '22rem',
  },
};

export function getMacroHintDefinition(macroId: string): MacroHintDefinition | null {
  return MACRO_HINT_DEFINITIONS[macroId] ?? null;
}
