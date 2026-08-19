/**
 * Must match `SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY` in `src/lib/uiPreferencesStorage.ts`.
 * E2E specs expect the virtual sidebar enabled; seed before reload for a deterministic baseline.
 */
export const E2E_SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY = 'lcncgui.showVirtualSidebar';
export const E2E_SHOW_VIRTUAL_SIDEBAR = 'true' as const;
