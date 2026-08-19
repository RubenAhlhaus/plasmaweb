import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeaderBar } from '@/components/HeaderBar';
import { useAppStore } from '@/store';
import { InterpState, TaskMode, TaskState } from '@/store/types';
import { eventBus } from '@/eventBus';

const initialLinuxCncStatus = {
  machine: {},
  motion: {},
  io: {},
  program: {},
  overrides: {},
  spindle: [],
  joints: [],
  axes: [],
  tools: {},
};

describe('HeaderBar', () => {
  beforeEach(() => {
    useAppStore.setState({
      connectionStatus: 'disconnected',
      linuxCncStatus: initialLinuxCncStatus,
    });
  });

  it('shows an unhomed-axes indicator when connected and axes are not homed', () => {
    useAppStore.setState({
      connectionStatus: 'connected',
      linuxCncStatus: {
        ...initialLinuxCncStatus,
        machine: {
          task_state: TaskState.STATE_ON,
          task_mode: TaskMode.MODE_MANUAL,
        },
        motion: { homed: [1, 0, 0] },
      },
    });

    render(<HeaderBar />);

    expect(
      screen.getByRole('button', { name: /Open homing — axes not homed: Y, Z/i }),
    ).toHaveTextContent('Not homed (Y, Z)');
  });

  it('hides the unhomed-axes indicator when all axes are homed', () => {
    useAppStore.setState({
      connectionStatus: 'connected',
      linuxCncStatus: {
        ...initialLinuxCncStatus,
        machine: {
          task_state: TaskState.STATE_ON,
          task_mode: TaskMode.MODE_MANUAL,
        },
        motion: { homed: [1, 1, 1] },
      },
    });

    render(<HeaderBar />);

    expect(screen.queryByRole('button', { name: /Open homing — axes not homed/i })).not.toBeInTheDocument();
  });

  it('hides the unhomed-axes indicator when disconnected', () => {
    useAppStore.setState({
      connectionStatus: 'disconnected',
      linuxCncStatus: {
        ...initialLinuxCncStatus,
        motion: { homed: [0, 0, 0] },
      },
    });

    render(<HeaderBar />);

    expect(screen.queryByRole('button', { name: /Open homing — axes not homed/i })).not.toBeInTheDocument();
  });

  it('treats axes as homed via joints when motion.homed is missing', () => {
    useAppStore.setState({
      connectionStatus: 'connected',
      linuxCncStatus: {
        ...initialLinuxCncStatus,
        motion: {},
        joints: [{ homed: 1 }, { homed: 1 }, { homed: 1 }],
      },
    });

    render(<HeaderBar />);

    expect(screen.queryByRole('button', { name: /Open homing — axes not homed/i })).not.toBeInTheDocument();
  });

  it('opens the homing dialog when the unhomed-axes indicator is clicked', async () => {
    const user = userEvent.setup();
    const received: Array<{ source: string }> = [];
    const unsub = eventBus.subscribe('ui.homing.openDialog', (payload) => {
      received.push(payload);
    });

    useAppStore.setState({
      connectionStatus: 'connected',
      linuxCncStatus: {
        ...initialLinuxCncStatus,
        motion: { homed: [0, 0, 0] },
      },
    });

    render(<HeaderBar />);

    await user.click(screen.getByRole('button', { name: /Open homing — axes not homed: X, Y, Z/i }));

    expect(received).toEqual([{ source: 'header' }]);

    unsub();
  });

  it('keeps Program mode label and shows Program running when interpreter is busy in auto', () => {
    useAppStore.setState({
      connectionStatus: 'connected',
      linuxCncStatus: {
        ...initialLinuxCncStatus,
        machine: {
          task_state: TaskState.STATE_ON,
          task_mode: TaskMode.MODE_AUTO,
        },
        motion: { homed: [1, 1, 1] },
        program: { interp_state: InterpState.INTERP_READING },
      },
    });

    render(<HeaderBar />);

    expect(document.querySelector('[data-e2e="header-task-mode-on"]')).toHaveTextContent('Program');
    expect(document.querySelector('[data-e2e="header-program-running"]')).toHaveTextContent(
      'Program running…',
    );
    expect(document.querySelector('[data-e2e="header-program-paused"]')).toBeNull();
  });

  it('shows Program paused when interpreter is paused in auto', () => {
    useAppStore.setState({
      connectionStatus: 'connected',
      linuxCncStatus: {
        ...initialLinuxCncStatus,
        machine: {
          task_state: TaskState.STATE_ON,
          task_mode: TaskMode.MODE_AUTO,
        },
        motion: { homed: [1, 1, 1] },
        program: { interp_state: InterpState.INTERP_PAUSED },
      },
    });

    render(<HeaderBar />);

    expect(document.querySelector('[data-e2e="header-task-mode-on"]')).toHaveTextContent('Program');
    expect(document.querySelector('[data-e2e="header-program-paused"]')).toHaveTextContent(
      'Program paused…',
    );
    expect(document.querySelector('[data-e2e="header-program-running"]')).toBeNull();
  });

  it('hides Program running/paused when auto mode is idle', () => {
    useAppStore.setState({
      connectionStatus: 'connected',
      linuxCncStatus: {
        ...initialLinuxCncStatus,
        machine: {
          task_state: TaskState.STATE_ON,
          task_mode: TaskMode.MODE_AUTO,
        },
        motion: { homed: [1, 1, 1] },
        program: { interp_state: InterpState.INTERP_IDLE },
      },
    });

    render(<HeaderBar />);

    expect(document.querySelector('[data-e2e="header-task-mode-on"]')).toHaveTextContent('Program');
    expect(document.querySelector('[data-e2e="header-program-running"]')).toBeNull();
    expect(document.querySelector('[data-e2e="header-program-paused"]')).toBeNull();
  });
});
