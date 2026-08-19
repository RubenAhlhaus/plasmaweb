/**
 * Pure helpers for gmoccapy-style last-tool persistence / restore after homing.
 * See docs/features/17_RELOAD_TOOL_ON_STARTUP.md.
 */

export function mdiLineForReloadTool(toolNumber: number): string {
  return `M61 Q${toolNumber} G43`;
}

export type ShouldReloadLastToolInput = {
  reloadEnabled: boolean;
  storedToolNumber: number;
  currentToolInSpindle: number | undefined;
  allAxesHomed: boolean;
  canMdi: boolean;
  /** True while an M61 restore is in flight or already completed for this homed session. */
  sessionBlocked: boolean;
};

/**
 * Whether the UI should send one `M61 Q… G43` restore MDI now.
 * Matches gmoccapy: only when spindle tool is currently 0.
 */
export function shouldReloadLastTool(input: ShouldReloadLastToolInput): boolean {
  if (!input.reloadEnabled) return false;
  if (input.sessionBlocked) return false;
  if (!input.allAxesHomed) return false;
  if (!input.canMdi) return false;
  if (!Number.isInteger(input.storedToolNumber) || input.storedToolNumber <= 0) return false;
  if (input.currentToolInSpindle === undefined) return false;
  if (input.currentToolInSpindle !== 0) return false;
  return true;
}

export type ToolPersistDecision =
  | { action: 'none' }
  | { action: 'seed' }
  | { action: 'persist'; toolNumber: number };

/**
 * Decide whether to write `toolInSpindle` for a newly observed runtime value.
 *
 * - First observation of `0` while a positive preference exists: seed only (do not wipe
 *   before M61 restore).
 * - First observation that differs from prefs and is not that protected wipe: persist
 *   (covers bootstrap failure while a tool is already in the spindle).
 * - Later changes: always persist.
 */
export function decideToolInSpindlePersist(input: {
  runtimeTool: number;
  storedPreference: number;
  /** `null` until the first finite runtime observation in this page session. */
  lastObservedRuntime: number | null;
}): ToolPersistDecision {
  const { runtimeTool, storedPreference, lastObservedRuntime } = input;
  if (!Number.isInteger(runtimeTool) || runtimeTool < 0) return { action: 'none' };

  if (lastObservedRuntime === null) {
    const wouldWipeSavedTool = runtimeTool === 0 && storedPreference > 0;
    if (wouldWipeSavedTool) return { action: 'seed' };
    if (runtimeTool !== storedPreference) {
      return { action: 'persist', toolNumber: runtimeTool };
    }
    return { action: 'seed' };
  }

  if (lastObservedRuntime === runtimeTool) return { action: 'none' };
  return { action: 'persist', toolNumber: runtimeTool };
}
