/** Matches Tailwind `xl` — two-column Home/Program layout. */
export const MACHINE_TWO_COLUMN_MIN_WIDTH_PX = 1280;

/**
 * Minimum right-column width for full-size increment selector + jog pad side by side.
 * Lower than the physical minimum (~560px) so full size still triggers with virtual
 * sidebar and typical Windows display scaling on a 1920px monitor.
 */
export const JOG_CONTROL_FULL_MIN_WIDTH_PX = 520;

export type JogControlSize = 'compact' | 'full';

export function isMachineTwoColumnLayout(viewportWidthPx?: number): boolean {
  if (viewportWidthPx !== undefined) {
    return viewportWidthPx >= MACHINE_TWO_COLUMN_MIN_WIDTH_PX;
  }

  return window.matchMedia(`(min-width: ${MACHINE_TWO_COLUMN_MIN_WIDTH_PX}px)`).matches;
}

export function resolveJogControlSize(
  panelWidthPx: number,
  twoColumnLayout: boolean,
): JogControlSize {
  if (!twoColumnLayout) {
    return 'compact';
  }

  return panelWidthPx >= JOG_CONTROL_FULL_MIN_WIDTH_PX ? 'full' : 'compact';
}

export function measureJogControlSizeFromElement(element: HTMLElement): JogControlSize {
  return resolveJogControlSize(
    element.getBoundingClientRect().width,
    isMachineTwoColumnLayout(),
  );
}
