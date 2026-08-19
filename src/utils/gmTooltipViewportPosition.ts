const DEFAULT_PANEL_W = 288;
/** Fallback height before the tooltip DOM is measured (short text panels). */
export const FALLBACK_PANEL_H = 96;
const OFFSET_X = 14;
const OFFSET_Y = 20;
const MARGIN = 10;

export { DEFAULT_PANEL_W };

/**
 * Position a tooltip near the pointer using its real width/height.
 * Prefers below the cursor; if the bottom edge would overflow, places the panel above
 * (`top = clientY - OFFSET_Y - height`) so it stays close to the pointer — unlike guessing
 * with max-height, which can clamp `top` to MARGIN and stick the panel to the window top.
 */
export function gmTooltipViewportPositionNearPointer(
  clientX: number,
  clientY: number,
  panelW: number,
  panelH: number,
): { left: number; top: number } {
  const w = panelW > 0 ? panelW : DEFAULT_PANEL_W;
  const h = panelH > 0 ? panelH : FALLBACK_PANEL_H;

  let left = clientX + OFFSET_X;
  if (left + w > window.innerWidth - MARGIN) {
    left = clientX - w - MARGIN;
  }
  if (left < MARGIN) {
    left = MARGIN;
  }

  let top = clientY + OFFSET_Y;
  if (top + h > window.innerHeight - MARGIN) {
    top = clientY - OFFSET_Y - h;
  }
  if (top < MARGIN) {
    top = MARGIN;
  }
  if (top + h > window.innerHeight - MARGIN) {
    top = Math.max(MARGIN, window.innerHeight - MARGIN - h);
  }

  return { left, top };
}

/** One-shot guess before layout measurement (avoids a 0,0 flash). */
export function gmTooltipViewportPositionEstimate(clientX: number, clientY: number): {
  left: number;
  top: number;
} {
  return gmTooltipViewportPositionNearPointer(clientX, clientY, DEFAULT_PANEL_W, FALLBACK_PANEL_H);
}