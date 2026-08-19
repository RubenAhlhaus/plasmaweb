import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/store';
import { setKioskModePreference, setLinuxCncAutostartPreference } from '../uiPreferences';
import {
  fetchUserPreferences,
  saveKioskModePreference,
  saveLinuxCncAutostartPreference,
} from '../userPreferencesApi';

describe('userPreferencesApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchUserPreferences parses full payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          kioskMode: false,
          runLinuxCncAtStartup: true,
          linuxCncIniPath: '/tmp/test.ini',
          toolInSpindle: 4,
          reloadToolOnStartup: false,
        }),
      }),
    );

    await expect(fetchUserPreferences()).resolves.toEqual({
      ok: true,
      preferences: {
        kioskMode: false,
        runLinuxCncAtStartup: true,
        linuxCncIniPath: '/tmp/test.ini',
        toolInSpindle: 4,
        reloadToolOnStartup: false,
      },
    });
  });

  it('fetchUserPreferences returns ok false on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false }),
    );

    await expect(fetchUserPreferences()).resolves.toEqual({ ok: false });
  });

  it('fetchUserPreferences returns ok false on invalid payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ kioskMode: 'yes' }),
      }),
    );

    await expect(fetchUserPreferences()).resolves.toEqual({ ok: false });
  });

  it('fetchUserPreferences defaults missing tool reload fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          kioskMode: false,
          runLinuxCncAtStartup: false,
          linuxCncIniPath: null,
        }),
      }),
    );

    await expect(fetchUserPreferences()).resolves.toEqual({
      ok: true,
      preferences: {
        kioskMode: false,
        runLinuxCncAtStartup: false,
        linuxCncIniPath: null,
        toolInSpindle: 0,
        reloadToolOnStartup: true,
      },
    });
  });

  it('saveKioskModePreference returns true when PUT succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true }),
    );

    await expect(saveKioskModePreference(true)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/user-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kioskMode: true }),
    });
  });

  it('saveLinuxCncAutostartPreference returns parsed ini path on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          kioskMode: null,
          runLinuxCncAtStartup: true,
          linuxCncIniPath: '/tmp/machine.ini',
          toolInSpindle: 0,
          reloadToolOnStartup: true,
        }),
      }),
    );

    await expect(saveLinuxCncAutostartPreference(true)).resolves.toEqual({
      ok: true,
      linuxCncIniPath: '/tmp/machine.ini',
    });
    expect(fetch).toHaveBeenCalledWith('/api/user-preferences/linuxcnc-autostart', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runLinuxCncAtStartup: true }),
    });
  });

  it('saveLinuxCncAutostartPreference parses structured error codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          detail: {
            code: 'ini_path_unavailable',
            message: 'LinuxCNC INI path is not available.',
          },
        }),
      }),
    );

    await expect(saveLinuxCncAutostartPreference(true)).resolves.toEqual({
      ok: false,
      code: 'ini_path_unavailable',
      message: 'LinuxCNC INI path is not available.',
    });
  });
});

describe('setKioskModePreference', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({ kioskMode: true });
  });

  it('updates store and persists when save succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true }),
    );

    await expect(setKioskModePreference(false)).resolves.toBe(true);
    expect(useAppStore.getState().kioskMode).toBe(false);
  });

  it('does not update store when save fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false }),
    );

    await expect(setKioskModePreference(false)).resolves.toBe(false);
    expect(useAppStore.getState().kioskMode).toBe(true);
  });
});

describe('setLinuxCncAutostartPreference', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      runLinuxCncAtStartup: false,
      linuxCncIniPath: null,
    });
  });

  it('updates store when save succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          kioskMode: null,
          runLinuxCncAtStartup: true,
          linuxCncIniPath: '/tmp/machine.ini',
          toolInSpindle: 0,
          reloadToolOnStartup: true,
        }),
      }),
    );

    await expect(setLinuxCncAutostartPreference(true)).resolves.toEqual({
      ok: true,
      linuxCncIniPath: '/tmp/machine.ini',
    });
    expect(useAppStore.getState().runLinuxCncAtStartup).toBe(true);
    expect(useAppStore.getState().linuxCncIniPath).toBe('/tmp/machine.ini');
  });

  it('does not update store when save fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          detail: { code: 'autostart_setup_failed', message: 'failed' },
        }),
      }),
    );

    await expect(setLinuxCncAutostartPreference(true)).resolves.toEqual({
      ok: false,
      code: 'autostart_setup_failed',
      message: 'failed',
    });
    expect(useAppStore.getState().runLinuxCncAtStartup).toBe(false);
    expect(useAppStore.getState().linuxCncIniPath).toBeNull();
  });
});
