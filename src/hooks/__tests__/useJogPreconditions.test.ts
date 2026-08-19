import { TaskMode, TaskState } from '@/store/types';
import type { LinuxCncMachineStatus } from '@/store/types';
import {
  evaluateJogPreconditions,
  getCombinedJogDisabledTooltip,
  getJogDisabledTooltip,
} from '../useJogPreconditions';

describe('evaluateJogPreconditions', () => {
  const baseMachine: LinuxCncMachineStatus = {};

  it('allows jogging when machine is ON and in MANUAL mode', () => {
    const machine: LinuxCncMachineStatus = {
      ...baseMachine,
      task_state: TaskState.STATE_ON,
      task_mode: TaskMode.MODE_MANUAL,
    };

    const result = evaluateJogPreconditions(machine);

    expect(result.canJog).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('disables jogging when machine is OFF', () => {
    const machine: LinuxCncMachineStatus = {
      ...baseMachine,
      task_state: TaskState.STATE_OFF,
      task_mode: TaskMode.MODE_MANUAL,
    };

    const result = evaluateJogPreconditions(machine);

    expect(result.canJog).toBe(false);
    expect(result.reasons).toContain('machine_off');
  });

  it('disables jogging when ESTOP is active', () => {
    const machine: LinuxCncMachineStatus = {
      ...baseMachine,
      task_state: TaskState.STATE_ESTOP,
      task_mode: TaskMode.MODE_MANUAL,
    };

    const result = evaluateJogPreconditions(machine);

    expect(result.canJog).toBe(false);
    expect(result.reasons).toContain('estop_active');
    expect(result.reasons).not.toContain('machine_off');
  });

  it('disables jogging when not in MANUAL mode', () => {
    const machine: LinuxCncMachineStatus = {
      ...baseMachine,
      task_state: TaskState.STATE_ON,
      task_mode: TaskMode.MODE_AUTO,
    };

    const result = evaluateJogPreconditions(machine);

    expect(result.canJog).toBe(false);
    expect(result.reasons).toContain('not_manual_mode');
  });

  it('collects multiple reasons when applicable', () => {
    const machine: LinuxCncMachineStatus = {
      ...baseMachine,
      task_state: TaskState.STATE_OFF,
      task_mode: TaskMode.MODE_AUTO,
    };

    const result = evaluateJogPreconditions(machine);

    expect(result.canJog).toBe(false);
    expect(result.reasons).toContain('machine_off');
    expect(result.reasons).toContain('not_manual_mode');
  });

  it('treats missing machine status as disabled', () => {
    const result = evaluateJogPreconditions(undefined);

    expect(result.canJog).toBe(false);
    expect(result.reasons).toContain('machine_off');
    expect(result.reasons).toContain('not_manual_mode');
  });
});

describe('getJogDisabledTooltip', () => {
  it('returns localized messages for each reason', () => {
    expect(getJogDisabledTooltip('machine_off')).toMatch(/machine is off/i);
    expect(getJogDisabledTooltip('not_manual_mode')).toMatch(/manual mode/i);
    expect(getJogDisabledTooltip('estop_active')).toMatch(/emergency stop/i);
  });
});

describe('getCombinedJogDisabledTooltip', () => {
  it('returns null when there are no reasons', () => {
    expect(getCombinedJogDisabledTooltip([])).toBeNull();
  });

  it('joins multiple reasons with newlines', () => {
    const tooltip = getCombinedJogDisabledTooltip(['machine_off', 'not_manual_mode']);
    expect(tooltip).toContain('\n');
  });
});

