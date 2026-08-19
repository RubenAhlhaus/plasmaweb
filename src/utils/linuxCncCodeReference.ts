import reference from '@/data/linuxCncGcodeMcodeReference.json';

export type LinuxCncRelatedCode = {
  kind: 'g' | 'm';
  /** Normalized label, e.g. G41.1, M3 */
  code: string;
  /** Short context for the UI (English). */
  hint?: string;
};

type LinuxCncCodeRefEntry = {
  title: string;
  /** One short sentence: what the code does in practice. */
  summary: string;
  /** Compact usage prototype (LinuxCNC-style words). */
  syntax: string;
  description: string;
  /** Other G-/M-codes that are typically used together or are the counterpart. */
  related?: LinuxCncRelatedCode[];
};

type ReferenceFile = {
  version: number;
  source: string;
  g: Record<string, LinuxCncCodeRefEntry>;
  m: Record<string, LinuxCncCodeRefEntry>;
};

const data = reference as ReferenceFile;

export const LINUXCNC_GCODE_DOC_URL =
  'https://linuxcnc.org/docs/html/gcode/g-code.html';
export const LINUXCNC_MCODE_DOC_URL =
  'https://linuxcnc.org/docs/html/gcode/m-code.html';

/**
 * Looks up reference data for a formatted G- or M-code label (e.g. "G1", "M3"):
 * title, summary, syntax, description, optional related[].
 */
export function lookupCodeReference(
  kind: 'g' | 'm',
  codeLabel: string,
): LinuxCncCodeRefEntry | null {
  const key = codeLabel.trim().toUpperCase();
  const bucket = kind === 'g' ? data.g : data.m;
  const entry = bucket[key];
  return entry ?? null;
}
