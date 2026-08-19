import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MacroCoolantSwitch } from '@/components/macros/MacroCoolantSwitch';

describe('MacroCoolantSwitch', () => {
  it('toggles coolantOn and clears commit errors', () => {
    const setParams = vi.fn();
    const setCommitError = vi.fn();

    render(
      <MacroCoolantSwitch
        params={{ coolantOn: false }}
        setParams={setParams}
        setCommitError={setCommitError}
      />,
    );

    fireEvent.click(screen.getByRole('switch'));

    expect(setCommitError).toHaveBeenCalledWith(null);
    expect(setParams).toHaveBeenCalledOnce();
    const updater = setParams.mock.calls[0][0] as (prev: { coolantOn: boolean }) => { coolantOn: boolean };
    expect(updater({ coolantOn: false })).toEqual({ coolantOn: true });
  });
});
