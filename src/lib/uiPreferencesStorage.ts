/** localStorage key for virtual button sidebar visibility. */
export const SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY = 'plasmaweb.showVirtualSidebar';

export function readStoredShowVirtualSidebar(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

export function persistShowVirtualSidebar(show: boolean): void {
  try {
    window.localStorage.setItem(SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY, String(show));
  } catch {
    /* ignore quota / private mode */
  }
}
