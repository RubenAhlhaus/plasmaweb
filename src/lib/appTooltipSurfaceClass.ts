/**
 * Shared opaque panel look for `AppTooltip` and G-/M-code reference tooltips
 * (portal + fixed layer). Uses theme `bg-card` — no `backdrop-blur` for embedded GPU performance.
 */
export const APP_TOOLTIP_SURFACE_CLASS =
  'fixed z-[200] w-72 max-h-[min(70vh,320px)] overflow-y-auto rounded-lg border border-border/60 bg-card p-3 shadow-xl pointer-events-none';
