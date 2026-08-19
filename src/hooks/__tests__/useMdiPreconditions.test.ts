import { describe, expect, it } from 'vitest';

import { getFriendlyCantSetNumericValueMessage } from '@/hooks/useMdiPreconditions';

describe('getFriendlyCantSetNumericValueMessage', () => {
  it('single machine_off', () => {
    expect(getFriendlyCantSetNumericValueMessage(['machine_off'], 'spindle')).toContain(
      'machine is off',
    );
  });

  it('combines multiple reasons compactly', () => {
    expect(
      getFriendlyCantSetNumericValueMessage(['estop_active', 'interpreter_busy'], 'spindle'),
    ).toBe('Spindle speed cannot be changed (E-stop active · Program running).');
    expect(
      getFriendlyCantSetNumericValueMessage(
        ['machine_off', 'interpreter_busy'],
        'feed',
      ),
    ).toBe(
      'Feed rate cannot be changed (Machine off (turn on first) · Program running).',
    );
  });

  it('single task_mode_not_manual_or_mdi', () => {
    expect(getFriendlyCantSetNumericValueMessage(['task_mode_not_manual_or_mdi'], 'feed')).toContain(
      'manual or MDI mode',
    );
  });

  it('single task_mode_unknown', () => {
    expect(getFriendlyCantSetNumericValueMessage(['task_mode_unknown'], 'spindle')).toContain(
      'task mode',
    );
  });
});
