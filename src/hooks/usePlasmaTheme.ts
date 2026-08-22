import { useEffect } from 'react';

import { themeVariables, type PlasmaColors } from '@/lib/plasmaTheme';
import { useAppStore } from '@/store';

/**
 * Themes this UI from the machine's own `[COLOR_OPTIONS]`.
 *
 * Applied to the document root, so every screen follows — not only the plasma ones. A shop
 * runs one machine with one look, and half a themed UI is worse than none.
 *
 * Only applied when the backend actually reported colours: without a plasma config (a mill, a
 * dev laptop) the app keeps its own palette rather than being reset to a plasma default.
 */
export function usePlasmaTheme(): void {
  const colors = useAppStore((s) => s.plasmaParameters?.colors);

  useEffect(() => {
    if (!colors) return;
    const root = document.documentElement;
    const variables = themeVariables(colors as PlasmaColors);
    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }
    return () => {
      // Put the stylesheet's own values back, rather than leaving one machine's theme behind.
      for (const name of Object.keys(variables)) root.style.removeProperty(name);
    };
  }, [colors]);
}
