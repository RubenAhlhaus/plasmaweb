import i18n from '@/i18n/config';

// Endmill
export const TOOL_TYPES_ENDMILL = [
  'Ball End Mill',
  'Bullnose Mill',
  'Flat End Mill',
  'Face Mill',
  'Taper Mill',
  'Radius Mill',
  'Chamfer Mill',
  'Dovetail Mill',
  'Lollipop Mill',
  'Slot Mill',
  'Thread Mill',
  'Circle Segment Barrel',
  'Circle Segment Lens',
  'Circle Segment Oval',
  'Circle Segment Taper',
] as const;

// Hole Making
export const TOOL_TYPES_HOLE_MAKING = [
  'Boring Bar',
  'Counterbore',
  'Drill',
  'Center Drill',
  'Spot Drill',
  'Reamer',
  'Counter sink',
  'Tap Left Hand',
  'Tap Right Hand',
] as const;

// Turning
export const TOOL_TYPES_TURNING = [
  'Turning General',
  'Turning Boring',
  'Turning Grooving',
  'Turning Threading',
] as const;

// Other
export const TOOL_TYPES_OTHER = ['Touch Probe'] as const;

export type ToolTypeEndmill = (typeof TOOL_TYPES_ENDMILL)[number];
export type ToolTypeHoleMaking = (typeof TOOL_TYPES_HOLE_MAKING)[number];
export type ToolTypeTurning = (typeof TOOL_TYPES_TURNING)[number];
export type ToolTypeOther = (typeof TOOL_TYPES_OTHER)[number];

export type ToolType =
  | ToolTypeEndmill
  | ToolTypeHoleMaking
  | ToolTypeTurning
  | ToolTypeOther;

/** All tool types as flat array (e.g. for a simple dropdown). */
export const ALL_TOOL_TYPES: readonly ToolType[] = [
  ...TOOL_TYPES_ENDMILL,
  ...TOOL_TYPES_HOLE_MAKING,
  ...TOOL_TYPES_TURNING,
  ...TOOL_TYPES_OTHER,
];

/**
 * Canonical **English** material strings for sidecar / `|LCNCGUI|` JSON and saving from the dialog.
 * Display labels come from i18n (`tools` namespace, `material.*`); stored values are always these strings.
 * The backend does not validate `meta.material`; the frontend mapping accepts only these
 * values (case-insensitive), otherwise treated as unspecified.
 */
export const TOOL_MATERIAL_VALUES = [
  'HSS',
  'Carbide',
  'Ceramic',
  'Titanium coated',
] as const;

export type ToolMaterialValue = (typeof TOOL_MATERIAL_VALUES)[number];

/** After load, usually a canonical English value; `string` kept for future extensions. */
export type ToolMaterial = ToolMaterialValue | string;

/** Maps canonical material value → `tools` JSON key under `material`. */
export const TOOL_MATERIAL_I18N_KEY: Record<ToolMaterialValue, string> = {
  HSS: 'HSS',
  Carbide: 'Carbide',
  Ceramic: 'Ceramic',
  'Titanium coated': 'titaniumCoated',
};

/** Raw meta value → canonical value → localized UI label; empty if unspecified / unknown. */
export function formatToolMaterialUi(material: string | undefined | null): string {
  const n = normalizeToolMaterial(material);
  if (n === '') return '';
  return i18n.t(`material.${TOOL_MATERIAL_I18N_KEY[n]}`, { ns: 'tools' });
}

/**
 * Maps raw strings from sidecar/comment to allowed **English** canonical values
 * (only these tokens, case-insensitive). Otherwise `''` (unspecified).
 */
export function normalizeToolMaterial(raw: string | undefined | null): ToolMaterialValue | '' {
  const t = raw != null ? String(raw).trim() : '';
  if (t === '') return '';

  for (const v of TOOL_MATERIAL_VALUES) {
    if (t === v) return v;
    if (t.toLowerCase() === v.toLowerCase()) return v;
  }

  return '';
}

/** Coolant preset (sidecar string, stable). */
export type ToolPresetCoolant =
  | 'off'
  | 'flood'
  | 'mist'
  | 'through_tool'
  | 'external_water'
  | 'air';

/** Preset from lcncgui sidecar (backend snake_case JSON). */
export interface ToolPreset {
  id: string;
  name: string;
  spindle_rpm?: number;
  /** m/min */
  surface_speed_m_per_min?: number;
  ramp_spindle_rpm?: number;
  feed_mm_min?: number;
  feed_per_tooth_mm?: number;
  lead_in_feed_mm_min?: number;
  lead_out_feed_mm_min?: number;
  transition_feed_mm_min?: number;
  helix_feed_mm_min?: number;
  ramp_angle_deg?: number;
  plunge_mm_min?: number;
  plunge_feed_per_rev_mm?: number;
  use_stepdown?: boolean;
  use_stepover?: boolean;
  max_stepdown_mm?: number;
  max_stepover_mm?: number;
  coolant?: ToolPresetCoolant | string;
  comment?: string;
}

export interface Tool {
  /** String id, e.g. "T1" — for display in the UI. */
  id: string;
  /** Raw comment from `stat.tool_table` / file (after `;`), for edit dialog / roundtrip. */
  rawTableComment?: string;
  /** Numeric tool number from LinuxCNC (tool_in_spindle). */
  toolNumber?: number;
  name: string;
  diameter?: number;
  type?: ToolType;
  comment?: string;
  material?: ToolMaterial;
  pocketNumber?: number;
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  offsetA?: number;
  offsetB?: number;
  offsetC?: number;
  offsetU?: number;
  offsetV?: number;
  offsetW?: number;
  frontAngle?: number;
  backAngle?: number;
  toolOrientation?: 1 | 2 | 3 | 4;
  numberOfFlutes?: number;
  flutesLength?: number;
  /** Cut presets from `.lcncgui-tools.json` (empty until the UI manages them). */
  lcncguiPresets?: ToolPreset[];
  tipAngle?: number;
  vendor?: string;
  productId?: string;
  productLink?: string;
}

