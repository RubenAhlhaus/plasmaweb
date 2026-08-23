import { describe, expect, it } from 'vitest';

import de from '@/locales/de/plasma.json';
import en from '@/locales/en/plasma.json';

/**
 * The explanations are only worth having if they describe the parameter the machine actually
 * has. These check the set against the backend's own key list — a renamed parameter with a
 * stale explanation is worse than one with none.
 */
const BACKEND_KEYS = [
  'Arc Fail Timeout',
  'Arc OK High',
  'Arc OK Low',
  'Arc Maximum Starts',
  'Arc Voltage Offset',
  'Arc Voltage Scale',
  'Velocity Anti Dive Threshold',
  'Float Switch Travel',
  'Height Per Volt',
  'Offset Feed Rate',
  'Ohmic Maximum Attempts',
  'Ohmic Probe Offset',
  'Pid P Gain',
  'Pid D Gain',
  'Pid I Gain',
  'Probe Feed Rate',
  'Probe Start Height',
  'Slat Height',
  'Arc Restart Delay',
  'Safe Height',
  'Setup Feed Rate',
  'Scribe Arming Delay',
  'Scribe On Delay',
  'Skip IHS Distance',
  'Spotting Threshold',
  'Spotting Time',
  'THC Delay',
  'THC Sample Counts',
  'THC Sample Threshold',
  'THC Threshold',
  'Void Sense Slope',
  'X Pierce Offset',
  'Y Pierce Offset',
];

const help = en.parameters.help as Record<string, string>;

describe('parameter explanations', () => {
  it('every explanation names a parameter the machine has', () => {
    for (const key of Object.keys(help)) {
      expect(BACKEND_KEYS).toContain(key);
    }
  });

  it('German has the same set, so one language is not quietly bare', () => {
    expect(Object.keys(de.parameters.help as Record<string, string>).sort()).toEqual(
      Object.keys(help).sort(),
    );
  });

  it('says the thing about Spotting Time that costs a thousand times', () => {
    // The unit is the one detail an operator cannot get wrong quietly.
    expect(help['Spotting Time']).toContain('Milliseconds');
  });

  it('an explanation is a sentence, not a restatement of the label', () => {
    for (const [key, text] of Object.entries(help)) {
      expect(text.length).toBeGreaterThan(key.length + 15);
      expect(text.endsWith('.')).toBe(true);
    }
  });
});
