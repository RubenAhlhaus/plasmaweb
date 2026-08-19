import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n/config';
import { IncrementSelector } from '../IncrementSelector';
import { useAppStore } from '@/store';

describe('IncrementSelector', () => {
  it('renders increments from iniRuntimeConfig.jog_increments_spec', () => {
    useAppStore.getState().setIniRuntimeConfig({
      jog_increments_spec: '3 mm, 2 mm, 1/8 in',
    });

    render(<IncrementSelector />);

    const continuous = i18n.t('jogIncrements.continuous', { ns: 'components' });
    expect(screen.getByRole('tab', { name: continuous })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '3 mm' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '2 mm' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '1/8 in' })).toBeTruthy();
  });

  it('renders gmoccapy-style space-separated increments', () => {
    useAppStore.getState().setIniRuntimeConfig({
      jog_increments_spec: '10mm 5mm 1mm .1mm .01mm .005mm',
    });

    render(<IncrementSelector />);

    const continuous = i18n.t('jogIncrements.continuous', { ns: 'components' });
    expect(screen.getByRole('tab', { name: continuous })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '10mm' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '5mm' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '1mm' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '.1mm' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '.01mm' })).toBeNull();
  });

  it('uses full-size shell classes when size is full', () => {
    useAppStore.getState().setIniRuntimeConfig({
      jog_increments_spec: '1 mm',
    });

    const { container } = render(<IncrementSelector size="full" />);

    expect(container.querySelector('.h-80')).toBeTruthy();
  });
});
