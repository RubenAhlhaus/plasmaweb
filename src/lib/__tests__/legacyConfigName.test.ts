import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configJsonUrl,
  fetchPlasmawebConfig,
  LEGACY_CONFIG_JSON,
  PLASMAWEB_CONFIG_JSON,
} from '@/lib/loadPlasmawebConfig';

const CONFIG = { schemaVersion: 1, websocketUrl: 'ws://127.0.0.1:8765/ws' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the config file name after the rename', () => {
  it('asks for the new name first', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      return { ok: true, status: 200, json: async () => CONFIG } as Response;
    });

    await fetchPlasmawebConfig();

    expect(asked).toEqual([configJsonUrl(PLASMAWEB_CONFIG_JSON)]);
  });

  it('falls back to the old name, so a machine installed before the rename still starts', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      if (url.endsWith(PLASMAWEB_CONFIG_JSON)) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: true, status: 200, json: async () => CONFIG } as Response;
    });

    const result = await fetchPlasmawebConfig();

    expect(asked).toEqual([
      configJsonUrl(PLASMAWEB_CONFIG_JSON),
      configJsonUrl(LEGACY_CONFIG_JSON),
    ]);
    expect(result.ok).toBe(true);
  });

  it('reports the failure when neither name is there', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response);

    const result = await fetchPlasmawebConfig();

    expect(result.ok).toBe(false);
  });
});
