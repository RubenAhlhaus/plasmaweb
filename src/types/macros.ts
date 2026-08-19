/** Parameter set for a macro entry (tool, feed, etc.) */
export type MacroParams = Record<string, string | number | boolean>;

/** Escape-stack hook passed from macro dialogs into numeric sub-dialogs. */
export type TouchNumericStackProps = {
  onDialogOpenChange?: (open: boolean) => void;
};

/**
 * Groups parameter keys under a dialog subheading. Order within `keys` is display order.
 * Keys not listed in any section still appear at the end of generic macro dialogs, in the same
 * order as the visible parameter entries (typically `Object.entries` / state merge order), without an extra heading.
 */
export interface MacroParamSection {
  /**
   * i18n key under the `macros` namespace (e.g. `sections.tool`). Empty string = group fields
   * without showing a heading row.
   */
  headingKey: string;
  keys: string[];
}

/** Shared props for drill / face-milling / helical-bore macro param field components. */
export type MacroParamFieldsCommonProps = {
  macroId: string;
  paramSections?: MacroParamSection[];
  tools: import('@/types/tools').Tool[];
  params: MacroParams;
  setParams: (next: MacroParams | ((prev: MacroParams) => MacroParams)) => void;
  setCommitError: (msg: string | null) => void;
  touchNumericStackProps?: TouchNumericStackProps;
  /**
   * Phase inside a drill pattern: hole X/Y come from the parent pattern at expand time.
   * Hide those fields and show a short notice instead.
   */
  xyProvidedByPattern?: boolean;
};

/** Internal macro category id (displayed via i18n). */
export type MacroCategoryId = 'drilling' | 'milling' | 'machine';

/** Definition of a macro type (left tiles) */
export interface MacroDefinition {
  id: string;
  category: MacroCategoryId;
  /**
   * i18n key under `macros` (e.g. `definitions.bohren-normal.title`).
   * Omit when `title` / `subtitle` literals are set (user `.ngc` macros).
   */
  titleKey?: string;
  subtitleKey?: string;
  /** Literal title (user subroutine macros from SUBROUTINE_PATH). */
  title?: string;
  /** Literal subtitle (e.g. `go_home.ngc`). */
  subtitle?: string;
  defaultParams: MacroParams;
  /** Optional section headings in the parameter dialog (per macro). */
  paramSections?: MacroParamSection[];
}

/** Single macro — also as a phase inside a nested pattern block */
export interface MacroQueueItem {
  id: string;
  kind: 'macro';
  macroTypeId: string;
  params: MacroParams;
}

/**
 * Nested pattern block: G-code expansion runs **each** child (phase) at **all** pattern
 * positions in order (phase × position), e.g. all spot drills on every hole, then all through-drills.
 */
export interface PatternQueueItem {
  id: string;
  kind: 'pattern';
  params: MacroParams;
  children: MacroQueueItem[];
}

export type QueueItem = MacroQueueItem | PatternQueueItem;
