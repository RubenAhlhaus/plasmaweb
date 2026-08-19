import { beforeEach, describe, expect, it, vi } from 'vitest';
import halToolIds from '../../../resources/hal-tool-ids.json';
import { HAL_TOOL_IDS, launchHalTool } from '../halToolsApi';
import { halToolLaunchErrorMessage } from '../halToolErrors';
import i18n from '@/i18n/config';

describe('halToolsApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('HAL_TOOL_IDS matches resources/hal-tool-ids.json', () => {
    expect([...HAL_TOOL_IDS]).toEqual(halToolIds);
  });

  it('launchHalTool returns ok on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );

    await expect(launchHalTool('halshow')).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/hal-tools/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'halshow' }),
    });
  });

  it('launchHalTool parses structured error detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          detail: {
            code: 'halmeter_unavailable',
            message: 'halmeter is not installed or not in PATH.',
          },
        }),
      }),
    );

    await expect(launchHalTool('halmeter')).resolves.toEqual({
      ok: false,
      code: 'halmeter_unavailable',
      message: 'halmeter is not installed or not in PATH.',
    });
  });

  it('launchHalTool returns network_error on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await launchHalTool('halscope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('network_error');
      expect(result.message).toBe('offline');
    }
  });
});

describe('halToolLaunchErrorMessage', () => {
  it('maps known error codes to localized settings strings', () => {
    const message = halToolLaunchErrorMessage(i18n.t.bind(i18n), 'halmeter', 'halmeter_unavailable');
    expect(message).toContain('HAL Meter');
    expect(message).toMatch(/not installed|nicht installiert/i);
  });

  it('falls back to launchFailed for unknown codes', () => {
    const message = halToolLaunchErrorMessage(i18n.t.bind(i18n), 'halshow', 'mystery');
    expect(message).toMatch(/Could not open|konnte nicht geöffnet werden/i);
  });
});
