import {
  BOHREN_NORMAL_MACRO_ID,
  BOHRFRAESEN_MACRO_ID,
  PLAN_FRAESEN_MACRO_ID,
} from '@/data/macroDefinitions';
import { isUserSubroutineMacroId } from '@/data/userSubroutineMacros';

/** O-word name equals the file name without `.ngc` (LinuxCNC `SUBROUTINE_PATH`). */
export const MACRO_SUBROUTINE_O_NAME: Record<string, string> = {
  [BOHREN_NORMAL_MACRO_ID]: 'lcncgui_drill',
  [BOHRFRAESEN_MACRO_ID]: 'lcncgui_helix_bore',
  [PLAN_FRAESEN_MACRO_ID]: 'lcncgui_plan_face',
};

export const MACRO_TYPES_WITH_GCODE_SUPPORT: ReadonlySet<string> = new Set(
  Object.keys(MACRO_SUBROUTINE_O_NAME),
);

export function macroTypeHasSubroutine(macroTypeId: string): boolean {
  return MACRO_TYPES_WITH_GCODE_SUPPORT.has(macroTypeId) || isUserSubroutineMacroId(macroTypeId);
}
