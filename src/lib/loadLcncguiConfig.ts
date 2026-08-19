import i18n from '@/i18n/config';
import { clampCoordinateUiFlushMs, DEFAULT_COORDINATE_UI_FLUSH_MS } from '@/lib/coordinateUpdateBatcher';
import { readStoredShowVirtualSidebar } from '@/lib/uiPreferencesStorage';
import { useAppStore } from '@/store';

export const LCNCGUI_CONFIG_JSON = 'lcncgui-config.json';

/** Shape of `public/lcncgui-config.json` (and the committed example file). */
export type LcncguiConfigFile = {
  schemaVersion?: number;
  websocketUrl?: unknown;
  ui?: {
    showVirtualSidebar?: unknown;
    kioskMode?: unknown;
    debugLoggingEnabled?: unknown;
    debugLogEventBus?: unknown;
    debugLogWsOutgoing?: unknown;
    debugLogWsIncoming?: unknown;
    /** DRO coordinate store flush interval in ms (16–500; default 66). */
    coordinateUiFlushMs?: unknown;
  };
};

export type ParsedLcncguiConfig = {
  schemaVersion: number;
  websocketUrl: string;
  ui: {
    showVirtualSidebar: boolean;
    kioskMode: boolean;
    debugLoggingEnabled: boolean;
    debugLogEventBus: boolean;
    debugLogWsOutgoing: boolean;
    debugLogWsIncoming: boolean;
    coordinateUiFlushMs: number;
  };
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

export function isAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

function resolveWebsocketUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.toLowerCase() === 'auto') {
    if (typeof window === 'undefined') {
      return null;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  return null;
}

/**
 * Validates and normalizes config JSON. Returns an error message on failure.
 */
export function parseLcncguiConfigJson(raw: unknown): { ok: true; config: ParsedLcncguiConfig } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: i18n.t('configErrors.notObject', { ns: 'settings' }) };
  }

  const o = raw as LcncguiConfigFile;

  if (!isNonEmptyString(o.websocketUrl)) {
    return { ok: false, error: i18n.t('configErrors.websocketMissing', { ns: 'settings' }) };
  }

  const url = resolveWebsocketUrl(o.websocketUrl);
  if (!url) {
    return { ok: false, error: i18n.t('configErrors.websocketScheme', { ns: 'settings' }) };
  }

  const ui = o.ui;
  const uiObj = ui && typeof ui === 'object' && !Array.isArray(ui) ? ui : {};

  const showVirtualSidebar = isBoolean(uiObj.showVirtualSidebar) ? uiObj.showVirtualSidebar : true;
  const kioskMode = isBoolean(uiObj.kioskMode) ? uiObj.kioskMode : true;
  const debugLoggingEnabled = isBoolean(uiObj.debugLoggingEnabled) ? uiObj.debugLoggingEnabled : false;
  const debugLogEventBus = isBoolean(uiObj.debugLogEventBus) ? uiObj.debugLogEventBus : true;
  const debugLogWsOutgoing = isBoolean(uiObj.debugLogWsOutgoing) ? uiObj.debugLogWsOutgoing : true;
  const debugLogWsIncoming = isBoolean(uiObj.debugLogWsIncoming) ? uiObj.debugLogWsIncoming : false;
  const coordinateUiFlushMs =
    typeof uiObj.coordinateUiFlushMs === 'number' && Number.isFinite(uiObj.coordinateUiFlushMs)
      ? clampCoordinateUiFlushMs(uiObj.coordinateUiFlushMs)
      : DEFAULT_COORDINATE_UI_FLUSH_MS;

  const schemaVersion = typeof o.schemaVersion === 'number' && Number.isFinite(o.schemaVersion) ? o.schemaVersion : 1;

  return {
    ok: true,
    config: {
      schemaVersion,
      websocketUrl: url,
      ui: {
        showVirtualSidebar,
        kioskMode,
        debugLoggingEnabled,
        debugLogEventBus,
        debugLogWsOutgoing,
        debugLogWsIncoming,
        coordinateUiFlushMs,
      },
    },
  };
}

export function configJsonUrl(): string {
  const base = import.meta.env.BASE_URL;
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}${LCNCGUI_CONFIG_JSON}`;
}

/**
 * Fetches and parses `lcncgui-config.json` from the app origin (Vite dev, preview, or packaged renderer).
 * If `signal` is aborted, throws the same abort error as `fetch` (for StrictMode cleanup).
 */
export async function fetchLcncguiConfig(
  signal?: AbortSignal,
): Promise<{ ok: true; config: ParsedLcncguiConfig } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(configJsonUrl(), { cache: 'no-store', signal });
  } catch (e) {
    if (isAbortError(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: i18n.t('configErrors.fetchFailed', { ns: 'settings', message: msg }),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: i18n.t('configErrors.httpNotOk', {
        ns: 'settings',
        status: response.status,
        url: configJsonUrl(),
      }),
    };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (e) {
    if (isAbortError(e)) throw e;
    return { ok: false, error: i18n.t('configErrors.invalidJson', { ns: 'settings' }) };
  }

  return parseLcncguiConfigJson(raw);
}

/** Writes parsed config into the store (WebSocket URL + UI defaults from file). */
export function applyLcncguiConfigToStore(
  config: ParsedLcncguiConfig,
  userKioskPreference: boolean | null = null,
): void {
  const {
    setBackendWebSocketUrl,
    setShowVirtualSidebar,
    setKioskMode,
    setDebugLoggingEnabled,
    setDebugLogEventBus,
    setDebugLogWsOutgoing,
    setDebugLogWsIncoming,
    setCoordinateUiFlushMs,
  } = useAppStore.getState();

  setBackendWebSocketUrl(config.websocketUrl);
  if (readStoredShowVirtualSidebar() === null) {
    setShowVirtualSidebar(config.ui.showVirtualSidebar);
  }
  setKioskMode(userKioskPreference ?? config.ui.kioskMode);
  setDebugLoggingEnabled(config.ui.debugLoggingEnabled);
  setDebugLogEventBus(config.ui.debugLogEventBus);
  setDebugLogWsOutgoing(config.ui.debugLogWsOutgoing);
  setDebugLogWsIncoming(config.ui.debugLogWsIncoming);
  setCoordinateUiFlushMs(config.ui.coordinateUiFlushMs);
}
