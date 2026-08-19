import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomingDialog } from '@/components/HomingDialog';
import { eventBus } from '@/eventBus';

describe('HomingDialog', () => {
  it('publishes ui.homing.select with action home when Home X is clicked', async () => {
    const user = userEvent.setup();
    const received: Array<{ axis: string; action: string }> = [];
    const unsub = eventBus.subscribe('ui.homing.select', (payload) => {
      received.push(payload);
    });

    render(<HomingDialog />);

    await act(async () => {
      eventBus.publish('ui.homing.openDialog', { source: 'virtualSidebar' });
    });

    await user.click(screen.getByRole('button', { name: /Home X/i }));

    expect(received).toEqual([{ axis: 'x', action: 'home' }]);

    unsub();
  });

  it('publishes ui.homing.select with action unhome when Unhome All is clicked', async () => {
    const user = userEvent.setup();
    const received: Array<{ axis: string; action: string }> = [];
    const unsub = eventBus.subscribe('ui.homing.select', (payload) => {
      received.push(payload);
    });

    render(<HomingDialog />);

    await act(async () => {
      eventBus.publish('ui.homing.openDialog', { source: 'virtualSidebar' });
    });

    await user.click(screen.getByRole('button', { name: /Unhome All/i }));

    expect(received).toEqual([{ axis: 'all', action: 'unhome' }]);

    unsub();
  });
});
