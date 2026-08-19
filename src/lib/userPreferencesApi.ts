export type UserPreferences = {
  kioskMode: boolean | null;
  runLinuxCncAtStartup: boolean;
  linuxCncIniPath: string | null;
  toolInSpindle: number;
  reloadToolOnStartup: boolean;
};

export type UserPreferencesFetchResult =
  | { ok: true; preferences: UserPreferences }
  | { ok: false };

export type LinuxCncAutostartSaveResult =
  | { ok: true; linuxCncIniPath: string | null }
  | { ok: false; code?: string; message?: string };

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return null;
}

function parseUserPreferences(raw: unknown): UserPreferences | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const kioskMode = obj.kioskMode;
  if (kioskMode !== null && typeof kioskMode !== 'boolean') return null;
  const runLinuxCncAtStartup = obj.runLinuxCncAtStartup;
  if (typeof runLinuxCncAtStartup !== 'boolean') return null;
  const linuxCncIniPath = obj.linuxCncIniPath;
  if (linuxCncIniPath !== null && typeof linuxCncIniPath !== 'string') return null;
  // New fields: default when missing so older backends still load kiosk/autostart.
  const toolInSpindleRaw = obj.toolInSpindle;
  const toolInSpindle =
    toolInSpindleRaw === undefined ? 0 : parseNonNegativeInt(toolInSpindleRaw);
  if (toolInSpindle == null) return null;
  const reloadRaw = obj.reloadToolOnStartup;
  let reloadToolOnStartup = true;
  if (reloadRaw !== undefined) {
    if (typeof reloadRaw !== 'boolean') return null;
    reloadToolOnStartup = reloadRaw;
  }
  return {
    kioskMode: kioskMode as boolean | null,
    runLinuxCncAtStartup,
    linuxCncIniPath: typeof linuxCncIniPath === 'string' ? linuxCncIniPath : null,
    toolInSpindle,
    reloadToolOnStartup,
  };
}

export async function fetchUserPreferences(
  signal?: AbortSignal,
): Promise<UserPreferencesFetchResult> {
  try {
    const response = await fetch('/api/user-preferences', { cache: 'no-store', signal });
    if (!response.ok) return { ok: false };
    const raw: unknown = await response.json();
    const preferences = parseUserPreferences(raw);
    if (!preferences) return { ok: false };
    return { ok: true, preferences };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ok: false };
  }
}

export async function saveKioskModePreference(kioskMode: boolean): Promise<boolean> {
  try {
    const response = await fetch('/api/user-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kioskMode }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function saveLinuxCncAutostartPreference(
  runLinuxCncAtStartup: boolean,
): Promise<LinuxCncAutostartSaveResult> {
  try {
    const response = await fetch('/api/user-preferences/linuxcnc-autostart', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runLinuxCncAtStartup }),
    });
    if (response.ok) {
      try {
        const raw: unknown = await response.json();
        const preferences = parseUserPreferences(raw);
        if (preferences) {
          return { ok: true, linuxCncIniPath: preferences.linuxCncIniPath };
        }
      } catch {
        // ignore parse errors
      }
      return { ok: true, linuxCncIniPath: null };
    }
    let code: string | undefined;
    let message: string | undefined;
    try {
      const raw: unknown = await response.json();
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        const detail = (raw as { detail?: unknown }).detail;
        if (typeof detail === 'string') {
          message = detail;
        } else if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
          const d = detail as { code?: unknown; message?: unknown };
          if (typeof d.code === 'string') code = d.code;
          if (typeof d.message === 'string') message = d.message;
        }
      }
    } catch {
      // ignore parse errors
    }
    return { ok: false, code, message };
  } catch {
    return { ok: false, code: 'network_error' };
  }
}

/** Persist last tool-in-spindle (background; no toast on failure). */
export async function saveToolInSpindlePreference(toolInSpindle: number): Promise<boolean> {
  try {
    const response = await fetch('/api/user-preferences/tool-in-spindle', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolInSpindle }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function saveReloadToolOnStartupPreference(
  reloadToolOnStartup: boolean,
): Promise<boolean> {
  try {
    const response = await fetch('/api/user-preferences/reload-tool-on-startup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reloadToolOnStartup }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
