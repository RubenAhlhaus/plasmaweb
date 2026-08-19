import type { CoordinateAxisKey } from '@/api/coordinateSystems';

/** LinuxCNC axis_mask bits (see Python interface / [TRAJ] COORDINATES). */
const AXIS_MASK_BITS: Record<CoordinateAxisKey, number> = {
  x: 1,
  y: 2,
  z: 4,
  a: 8,
  b: 16,
  c: 32,
  u: 64,
  v: 128,
  w: 256,
};

const CANONICAL_AXIS_ORDER: CoordinateAxisKey[] = [
  'x',
  'y',
  'z',
  'a',
  'b',
  'c',
  'u',
  'v',
  'w',
];

const VALID_AXIS = new Set<CoordinateAxisKey>(CANONICAL_AXIS_ORDER);

/** All axes as in the tool dialog when neither mask nor INI string is usable. */
export const DEFAULT_TOOL_UI_AXES: CoordinateAxisKey[] = [...CANONICAL_AXIS_ORDER];

/** axis_mask from JSON/WebSocket may arrive as string or float. */
export function normalizeAxisMaskForUi(raw: unknown): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 0 ? Math.trunc(raw) : null;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) {
      return null;
    }
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }
  return null;
}

function axesFromAxisMask(mask: number | undefined | null): CoordinateAxisKey[] | null {
  if (mask == null || typeof mask !== 'number' || !Number.isFinite(mask) || mask <= 0) {
    return null;
  }
  const out: CoordinateAxisKey[] = [];
  for (const ax of CANONICAL_AXIS_ORDER) {
    if ((mask & AXIS_MASK_BITS[ax]) !== 0) {
      out.push(ax);
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Single letters from [TRAJ] COORDINATES (e.g. "X Y Z", "X Z"); drop duplicate letters.
 */
export function parseTrajCoordinateLetters(
  raw: string | null | undefined,
): CoordinateAxisKey[] | null {
  if (raw == null || !String(raw).trim()) {
    return null;
  }
  const letters = String(raw).match(/[A-Za-z]/g);
  if (!letters?.length) {
    return null;
  }
  const seen = new Set<CoordinateAxisKey>();
  const out: CoordinateAxisKey[] = [];
  for (const ch of letters) {
    const k = ch.toLowerCase() as CoordinateAxisKey;
    if (!VALID_AXIS.has(k) || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(k);
  }
  return out.length > 0 ? out : null;
}

/**
 * Axes for tool offsets: first stat.axis_mask, else INI COORDINATES, else all nine.
 */
export function activeAxesForToolUi(
  axisMask: number | undefined | null | unknown,
  trajCoordinates: string | null | undefined,
): CoordinateAxisKey[] {
  const normalized = normalizeAxisMaskForUi(axisMask);
  const fromMask = axesFromAxisMask(normalized);
  if (fromMask != null) {
    return fromMask;
  }
  const fromIni = parseTrajCoordinateLetters(trajCoordinates);
  if (fromIni != null) {
    return fromIni;
  }
  return DEFAULT_TOOL_UI_AXES;
}

export function isLatheFromIni(displayLathe: boolean | undefined): boolean {
  return displayLathe === true;
}

export type ToolEditUiProfile = {
  activeAxes: CoordinateAxisKey[];
  showLatheGeometry: boolean;
};

export function resolveToolEditUiProfile(input: {
  axisMask: number | undefined | null | unknown;
  trajCoordinates: string | null | undefined;
  displayLathe: boolean | undefined;
}): ToolEditUiProfile {
  return {
    activeAxes: activeAxesForToolUi(input.axisMask, input.trajCoordinates),
    showLatheGeometry: isLatheFromIni(input.displayLathe),
  };
}
