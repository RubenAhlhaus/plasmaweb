/** Delimiter before JSON metadata in LinuxCNC tool table `comment` fields (plasmaweb extension). */
export const LCNC_GUI_COMMENT_DELIM = '|LCNCGUI|';

type PlasmawebCommentSplit = {
  /** Text before the delimiter (optional human / CAM note). */
  humanPrefix: string;
  /** Raw JSON string after the delimiter, or null if absent. */
  metaJson: string | null;
};

/**
 * Split raw tool-table comment into optional human prefix and plasmaweb JSON payload.
 */
export function splitPlasmawebComment(raw: string | undefined): PlasmawebCommentSplit {
  if (raw == null || raw === '') {
    return { humanPrefix: '', metaJson: null };
  }
  const idx = raw.indexOf(LCNC_GUI_COMMENT_DELIM);
  if (idx === -1) {
    return { humanPrefix: raw.trim(), metaJson: null };
  }
  const humanPrefix = raw.slice(0, idx).trim();
  const rest = raw.slice(idx + LCNC_GUI_COMMENT_DELIM.length).trim();
  return { humanPrefix, metaJson: rest || null };
}

type PlasmawebToolMeta = {
  name?: string;
  type?: string;
  material?: string;
  /**
   * Optional short text for the tool list. When set, `mapLinuxCncToolRowToTool` prefers this over
   * any plain text before `|LCNCGUI|` in the raw table comment (`linuxCncToolTable.ts`).
   */
  comment?: string;
  /** Number of flutes (end mills etc.), plasmaweb extension in tool table comment. */
  numberOfFlutes?: number;
  /** Flute length in mm, plasmaweb extension. */
  flutesLength?: number;
};

/**
 * Parse JSON object after `|LCNCGUI|` if present and valid.
 */
export function parsePlasmawebMeta(raw: string | undefined): PlasmawebToolMeta | null {
  const { metaJson } = splitPlasmawebComment(raw);
  if (!metaJson) return null;
  try {
    const o = JSON.parse(metaJson) as unknown;
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
    return o as PlasmawebToolMeta;
  } catch {
    return null;
  }
}

/**
 * Build the tool-table `comment` field (text after `;` on the line): `|LCNCGUI|` and a compact JSON
 * object with only non-empty meta fields (name, type, material, comment, numberOfFlutes, flutesLength).
 * Empty meta → empty string.
 */
export function buildToolTableCommentSuffix(meta: PlasmawebToolMeta): string {
  const o: Record<string, string | number> = {};
  if (meta.name != null && String(meta.name).trim() !== '') o.name = String(meta.name).trim();
  if (meta.type != null && String(meta.type).trim() !== '') o.type = String(meta.type).trim();
  if (meta.material != null && String(meta.material).trim() !== '') {
    o.material = String(meta.material).trim();
  }
  if (meta.comment != null && String(meta.comment).trim() !== '') {
    o.comment = String(meta.comment).trim();
  }
  if (meta.numberOfFlutes != null) {
    const n =
      typeof meta.numberOfFlutes === 'number' ? meta.numberOfFlutes : Number(meta.numberOfFlutes);
    if (Number.isFinite(n)) o.numberOfFlutes = Math.round(n);
  }
  if (meta.flutesLength != null) {
    const n =
      typeof meta.flutesLength === 'number' ? meta.flutesLength : Number(meta.flutesLength);
    if (Number.isFinite(n)) o.flutesLength = n;
  }

  if (Object.keys(o).length === 0) {
    return '';
  }

  return `${LCNC_GUI_COMMENT_DELIM}${JSON.stringify(o)}`;
}
