/** User `.ngc` macros from INI `[MACROS]` (Macros screen tiles). */

import type { MacroDefinition } from '@/types/macros';

/**
 * Prefix for queue / tile ids: `user-ngc-<o-name>`.
 * No `:` so `data-e2e` / CSS selectors stay simple.
 */
export const USER_SUBROUTINE_MACRO_ID_PREFIX = 'user-ngc-';

export type UserSubroutineMacroInfo = {
  /** O-word name (= file stem), e.g. `go_home`. */
  name: string;
  /** Basename including `.ngc`. */
  fileName: string;
  /** Absolute path on the control PC (informational). */
  path?: string;
};

export function isUserSubroutineMacroId(macroTypeId: string): boolean {
  return macroTypeId.startsWith(USER_SUBROUTINE_MACRO_ID_PREFIX);
}

export function userSubroutineMacroId(name: string): string {
  return `${USER_SUBROUTINE_MACRO_ID_PREFIX}${name}`;
}

export function userSubroutineNameFromMacroId(macroTypeId: string): string | null {
  if (!isUserSubroutineMacroId(macroTypeId)) return null;
  const name = macroTypeId.slice(USER_SUBROUTINE_MACRO_ID_PREFIX.length).trim();
  return name || null;
}

export function userSubroutineDefinitionFromInfo(info: UserSubroutineMacroInfo): MacroDefinition {
  return {
    id: userSubroutineMacroId(info.name),
    category: 'machine',
    title: info.name,
    subtitle: info.fileName,
    defaultParams: {},
  };
}

/** Synthetic definition when the file list is gone but a queue entry remains. */
export function userSubroutineDefinitionFromMacroId(macroTypeId: string): MacroDefinition | undefined {
  const name = userSubroutineNameFromMacroId(macroTypeId);
  if (!name) return undefined;
  return userSubroutineDefinitionFromInfo({ name, fileName: `${name}.ngc` });
}
