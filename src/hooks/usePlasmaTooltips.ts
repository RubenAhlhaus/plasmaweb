import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '@/store';

/**
 * QtPlasmaC's tooltips, for the controls this UI has.
 *
 * Upstream keeps ~280 of them in `tooltips.py`, keyed by Qt widget name and switched on and
 * off by `[GUI_OPTIONS] Tool tips`. Most describe widgets that have no counterpart here (view
 * buttons, camera pans), so what is ported is the wording for the controls that *do* exist —
 * a plasma screen is full of three-letter buttons, and "VAD" means nothing until something
 * says "velocity anti-dive".
 *
 * The switch is honoured: with tips off, this returns `undefined` and no `title` is rendered.
 */
export function usePlasmaTooltips(): (key: string) => string | undefined {
  const { t } = useTranslation('plasma');
  const enabled = useAppStore((s) => s.plasmaParameters?.guiOptions?.toolTips !== false);

  return useCallback(
    (key: string) => {
      if (!enabled) return undefined;
      const text = t(`tips.${key}`, { defaultValue: '' });
      return text || undefined;
    },
    [enabled, t],
  );
}
