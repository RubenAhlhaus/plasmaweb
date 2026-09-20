import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchNetworkInfo } from '@/lib/networkInfoApi';

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchNetworkInfo', () => {
  it('returns the addresses the backend reports', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        host: '0.0.0.0',
        port: 8765,
        reachableFromNetwork: true,
        urls: ['http://192.168.64.2:8765'],
      }),
    });

    expect(await fetchNetworkInfo()).toEqual({
      host: '0.0.0.0',
      port: 8765,
      reachableFromNetwork: true,
      urls: ['http://192.168.64.2:8765'],
    });
  });

  it('keeps a loopback-only answer, which is what says nobody else can connect', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        host: '127.0.0.1',
        port: 8765,
        reachableFromNetwork: false,
        urls: [],
      }),
    });

    const info = await fetchNetworkInfo();

    expect(info?.reachableFromNetwork).toBe(false);
    expect(info?.host).toBe('127.0.0.1');
  });

  it('is null on an error status rather than a half-filled address', async () => {
    mockFetch({ ok: false, json: async () => ({ detail: 'Not Found' }) });

    expect(await fetchNetworkInfo()).toBeNull();
  });

  it('is null when the body is not the shape the backend promises', async () => {
    mockFetch({ ok: true, json: async () => ({ port: '8765' }) });

    expect(await fetchNetworkInfo()).toBeNull();
  });

  it('is null when the backend cannot be reached at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    expect(await fetchNetworkInfo()).toBeNull();
  });
});
