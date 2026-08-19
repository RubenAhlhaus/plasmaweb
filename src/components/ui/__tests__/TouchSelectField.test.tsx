import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TouchSelectField } from '../TouchSelectField';

describe('TouchSelectField', () => {
  it('opens picker and calls onChange with selected value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TouchSelectField
        label="Feld"
        value=""
        onChange={onChange}
        allowEmpty
        emptyLabel="–"
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Feld/i }));

    const picker = screen.getByRole('dialog', { name: 'Feld' });
    expect(picker).toBeTruthy();

    await user.click(screen.getByRole('option', { name: 'Beta' }));

    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('dialog', { name: 'Feld' })).toBeNull();
  });

  it('supports empty choice when allowEmpty', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TouchSelectField
        label="X"
        value="a"
        onChange={onChange}
        allowEmpty
        emptyLabel="leer"
        options={[{ value: 'a', label: 'A' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /X/i }));
    await user.click(screen.getByRole('option', { name: 'leer' }));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('uses dialogTitle for the picker heading', async () => {
    const user = userEvent.setup();
    render(
      <TouchSelectField
        label="Feld"
        dialogTitle="Eigener Titel"
        value=""
        onChange={() => undefined}
        allowEmpty
        options={[{ value: 'x', label: 'X' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Feld/i }));
    expect(screen.getByRole('heading', { name: 'Eigener Titel' })).toBeTruthy();
  });

  it('hideLabel exposes aria-label and no visible field label', () => {
    const { container } = render(
      <TouchSelectField
        label="Kühlmittel"
        hideLabel
        value="off"
        onChange={() => undefined}
        options={[{ value: 'off', label: 'Aus' }]}
      />,
    );

    expect(container.querySelector('label')).toBeNull();
    expect(screen.getByRole('button', { name: 'Kühlmittel' })).toBeTruthy();
  });

  it('moves focus with ArrowDown between options', async () => {
    const user = userEvent.setup();
    render(
      <TouchSelectField
        label="Feld"
        value=""
        onChange={() => undefined}
        allowEmpty
        emptyLabel="–"
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Feld/i }));
    const emptyOpt = screen.getByRole('option', { name: '–' });
    const alphaOpt = screen.getByRole('option', { name: 'Alpha' });

    expect(emptyOpt).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(alphaOpt).toHaveFocus();
  });

  it('disables trigger when there are no options and allowEmpty is false', () => {
    render(
      <TouchSelectField label="Leer" value="" onChange={() => undefined} options={[]} />,
    );
    expect(screen.getByRole('button', { name: /Leer/i })).toBeDisabled();
  });

  it('warns in dev on duplicate option values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <TouchSelectField
        label="T"
        value="a"
        onChange={() => undefined}
        options={[
          { value: 'a', label: '1' },
          { value: 'a', label: '2' },
        ]}
      />,
    );
    expect(warn).toHaveBeenCalledWith('[TouchSelectField] duplicate option value:', 'a');
    warn.mockRestore();
  });

  it('renders pickerDataE2e on dialog root', async () => {
    const user = userEvent.setup();
    render(
      <TouchSelectField
        label="L"
        value="x"
        onChange={() => undefined}
        pickerDataE2e="my-picker"
        options={[{ value: 'x', label: 'X' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /L/i }));
    expect(screen.getByRole('dialog', { name: 'L' })).toHaveAttribute('data-e2e', 'my-picker');
  });
});
