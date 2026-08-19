import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MacroNumericParamField } from '@/components/macros/MacroNumericParamField';

const pickerPropsSpy = vi.fn();

vi.mock('@/components/numeric', () => ({
  TouchNumericPickerField: (props: Record<string, unknown>) => {
    pickerPropsSpy(props);
    return (
      <div>
        <span>{props.label as string}</span>
        <button type="button" onClick={() => (props.onChange as (v: string) => void)('99')}>
          commit
        </button>
        <button
          type="button"
          onClick={() => (props.onDialogOpenChange as ((open: boolean) => void) | undefined)?.(true)}
        >
          open-dialog
        </button>
      </div>
    );
  },
}));

describe('MacroNumericParamField', () => {
  it('updates params and clears commit errors for a plain field', async () => {
    pickerPropsSpy.mockClear();
    const user = userEvent.setup();
    const setParams = vi.fn();
    const setCommitError = vi.fn();
    const stackOnOpen = vi.fn();

    render(
      <MacroNumericParamField
        paramKey="feed"
        label="Feed"
        params={{ feed: '100' }}
        setParams={setParams}
        setCommitError={setCommitError}
        dialogAside={null}
        touchNumericStackProps={{ onDialogOpenChange: stackOnOpen }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'commit' }));

    expect(setCommitError).toHaveBeenCalledWith(null);
    expect(setParams).toHaveBeenCalledOnce();
    const updater = setParams.mock.calls[0][0] as (prev: { feed: string }) => { feed: string };
    expect(updater({ feed: '100' })).toEqual({ feed: '99' });
    expect(pickerPropsSpy.mock.calls.at(-1)?.[0].onDialogOpenChange).toBe(stackOnOpen);
  });

  it('routes dialog open through createNumericDialogOpenHandler when hintWrap is set', async () => {
    pickerPropsSpy.mockClear();
    const user = userEvent.setup();
    const hintOpen = vi.fn();
    const createNumericDialogOpenHandler = vi.fn(() => hintOpen);

    render(
      <MacroNumericParamField
        paramKey="depth"
        label="Depth"
        params={{ depth: '5' }}
        setParams={vi.fn()}
        setCommitError={vi.fn()}
        dialogAside={null}
        hintWrap
        hintKey="depth"
        setHoveredHintKey={vi.fn()}
        createNumericDialogOpenHandler={createNumericDialogOpenHandler}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'open-dialog' }));

    expect(createNumericDialogOpenHandler).toHaveBeenCalledWith('depth');
    expect(hintOpen).toHaveBeenCalledWith(true);
  });

  it('wraps fields without hint graphics in a fallback div', () => {
    pickerPropsSpy.mockClear();
    const { container } = render(
      <MacroNumericParamField
        paramKey="areaStartX"
        label="Start X"
        params={{ areaStartX: '0' }}
        setParams={vi.fn()}
        setCommitError={vi.fn()}
        dialogAside={null}
        fallbackWrapper
      />,
    );

    expect(container.querySelector('div > div')).toBeTruthy();
    expect(container.querySelector('[onMouseEnter]')).toBeNull();
  });
});
