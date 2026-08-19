import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  isDrillPeckingEnabled,
  MacroFullRetractSwitch,
} from '@/components/macros/MacroFullRetractSwitch';

describe('isDrillPeckingEnabled', () => {
  it('is true only when plunge depth is set and below total depth', () => {
    expect(isDrillPeckingEnabled({ depth: '10', einstechtiefeMm: '3' })).toBe(true);
    expect(isDrillPeckingEnabled({ depth: '10', einstechtiefeMm: '10' })).toBe(false);
    expect(isDrillPeckingEnabled({ depth: '10', einstechtiefeMm: '' })).toBe(false);
    expect(isDrillPeckingEnabled({ depth: '10' })).toBe(false);
  });
});

describe('MacroFullRetractSwitch', () => {
  it('toggles fullRetract and clears commit errors when pecking', () => {
    const setParams = vi.fn();
    const setCommitError = vi.fn();

    render(
      <MacroFullRetractSwitch
        params={{ depth: '10', einstechtiefeMm: '3', fullRetract: false }}
        setParams={setParams}
        setCommitError={setCommitError}
      />,
    );

    const sw = screen.getByRole('switch');
    expect(sw).not.toBeDisabled();
    fireEvent.click(sw);

    expect(setCommitError).toHaveBeenCalledWith(null);
    expect(setParams).toHaveBeenCalledOnce();
    const updater = setParams.mock.calls[0][0] as (prev: {
      fullRetract: boolean;
    }) => { fullRetract: boolean };
    expect(updater({ fullRetract: false })).toEqual({ fullRetract: true });
  });

  it('is disabled and does not toggle when not pecking', () => {
    const setParams = vi.fn();
    const setCommitError = vi.fn();

    render(
      <MacroFullRetractSwitch
        params={{ depth: '10', einstechtiefeMm: '10', fullRetract: false }}
        setParams={setParams}
        setCommitError={setCommitError}
      />,
    );

    const sw = screen.getByRole('switch');
    expect(sw).toBeDisabled();
    fireEvent.click(sw);
    expect(setParams).not.toHaveBeenCalled();
    expect(setCommitError).not.toHaveBeenCalled();
  });
});
