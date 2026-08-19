import { describe, expect, it } from 'vitest';
import { getFormattedProgramCodes } from './formatProgramCodes';
import type { LinuxCncProgramStatus } from '@/store/types';

function programWithGcodes(gcodes: number[]): LinuxCncProgramStatus {
  return { gcodes, mcodes: [] };
}

describe('getFormattedProgramCodes', () => {
  it('formats modal gcodes after skipping LinuxCNC slot 0 (sequence number)', () => {
    const { gCodes } = getFormattedProgramCodes(programWithGcodes([42, 10, 900, 541]));
    expect(gCodes).toEqual(['G1', 'G90', 'G54.1']);
  });

  it('does not treat gcodes[0] as a G-code (avoids pseudo G0.x from line/seq numbers)', () => {
    const { gCodes } = getFormattedProgramCodes(programWithGcodes([6, 10, 900]));
    expect(gCodes).toEqual(['G1', 'G90']);
  });

  it('hides negative modal sentinels (-1) in real slots', () => {
    const { gCodes } = getFormattedProgramCodes(programWithGcodes([0, -1, 10]));
    expect(gCodes).toEqual(['G1']);
  });

  it('dedupes while preserving order', () => {
    const { gCodes } = getFormattedProgramCodes(programWithGcodes([0, 10, 10, 900]));
    expect(gCodes).toEqual(['G1', 'G90']);
  });
});
