/**
 * `/api/network` — the address another machine on the shop network would type.
 *
 * `window.location` cannot answer this: on the machine's own panel the UI is opened at
 * `127.0.0.1`, which is exactly the address no phone or laptop can use. The host has to say
 * it, and it also has to say whether the backend binds the LAN at all — launched as
 * LinuxCNC's `[DISPLAY]` program it binds loopback only.
 */

/** Mirrors `NetworkInfoResponse` in `backend/api/network.py`. */
export type NetworkInfo = {
  host: string;
  port: number;
  reachableFromNetwork: boolean;
  urls: string[];
};

function isNetworkInfo(raw: unknown): raw is NetworkInfo {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Partial<NetworkInfo>;
  return (
    typeof value.host === 'string' &&
    typeof value.port === 'number' &&
    typeof value.reachableFromNetwork === 'boolean' &&
    Array.isArray(value.urls) &&
    value.urls.every((url) => typeof url === 'string')
  );
}

/** `null` when the backend cannot be asked or answers with something unexpected. */
export async function fetchNetworkInfo(): Promise<NetworkInfo | null> {
  try {
    const response = await fetch('/api/network');
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    return isNetworkInfo(raw) ? raw : null;
  } catch {
    return null;
  }
}
