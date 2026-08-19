import type { LinuxCncProgramStatus } from '@/store/types';

/**
 * LinuxCNC fills `task.activeGCodes[]` in `Interp::write_g_codes` (rs274ngc/interp_write.cc):
 * `active_g_codes[0]` is the **sequence number** (`settings->sequence_number`), not a G-code.
 * From index 1 onward come modals (convention: value = nominal G number × 10).
 * Same scheme for `active_m_codes[0]` in `write_m_codes` — sequence number there, not an M line.
 *
 * See also: `backend/adapters/linuxcnc_gateway.py` → `_stat_gcode_labels` uses `gc[1:]`.
 */
function isDisplayableGcodeRaw(code: number): boolean {
  if (code < 0) return false;
  return true;
}

function isValidCodeArray(input?: number[] | null): input is number[] {
  return Array.isArray(input) && input.length > 0;
}

/** LinuxCNC may report the same modal codes multiple times — display needs each once. */
function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function formatGCodes(gcodes?: number[] | null): string[] {
  if (!isValidCodeArray(gcodes)) {
    return [];
  }

  const modalSlice = gcodes.length > 1 ? gcodes.slice(1) : [];

  return dedupePreserveOrder(
    modalSlice
      .filter(
        (code) =>
          typeof code === 'number' &&
          Number.isInteger(code) &&
          code !== 0 &&
          isDisplayableGcodeRaw(code),
      )
      .map((code) => {
        const major = Math.trunc(code / 10);
        const fraction = Math.abs(code % 10);

        if (!Number.isFinite(major)) {
          return '';
        }

        if (fraction === 0) {
          return `G${major}`;
        }

        return `G${major}.${fraction}`;
      })
      .filter((value) => value !== ''),
  );
}

function formatMCodes(mcodes?: number[] | null): string[] {
  if (!isValidCodeArray(mcodes)) {
    return [];
  }

  const modalSlice = mcodes.length > 1 ? mcodes.slice(1) : [];

  return dedupePreserveOrder(
    modalSlice
      .filter(
        (code) =>
          typeof code === 'number' &&
          Number.isInteger(code) &&
          code > 0,
      )
      .map((code) => `M${code}`),
  );
}

export type ProgramCodesInput = Pick<LinuxCncProgramStatus, 'gcodes' | 'mcodes'>;

export function getFormattedProgramCodes(
  program: ProgramCodesInput,
): { gCodes: string[]; mCodes: string[] } {
  const gCodes = formatGCodes(program.gcodes);
  const mCodes = formatMCodes(program.mcodes);

  return { gCodes, mCodes };
}
