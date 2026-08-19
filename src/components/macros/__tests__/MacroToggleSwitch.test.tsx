import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MacroToggleSwitch } from '@/components/macros/MacroToggleSwitch';

describe('MacroToggleSwitch', () => {
  it('exposes on/off state via aria-label on the switch', () => {
    const { rerender } = render(
      <MacroToggleSwitch
        checked={false}
        label="Coolant"
        ariaLabelOn="Coolant on"
        ariaLabelOff="Coolant off"
        onCheckedChange={() => undefined}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Coolant off' })).toBeTruthy();
    expect(screen.getByText('Coolant')).toBeTruthy();

    rerender(
      <MacroToggleSwitch
        checked
        label="Coolant"
        ariaLabelOn="Coolant on"
        ariaLabelOff="Coolant off"
        onCheckedChange={() => undefined}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Coolant on' })).toBeTruthy();
  });

  it('calls onCheckedChange when clicked', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <MacroToggleSwitch
        checked={false}
        label="Option"
        ariaLabelOn="On"
        ariaLabelOff="Off"
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByRole('switch', { name: 'Off' }));
    expect(onCheckedChange).toHaveBeenCalledOnce();
  });

  it('does not call onCheckedChange when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <MacroToggleSwitch
        checked={false}
        label="Option"
        ariaLabelOn="On"
        ariaLabelOff="Off"
        onCheckedChange={onCheckedChange}
        disabled
      />,
    );

    const sw = screen.getByRole('switch', { name: 'Off' });
    expect(sw).toBeDisabled();
    await user.click(sw);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
