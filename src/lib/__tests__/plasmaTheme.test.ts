import { describe, expect, it } from 'vitest';

import { hexToHslTriple, readableOn, themeVariables } from '@/lib/plasmaTheme';

const QTPLASMAC_DEFAULTS = {
  foreground: '#ffee06',
  highlight: '#ffee06',
  led: '#ffee06',
  background: '#16160e',
  backgroundAlt: '#36362e',
  frames: '#ffee06',
  estop: '#ff0000',
  disabled: '#b0b0b0',
  preview: '#000000',
};

describe('plasma theme', () => {
  it('converts hex to the triple this UI writes its tokens in', () => {
    expect(hexToHslTriple('#000000')).toBe('0 0% 0%');
    expect(hexToHslTriple('#ffffff')).toBe('0 0% 100%');
    expect(hexToHslTriple('#ff0000')).toBe('0 100% 50%');
    // QtPlasmaC's own yellow.
    expect(hexToHslTriple('#ffee06')).toBe('56 100% 51%');
  });

  it('refuses what is not a colour rather than emitting a broken token', () => {
    expect(hexToHslTriple('yellow')).toBeNull();
    expect(hexToHslTriple('#abc')).toBeNull(); // the backend normalises these before we see them
  });

  it('picks the readable text colour for a highlight by luminance', () => {
    // Bright yellow: the dark colour reads on it.
    expect(readableOn('#ffee06', '#ffffff', '#16160e')).toBe('#16160e');
    // Deep red: the light one does.
    expect(readableOn('#ff0000', '#ffffff', '#16160e')).toBe('#ffffff');
  });

  it('maps every QtPlasmaC colour onto a role in this UI', () => {
    const variables = themeVariables(QTPLASMAC_DEFAULTS);

    expect(variables['--background']).toBe(hexToHslTriple('#16160e'));
    expect(variables['--foreground']).toBe(hexToHslTriple('#ffee06'));
    // Frames draws QtPlasmaC's panel borders, so it draws ours.
    expect(variables['--border']).toBe(hexToHslTriple('#ffee06'));
    // Background Alt is its alternate surface.
    expect(variables['--card']).toBe(hexToHslTriple('#36362e'));
    expect(variables['--destructive']).toBe(hexToHslTriple('#ff0000'));
    // Text on the yellow highlight has to be the dark one.
    expect(variables['--primary-foreground']).toBe(hexToHslTriple('#16160e'));
  });

  it('keeps the three colours with no token as hex', () => {
    const variables = themeVariables(QTPLASMAC_DEFAULTS);

    expect(variables['--plasma-led']).toBe('#ffee06');
    expect(variables['--plasma-preview']).toBe('#000000');
  });
});
