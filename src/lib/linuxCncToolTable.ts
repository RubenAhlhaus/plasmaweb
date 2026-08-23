import { parsePlasmawebMeta, splitPlasmawebComment } from '@/lib/plasmawebToolComment';
import type { LinuxCncToolTableRow } from '@/store/types';
import {
  ALL_TOOL_TYPES,
  normalizeToolMaterial,
  type Tool,
  type ToolPreset,
  type ToolType,
} from '@/types/tools';

function isToolType(s: string): s is ToolType {
  return (ALL_TOOL_TYPES as readonly string[]).includes(s);
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean | undefined {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 1 || v === 0) return Boolean(v);
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return undefined;
}

/**
 * Map one backend tool-table row to UI `Tool`. Returns null for empty slots (e.g. T0).
 */
function mapSidecarPresets(raw: unknown[] | undefined): ToolPreset[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ToolPreset[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
    const p = item as Record<string, unknown>;
    const id = p.id != null ? String(p.id).trim() : '';
    const name = p.name != null ? String(p.name).trim() : '';
    if (!id && !name) continue;
    const pr: ToolPreset = {
      id: id || `preset-${out.length}`,
      name,
    };
    const sr = num(p.spindle_rpm);
    if (sr !== undefined) pr.spindle_rpm = sr;
    const vc = num(p.surface_speed_m_per_min);
    if (vc !== undefined) pr.surface_speed_m_per_min = vc;
    const rsr = num(p.ramp_spindle_rpm);
    if (rsr !== undefined) pr.ramp_spindle_rpm = rsr;
    const ff = num(p.feed_mm_min);
    if (ff !== undefined) pr.feed_mm_min = ff;
    const fpt = num(p.feed_per_tooth_mm);
    if (fpt !== undefined) pr.feed_per_tooth_mm = fpt;
    const li = num(p.lead_in_feed_mm_min);
    if (li !== undefined) pr.lead_in_feed_mm_min = li;
    const lo = num(p.lead_out_feed_mm_min);
    if (lo !== undefined) pr.lead_out_feed_mm_min = lo;
    const tr = num(p.transition_feed_mm_min);
    if (tr !== undefined) pr.transition_feed_mm_min = tr;
    const hx = num(p.helix_feed_mm_min);
    if (hx !== undefined) pr.helix_feed_mm_min = hx;
    const ra = num(p.ramp_angle_deg);
    if (ra !== undefined) pr.ramp_angle_deg = ra;
    const pf = num(p.plunge_mm_min);
    if (pf !== undefined) pr.plunge_mm_min = pf;
    const ppr = num(p.plunge_feed_per_rev_mm);
    if (ppr !== undefined) pr.plunge_feed_per_rev_mm = ppr;
    const msd = num(p.max_stepdown_mm);
    if (msd !== undefined) pr.max_stepdown_mm = msd;
    const mso = num(p.max_stepover_mm);
    if (mso !== undefined) pr.max_stepover_mm = mso;
    const usd = bool(p.use_stepdown);
    if (usd !== undefined) pr.use_stepdown = usd;
    const uso = bool(p.use_stepover);
    if (uso !== undefined) pr.use_stepover = uso;
    if (p.coolant != null && String(p.coolant).trim() !== '') {
      pr.coolant = String(p.coolant).trim();
    }
    if (p.comment != null && String(p.comment).trim() !== '') {
      pr.comment = String(p.comment).trim();
    }
    out.push(pr);
  }
  return out;
}

export function mapLinuxCncToolRowToTool(row: LinuxCncToolTableRow): Tool | null {
  const rawNo = row.toolno ?? row.id;
  const toolno = num(rawNo);
  if (toolno === undefined || toolno <= 0) return null;

  const rawComment = row.comment != null ? String(row.comment) : '';
  const hasSidecarMeta = Object.prototype.hasOwnProperty.call(row, 'lcncgui_meta');
  const side = row.lcncgui_meta;
  const meta = hasSidecarMeta
    ? (() => {
        const o =
          side != null && typeof side === 'object' && !Array.isArray(side)
            ? (side as Record<string, unknown>)
            : {};
        return {
          name: o.name != null && String(o.name).trim() !== '' ? String(o.name).trim() : undefined,
          type: o.type != null && String(o.type).trim() !== '' ? String(o.type).trim() : undefined,
          material:
            o.material != null && String(o.material).trim() !== ''
              ? String(o.material).trim()
              : undefined,
          comment:
            o.comment != null && String(o.comment).trim() !== ''
              ? String(o.comment).trim()
              : undefined,
          numberOfFlutes: num(o.numberOfFlutes),
          flutesLength: num(o.flutesLength),
        };
      })()
    : parsePlasmawebMeta(rawComment);
  const { humanPrefix } = splitPlasmawebComment(rawComment);

  const name =
    meta?.name != null && String(meta.name).trim() !== ''
      ? String(meta.name).trim()
      : `T${toolno}`;

  let type: Tool['type'] = undefined;
  if (meta?.type != null && String(meta.type).trim() !== '') {
    const t = String(meta.type).trim();
    type = isToolType(t) ? t : undefined;
  }

  const rawMaterial =
    meta?.material != null && String(meta.material).trim() !== ''
      ? String(meta.material).trim()
      : undefined;
  const materialNorm = rawMaterial !== undefined ? normalizeToolMaterial(rawMaterial) : '';
  const material: Tool['material'] | undefined =
    materialNorm !== '' ? materialNorm : undefined;

  const comment =
    meta?.comment != null && String(meta.comment).trim() !== ''
      ? String(meta.comment).trim()
      : humanPrefix || undefined;

  const diameter = num(row.diameter);

  const orientation = num(row.orientation);
  const toolOrientation =
    orientation === 1 || orientation === 2 || orientation === 3 || orientation === 4
      ? orientation
      : undefined;

  const numberOfFlutes = num(meta?.numberOfFlutes);
  const flutesLength = num(meta?.flutesLength);

  const lcncguiPresets =
    'lcncgui_presets' in row && Array.isArray(row.lcncgui_presets)
      ? mapSidecarPresets(row.lcncgui_presets)
      : undefined;

  return {
    id: `T${toolno}`,
    toolNumber: toolno,
    rawTableComment: rawComment !== '' ? rawComment : undefined,
    name,
    diameter,
    type,
    material,
    comment,
    numberOfFlutes,
    flutesLength,
    lcncguiPresets,
    pocketNumber: num(row.pocket ?? row.pocketno),
    offsetX: num(row.xoffset),
    offsetY: num(row.yoffset),
    offsetZ: num(row.zoffset),
    offsetA: num(row.aoffset),
    offsetB: num(row.boffset),
    offsetC: num(row.coffset),
    offsetU: num(row.uoffset),
    offsetV: num(row.voffset),
    offsetW: num(row.woffset),
    frontAngle: num(row.frontangle),
    backAngle: num(row.backangle),
    toolOrientation,
  };
}

/**
 * Map full `tool_table` array to UI tools (non-null rows only).
 *
 * Some LinuxCNC/status snapshots can carry the same `toolno` more than once; without
 * deduplication the UI would show duplicate rows and duplicate React keys (`tool.id`).
 */
export function mapToolTableToTools(rows: LinuxCncToolTableRow[] | undefined): Tool[] {
  if (!rows?.length) return [];
  const byId = new Map<string, Tool>();
  for (const row of rows) {
    const t = mapLinuxCncToolRowToTool(row);
    if (t) {
      byId.set(t.id, t);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => (a.toolNumber ?? Number.MAX_SAFE_INTEGER) - (b.toolNumber ?? Number.MAX_SAFE_INTEGER),
  );
}
