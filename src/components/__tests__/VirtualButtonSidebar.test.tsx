import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtualButtonSidebar } from '@/components/VirtualButtonSidebar';
import { useAppStore } from '@/store';
import { TaskState } from '@/store/types';

describe('VirtualButtonSidebar', () => {
  beforeEach(() => {
    useAppStore.setState({
      linuxCncStatus: {
        machine: { task_state: TaskState.STATE_ON },
        io: { flood: 0 },
        program: {},
        spindle: [{ direction: 0, enabled: 0, speed: 0 }],
      },
    });
  });

  afterEach(() => {
    useAppStore.getState().setLinuxCncStatus({ machine: {}, io: {}, program: {}, spindle: [] });
  });

  it('disables flood softkey when machine is not ON', () => {
    useAppStore.setState({
      linuxCncStatus: {
        machine: { task_state: TaskState.STATE_OFF },
        io: { flood: 0 },
        program: {},
        spindle: [],
      },
    });

    render(<VirtualButtonSidebar />);

    expect(screen.getByRole('button', { name: 'Flood coolant' })).toBeDisabled();
  });

  it('highlights HAL softkey 14 when io.hal_softkeys reports active', () => {
    useAppStore.setState({
      linuxCncStatus: {
        machine: { task_state: TaskState.STATE_ON },
        io: { flood: 0, hal_softkeys: { '14': 1, '15': 0, '16': 0 } },
        program: {},
        spindle: [{ direction: 0, enabled: 0, speed: 0 }],
      },
    });

    render(<VirtualButtonSidebar />);

    const halButton = screen.getByRole('button', { name: '14' });
    expect(halButton).toHaveAttribute('data-active', 'true');
  });

  it('keeps flood softkey enabled when machine is ON', async () => {
    const user = userEvent.setup();
    render(<VirtualButtonSidebar />);

    const floodButton = screen.getByRole('button', { name: 'Flood coolant' });
    expect(floodButton).toBeEnabled();
    await user.click(floodButton);
  });
});
