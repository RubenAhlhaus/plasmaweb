/**
 * WebSocket command: update one row in the LinuxCNC tool table (file + reload — backend).
 * @see docs/commands-events.md — `tool.update_tool_table_row`
 */
export const TOOL_UPDATE_TOOL_TABLE_ROW_ACTION = 'update_tool_table_row' as const;

/** Remove the last matching `T… P…` line for `toolno`, then reload the table. */
export const TOOL_DELETE_TOOL_TABLE_ROW_ACTION = 'delete_tool_table_row' as const;

/** Append a new row if `toolno` is not yet in the file, then reload. */
export const TOOL_ADD_TOOL_TABLE_ROW_ACTION = 'add_tool_table_row' as const;

/** Gmoccapy-style tool touch-off: backend runs ``G10 L10`` (+ optional ``G43``). */
export const TOOL_TOUCH_OFF_ACTION = 'touch_off' as const;

/** Params use the same snake_case keys as `LinuxCncToolTableRow` / status snapshot. */
export type UpdateToolTableRowParams = {
  toolno: number;
  /** Neue T-Nummer; `toolno` bleibt die bisherige Zeile (Backend: `.tbl` + Sidecar-Key). */
  new_toolno?: number;
  pocket?: number;
  diameter?: number;
  xoffset?: number;
  yoffset?: number;
  zoffset?: number;
  aoffset?: number;
  boffset?: number;
  coffset?: number;
  uoffset?: number;
  voffset?: number;
  woffset?: number;
  frontangle?: number;
  backangle?: number;
  orientation?: number;
  /** Kurzkommentar in der `.tbl`-Zeile (optional; meist aus `lcncgui_meta.name` abgeleitet). */
  comment?: string;
  /** lcncgui-Werkzeugbibliothek (Datei ``<tooltable>.lcncgui-tools.json``). */
  lcncgui_meta?: Record<string, string | number | undefined>;
  lcncgui_presets?: Record<string, string | number | boolean | undefined>[];
};
