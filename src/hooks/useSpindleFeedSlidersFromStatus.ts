import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store';
import { effectiveFeedRateMmMin } from '@/lib/effectiveFeedRate';
import { effectiveSpindleRpm } from '@/lib/effectiveSpindleRpm';

interface SpindleFeedSlidersState {
  /** Effective spindle RPM (S × override when enabled) for the circular display. */
  spindleSpeed: number;
  spindleOverridePercent: number;
  /** Effective feed (F × feed override) for the circular display. */
  feedRate: number;
  feedOverridePercent: number;
}

/** Values for spindle/feed `SliderControl` bar (home and program screens). */
export function useSpindleFeedSlidersFromStatus(): SpindleFeedSlidersState {
  return useAppStore(
    useShallow((state) => {
      const spindle = state.linuxCncStatus.spindle?.[0];
      const feedOverride = state.linuxCncStatus.overrides.feedrate ?? 1;
      const programFeedSetting = state.linuxCncStatus.program.settings?.[1];
      const programSpindleSetting = state.linuxCncStatus.program.settings?.[2];
      return {
        spindleSpeed: effectiveSpindleRpm(
          programSpindleSetting,
          spindle?.override,
          spindle?.speed,
          spindle?.override_enabled,
        ),
        spindleOverridePercent: (spindle?.override ?? 1) * 100,
        feedRate: effectiveFeedRateMmMin(programFeedSetting, feedOverride),
        feedOverridePercent: feedOverride * 100,
      };
    }),
  );
}
