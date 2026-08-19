import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TouchNumericEntry } from '@/components/numeric/TouchNumericEntry';

describe('TouchNumericEntry', () => {
  it('strips letters and keeps numbers, operators, comma and parentheses', () => {
    const onChange = vi.fn();
    render(
      <TouchNumericEntry
        value=""
        onChange={onChange}
        keypadMode="focus"
        showPreview={false}
      />,
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '12a+3,5*(x2)' } });
    expect(onChange).toHaveBeenCalledWith('12+3,5*(2)');
  });

  it('keyboardDecimalOnly: keeps only decimal number prefix from keyboard', () => {
    const onChange = vi.fn();
    render(
      <TouchNumericEntry
        value=""
        onChange={onChange}
        keypadMode="focus"
        showPreview={false}
        keyboardDecimalOnly
      />,
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '12+3a' } });
    expect(onChange).toHaveBeenCalledWith('12');
  });

  it('replaces value on first keypad press after focusSelectSessionKey', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TouchNumericEntry
        value="100"
        onChange={onChange}
        integerOnly
        keypadMode="always"
        focusSelectSessionKey={1}
      />,
    );

    const input = screen.getByRole('textbox');
    await waitFor(() => expect(input).toHaveFocus());

    await user.click(screen.getByRole('button', { name: '5' }));
    expect(onChange).toHaveBeenLastCalledWith('5');
  });

  it('appends after second keypad press', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <TouchNumericEntry
        value="100"
        onChange={onChange}
        integerOnly
        keypadMode="always"
        focusSelectSessionKey={1}
      />,
    );

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    await user.click(screen.getByRole('button', { name: '5' }));
    expect(onChange).toHaveBeenLastCalledWith('5');

    onChange.mockClear();
    rerender(
      <TouchNumericEntry
        value="5"
        onChange={onChange}
        integerOnly
        keypadMode="always"
        focusSelectSessionKey={1}
      />,
    );

    await user.click(screen.getByRole('button', { name: '0' }));
    expect(onChange).toHaveBeenLastCalledWith('50');
  });
});
