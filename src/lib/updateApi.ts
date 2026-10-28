/**
 * `/api/update` — whether a newer plasmaweb release is on GitHub, and installing it.
 *
 * The backend asks GitHub, not the browser: the panel may be on a network that only the
 * controller can route out of, and the install has to happen on the controller anyway.
 */

/** Mirrors `UpdateInfoResponse` in `backend/api/updates.py`. */
export type UpdateInfo = {
  runningVersion: string | null;
  installedVersion: string | null;
  /** A source checkout's `package.json` version; `null` for a release install. */
  sourceVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  canInstall: boolean;
  error: string | null;
};

export type UpdateInstallState = 'idle' | 'running' | 'succeeded' | 'failed';

/** Mirrors `UpdateInstallResponse` in `backend/api/updates.py`. */
export type UpdateInstallStatus = {
  state: UpdateInstallState;
  log: string[];
};

const nullableString = (value: unknown) => value === null || typeof value === 'string';

function isUpdateInfo(raw: unknown): raw is UpdateInfo {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return (
    nullableString(value.runningVersion) &&
    nullableString(value.installedVersion) &&
    nullableString(value.sourceVersion) &&
    nullableString(value.latestVersion) &&
    typeof value.updateAvailable === 'boolean' &&
    typeof value.restartRequired === 'boolean' &&
    nullableString(value.releaseUrl) &&
    nullableString(value.releaseNotes) &&
    typeof value.canInstall === 'boolean' &&
    nullableString(value.error)
  );
}

function isInstallStatus(raw: unknown): raw is UpdateInstallStatus {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return (
    (value.state === 'idle' ||
      value.state === 'running' ||
      value.state === 'succeeded' ||
      value.state === 'failed') &&
    Array.isArray(value.log) &&
    value.log.every((line) => typeof line === 'string')
  );
}

/** `null` when the backend cannot be asked or answers with something unexpected. */
export async function fetchUpdateInfo(refresh = false): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(refresh ? '/api/update?refresh=true' : '/api/update');
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    return isUpdateInfo(raw) ? raw : null;
  } catch {
    return null;
  }
}

export type StartInstallResult = { ok: true } | { ok: false; message: string | null };

export async function startUpdateInstall(): Promise<StartInstallResult> {
  try {
    const response = await fetch('/api/update/install', { method: 'POST' });
    if (response.ok) return { ok: true };
    const raw: unknown = await response.json().catch(() => null);
    const detail = (raw as { detail?: { message?: unknown } } | null)?.detail;
    return { ok: false, message: typeof detail?.message === 'string' ? detail.message : null };
  } catch {
    return { ok: false, message: null };
  }
}

export async function fetchUpdateInstallStatus(): Promise<UpdateInstallStatus | null> {
  try {
    const response = await fetch('/api/update/install');
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    return isInstallStatus(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** The release the operator chose to skip; the startup prompt stays quiet for that one only. */
export const SKIPPED_UPDATE_VERSION_STORAGE_KEY = 'plasmaweb.skippedUpdateVersion';

export function readSkippedUpdateVersion(): string | null {
  try {
    return window.localStorage.getItem(SKIPPED_UPDATE_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistSkippedUpdateVersion(version: string): void {
  try {
    window.localStorage.setItem(SKIPPED_UPDATE_VERSION_STORAGE_KEY, version);
  } catch {
    /* ignore quota / private mode */
  }
}
