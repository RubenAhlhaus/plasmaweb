import { useEffect, useState } from 'react';
import {
  applyLcncguiConfigToStore,
  fetchLcncguiConfig,
  isAbortError,
} from '@/lib/loadLcncguiConfig';
import { fetchUserPreferences } from '@/lib/userPreferencesApi';
import { useAppStore } from '@/store';

export type LcncguiConfigLoaderState = 'loading' | 'ready' | 'error';

export function useLcncguiConfigLoader(): {
  state: LcncguiConfigLoaderState;
  errorMessage: string | null;
} {
  const [state, setState] = useState<LcncguiConfigLoaderState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const [configResult, userPrefsResult] = await Promise.all([
          fetchLcncguiConfig(ac.signal),
          fetchUserPreferences(ac.signal),
        ]);
        if (ac.signal.aborted) return;
        if (!configResult.ok) {
          setErrorMessage(configResult.error);
          setState('error');
          return;
        }
        const userKioskMode =
          userPrefsResult.ok ? (userPrefsResult.preferences.kioskMode ?? null) : null;
        applyLcncguiConfigToStore(configResult.config, userKioskMode);
        if (userPrefsResult.ok) {
          const {
            runLinuxCncAtStartup,
            linuxCncIniPath,
            toolInSpindle,
            reloadToolOnStartup,
          } = userPrefsResult.preferences;
          const store = useAppStore.getState();
          store.setRunLinuxCncAtStartup(runLinuxCncAtStartup);
          store.setLinuxCncIniPath(linuxCncIniPath);
          store.setToolInSpindlePreference(toolInSpindle);
          store.setReloadToolOnStartup(reloadToolOnStartup);
        }
        useAppStore.getState().setUserPreferencesLoadFailed(!userPrefsResult.ok);
        if (ac.signal.aborted) return;
        setState('ready');
      } catch (e) {
        if (ac.signal.aborted || isAbortError(e)) return;
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setState('error');
      }
    })();
    return () => ac.abort();
  }, []);

  return { state, errorMessage };
}
