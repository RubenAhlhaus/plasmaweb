import { describe, expect, it } from 'vitest';
import { macroHintKeyForField } from '@/components/macros/macroParamFieldUtils';
import type { MacroHintDefinition } from '@/data/macroHintDefinitions';

const hintDefinition = {
  svgPath: '/macro/test.svg',
  ariaLabelKey: 'hints.test',
  sidebarWidthClass: '12rem',
} as MacroHintDefinition;

describe('macroHintKeyForField', () => {
  it('returns the field key when a hint definition exists', () => {
    expect(macroHintKeyForField(hintDefinition, 'depth')).toBe('depth');
  });

  it('returns null when there is no hint definition', () => {
    expect(macroHintKeyForField(null, 'depth')).toBeNull();
  });
});
