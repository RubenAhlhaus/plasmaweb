import { describe, expect, it } from 'vitest';
import i18n from '@/i18n/config';
import {
  formatToolMaterialUi,
  normalizeToolMaterial,
  TOOL_MATERIAL_VALUES,
} from '@/types/tools';

describe('normalizeToolMaterial', () => {
  it('returns empty for blank or unknown', () => {
    expect(normalizeToolMaterial('')).toBe('');
    expect(normalizeToolMaterial('  ')).toBe('');
    expect(normalizeToolMaterial(null)).toBe('');
    expect(normalizeToolMaterial(undefined)).toBe('');
    expect(normalizeToolMaterial('Stahl')).toBe('');
    expect(normalizeToolMaterial('VHM')).toBe('');
    expect(normalizeToolMaterial('Hartmetall')).toBe('');
    expect(normalizeToolMaterial('Keramik')).toBe('');
  });

  it('accepts canonical English values case-insensitively', () => {
    for (const v of TOOL_MATERIAL_VALUES) {
      expect(normalizeToolMaterial(v)).toBe(v);
      expect(normalizeToolMaterial(v.toUpperCase())).toBe(v);
    }
    expect(normalizeToolMaterial('hss')).toBe('HSS');
    expect(normalizeToolMaterial('CARBIDE')).toBe('Carbide');
  });

  it('accepts Ceramic and carbide spelling case-insensitively as canonical English', () => {
    expect(normalizeToolMaterial('Ceramic')).toBe('Ceramic');
    expect(normalizeToolMaterial('ceramic')).toBe('Ceramic');
    expect(normalizeToolMaterial('carbide')).toBe('Carbide');
  });
});

describe('formatToolMaterialUi', () => {
  it('returns English UI labels for canonical storage values (default locale)', () => {
    expect(formatToolMaterialUi('Carbide')).toBe('Carbide');
    expect(formatToolMaterialUi('Ceramic')).toBe('Ceramic');
    expect(formatToolMaterialUi('Titanium coated')).toBe('Titanium coated');
    expect(formatToolMaterialUi('HSS')).toBe('HSS');
  });

  it('returns German UI labels when locale is de', async () => {
    await i18n.changeLanguage('de');
    expect(formatToolMaterialUi('Carbide')).toBe('Hartmetall');
    expect(formatToolMaterialUi('Ceramic')).toBe('Keramik');
    expect(formatToolMaterialUi('Titanium coated')).toBe('Titan beschichtet');
    expect(formatToolMaterialUi('HSS')).toBe('HSS');
    await i18n.changeLanguage('en');
  });
});
