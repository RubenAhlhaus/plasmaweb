import { useAppStore } from '@/store';
import type { ConnectionStatus } from '@/store/types';
import {
  dispatchVirtualSidebarButton,
  isVirtualSidebarButtonId,
} from '@/lib/dispatchVirtualSidebarButton';
import type { VirtualSidebarButtonId } from '@/lib/virtualSidebarHotkeys';

/**
 * Minimale Schnittstelle für Playwright-E2E (Production-Bundle). Nur gezielt nutzen —
 * siehe `e2e/helpers/resetAppView.ts`.
 */
export type LcncguiE2eApi = {
  resetMacroQueue: () => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setHomedFlags: (homed: number[]) => void;
  /** Inject task mode + interpreter state for override/pause preset E2E. */
  setProgramExecutionState: (state: {
    taskMode: number;
    interpState: number;
    paused?: boolean;
  }) => void;
  getMachineTaskState: () => number | undefined;
  /** Simulates ``panel.sidebar.trigger`` from HAL panel (same path as HAL input). */
  triggerPanelSidebarButton: (buttonId: VirtualSidebarButtonId) => void;
};

declare global {
  interface Window {
    __LCNCGUI_E2E__?: LcncguiE2eApi;
  }
}

export function installPlasmawebE2eBridge(): void {
  if (typeof window === 'undefined') return;
  window.__LCNCGUI_E2E__ = {
    resetMacroQueue: () => {
      useAppStore.getState().setMacroQueueItems([]);
    },
    setConnectionStatus: (status) => {
      useAppStore.getState().setConnectionStatus(status);
    },
    setHomedFlags: (homed) => {
      useAppStore.getState().setLinuxCncStatus({
        motion: { homed },
      });
    },
    setProgramExecutionState: ({ taskMode, interpState, paused }) => {
      useAppStore.getState().setLinuxCncStatus({
        machine: { task_mode: taskMode },
        program: {
          interp_state: interpState,
          ...(paused !== undefined ? { paused } : {}),
        },
      });
    },
    getMachineTaskState: () => useAppStore.getState().linuxCncStatus.machine.task_state,
    triggerPanelSidebarButton: (buttonId) => {
      if (isVirtualSidebarButtonId(buttonId)) {
        dispatchVirtualSidebarButton(buttonId, 'hal');
      }
    },
  };
}
