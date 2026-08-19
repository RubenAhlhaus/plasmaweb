import { describe, expect, it } from 'vitest';
import {
  isUserSubroutineMacroId,
  userSubroutineDefinitionFromInfo,
  userSubroutineMacroId,
  userSubroutineNameFromMacroId,
} from '@/data/userSubroutineMacros';

describe('userSubroutineMacros', () => {
  it('builds and parses user-ngc ids', () => {
    expect(userSubroutineMacroId('go_home')).toBe('user-ngc-go_home');
    expect(isUserSubroutineMacroId('user-ngc-go_home')).toBe(true);
    expect(isUserSubroutineMacroId('bohren-normal')).toBe(false);
    expect(userSubroutineNameFromMacroId('user-ngc-go_home')).toBe('go_home');
  });

  it('builds a machine-category definition from file info', () => {
    const def = userSubroutineDefinitionFromInfo({
      name: 'go_home',
      fileName: 'go_home.ngc',
      path: '/cfg/macros/go_home.ngc',
    });
    expect(def.id).toBe('user-ngc-go_home');
    expect(def.category).toBe('machine');
    expect(def.title).toBe('go_home');
    expect(def.subtitle).toBe('go_home.ngc');
    expect(def.defaultParams).toEqual({});
  });
});
