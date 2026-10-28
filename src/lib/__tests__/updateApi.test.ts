import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchUpdateInfo, startUpdateInstall, type UpdateInfo } from '@/lib/updateApi';

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const available: UpdateInfo = {
  runningVersion: '1.1.1',
  installedVersion: '1.1.1',
  sourceVersion: null,
  latestVersion: '1.2.0',
  updateAvailable: true,
  restartRequired: false,
  releaseUrl: 'https://github.com/RubenAhlhaus/plasmaweb/releases/tag/v1.2.0',
  releaseNotes: 'notes',
  canInstall: true,
  error: null,
};

describe('fetchUpdateInfo', () => {
  it('returns what the backend reports', async () => {
    mockFetch({ ok: true, json: async () => available });

    expect(await fetchUpdateInfo()).toEqual(available);
  });

  it('asks GitHub again only when told to', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => available });

    await fetchUpdateInfo(true);

    expect(fetchMock).toHaveBeenCalledWith('/api/update?refresh=true');
  });

  it('treats an unexpected shape as no answer', async () => {
    mockFetch({ ok: true, json: async () => ({ ...available, updateAvailable: 'yes' }) });

    expect(await fetchUpdateInfo()).toBeNull();
  });

  it('treats a network failure as no answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    expect(await fetchUpdateInfo()).toBeNull();
  });
});

describe('startUpdateInstall', () => {
  it('passes on why the backend refused', async () => {
    mockFetch({
      ok: false,
      json: async () => ({
        detail: { code: 'machine_busy', message: 'Stop the running program first.' },
      }),
    });

    expect(await startUpdateInstall()).toEqual({
      ok: false,
      message: 'Stop the running program first.',
    });
  });
});
