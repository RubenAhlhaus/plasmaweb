import { describe, expect, it } from 'vitest';

import {
  formatFeedMdiLine,
  formatMdiLineWithComment,
  formatSpindleMdiLine,
} from '@/lib/mdiLineFormat';

describe('mdiLineFormat', () => {
  it('formatMdiLineWithComment appends trimmed comment', () => {
    expect(formatMdiLineWithComment('S5000', 'Speed (rpm)')).toBe('S5000 ; Speed (rpm)');
    expect(formatMdiLineWithComment('S1', '   ')).toBe('S1');
  });

  it('formatSpindleMdiLine and formatFeedMdiLine', () => {
    expect(formatSpindleMdiLine(12000, 'Speed (rpm)')).toBe('S12000 ; Speed (rpm)');
    expect(formatFeedMdiLine(800, 'Feed (mm/min)')).toBe('F800 ; Feed (mm/min)');
  });
});
