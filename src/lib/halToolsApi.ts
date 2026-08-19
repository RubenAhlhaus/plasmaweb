import halToolIds from '../../resources/hal-tool-ids.json';

/** Shared with `resources/hal-tool-ids.json` / `backend/hal_tools.py`. */
export const HAL_TOOL_IDS = halToolIds as readonly [
  'classicladder',
  'halscope',
  'linuxcnctop',
  'halmeter',
  'hal_calibration',
  'halshow',
];

export type HalToolId = (typeof HAL_TOOL_IDS)[number];

export const HAL_TOOL_ERROR_CODES = [
  'halshow_unavailable',
  'halmeter_unavailable',
  'halscope_unavailable',
  'linuxcnctop_unavailable',
  'hal_calibration_unavailable',
  'ini_path_unavailable',
  'classicladder_unavailable',
  'display_unavailable',
  'launch_failed',
  'network_error',
] as const;

export type HalToolErrorCode = (typeof HAL_TOOL_ERROR_CODES)[number];

export type HalToolLaunchResult =
  | { ok: true }
  | { ok: false; code?: HalToolErrorCode | string; message?: string };

export async function launchHalTool(tool: HalToolId): Promise<HalToolLaunchResult> {
  try {
    const response = await fetch('/api/hal-tools/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool }),
    });
    if (response.ok) return { ok: true };
    let code: string | undefined;
    let message: string | undefined;
    try {
      const raw: unknown = await response.json();
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        const detail = (raw as { detail?: unknown }).detail;
        if (typeof detail === 'string') {
          message = detail;
        } else if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
          const obj = detail as { code?: unknown; message?: unknown };
          if (typeof obj.code === 'string') code = obj.code;
          if (typeof obj.message === 'string') message = obj.message;
        }
      }
    } catch {
      // ignore JSON parse errors
    }
    return { ok: false, code, message };
  } catch (e) {
    return {
      ok: false,
      code: 'network_error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
