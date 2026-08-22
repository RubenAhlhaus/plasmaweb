/**
 * Which of QtPlasmaC's three screen formats a viewport is.
 *
 * Upstream ships three whole screens — `qtplasmac` (1348×866, 16:9), `qtplasmac_4x3`
 * (1002×816) and `qtplasmac_9x16` (750×1302) — with the *same widgets rearranged*: three main
 * columns on the wide one, a middle-plus-right arrangement on 4:3, a stacked one with its own
 * file button grid on the tall one. A web UI has no reason to ship three copies of the screen;
 * it has one screen that arranges itself.
 *
 * The choice is made on **aspect ratio**, not width, because that is what upstream's formats
 * are: a 4:3 panel at 1600×1200 is a wide screen by pixel count and a 4:3 screen by shape, and
 * it is the shape that decides whether a right-hand column fits beside the readouts.
 */

export type PlasmaScreenFormat = 'wide' | 'standard' | 'tall';

/** Upstream's own designed sizes, for the record and for the tests. */
export const UPSTREAM_FORMATS: Record<PlasmaScreenFormat, { width: number; height: number }> = {
  wide: { width: 1348, height: 866 },
  standard: { width: 1002, height: 816 },
  tall: { width: 750, height: 1302 },
};

/**
 * Boundaries sit between the shipped ratios rather than on them: 16:9 is 1.78 and 4:3 is 1.33,
 * so 1.55 separates them with room either side, and 9:16 is 0.56, so 0.9 catches anything
 * taller than it is wide.
 */
export const WIDE_FROM = 1.55;
export const TALL_BELOW = 0.9;

export function formatForViewport(width: number, height: number): PlasmaScreenFormat {
  if (height <= 0) return 'wide';
  const aspect = width / height;
  if (aspect >= WIDE_FROM) return 'wide';
  if (aspect < TALL_BELOW) return 'tall';
  return 'standard';
}
