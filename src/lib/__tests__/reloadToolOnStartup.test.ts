import { describe, expect, it } from 'vitest';
import {
  decideToolInSpindlePersist,
  mdiLineForReloadTool,
  shouldReloadLastTool,
} from '@/lib/reloadToolOnStartup';

describe('reloadToolOnStartup', () => {
  it('builds M61 Qn G43 like gmoccapy', () => {
    expect(mdiLineForReloadTool(5)).toBe('M61 Q5 G43');
  });

  it('reloads when enabled, homed, MDI ok, stored > 0, spindle empty', () => {
    expect(
      shouldReloadLastTool({
        reloadEnabled: true,
        storedToolNumber: 3,
        currentToolInSpindle: 0,
        allAxesHomed: true,
        canMdi: true,
        sessionBlocked: false,
      }),
    ).toBe(true);
  });

  it('skips when spindle already has a tool', () => {
    expect(
      shouldReloadLastTool({
        reloadEnabled: true,
        storedToolNumber: 3,
        currentToolInSpindle: 3,
        allAxesHomed: true,
        canMdi: true,
        sessionBlocked: false,
      }),
    ).toBe(false);
  });

  it('skips when toggle off, not homed, cannot MDI, stored 0, or session blocked', () => {
    const base = {
      reloadEnabled: true,
      storedToolNumber: 3,
      currentToolInSpindle: 0,
      allAxesHomed: true,
      canMdi: true,
      sessionBlocked: false,
    };
    expect(shouldReloadLastTool({ ...base, reloadEnabled: false })).toBe(false);
    expect(shouldReloadLastTool({ ...base, allAxesHomed: false })).toBe(false);
    expect(shouldReloadLastTool({ ...base, canMdi: false })).toBe(false);
    expect(shouldReloadLastTool({ ...base, storedToolNumber: 0 })).toBe(false);
    expect(shouldReloadLastTool({ ...base, sessionBlocked: true })).toBe(false);
    expect(shouldReloadLastTool({ ...base, currentToolInSpindle: undefined })).toBe(false);
  });

  describe('decideToolInSpindlePersist', () => {
    it('seeds without wipe when first runtime is 0 and prefs hold a tool', () => {
      expect(
        decideToolInSpindlePersist({
          runtimeTool: 0,
          storedPreference: 5,
          lastObservedRuntime: null,
        }),
      ).toEqual({ action: 'seed' });
    });

    it('persists first runtime when it differs and is not a wipe of a saved tool', () => {
      expect(
        decideToolInSpindlePersist({
          runtimeTool: 5,
          storedPreference: 0,
          lastObservedRuntime: null,
        }),
      ).toEqual({ action: 'persist', toolNumber: 5 });
    });

    it('seeds when first runtime matches prefs', () => {
      expect(
        decideToolInSpindlePersist({
          runtimeTool: 5,
          storedPreference: 5,
          lastObservedRuntime: null,
        }),
      ).toEqual({ action: 'seed' });
    });

    it('persists later changes including unload to 0', () => {
      expect(
        decideToolInSpindlePersist({
          runtimeTool: 0,
          storedPreference: 5,
          lastObservedRuntime: 5,
        }),
      ).toEqual({ action: 'persist', toolNumber: 0 });
    });

    it('skips duplicate observations', () => {
      expect(
        decideToolInSpindlePersist({
          runtimeTool: 3,
          storedPreference: 3,
          lastObservedRuntime: 3,
        }),
      ).toEqual({ action: 'none' });
    });
  });
});
