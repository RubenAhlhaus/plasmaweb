import { describe, expect, it } from 'vitest';
import {
  buildProgramReadParams,
  hasPathForProgramRead,
  programReadRequestKey,
} from '../programReadPath';

describe('programReadPath', () => {
  it('hasPathForProgramRead is true when either path is set', () => {
    expect(hasPathForProgramRead('/a.ngc', null)).toBe(true);
    expect(hasPathForProgramRead(null, '/b.ngc')).toBe(true);
    expect(hasPathForProgramRead('', '  ')).toBe(false);
    expect(hasPathForProgramRead(null, null)).toBe(false);
  });

  it('buildProgramReadParams sends both paths when they differ', () => {
    expect(buildProgramReadParams('/config/ncfiles/lib/a.ngc', '/usr/share/a.ngc')).toEqual({
      path: '/config/ncfiles/lib/a.ngc',
      statusPath: '/usr/share/a.ngc',
    });
  });

  it('buildProgramReadParams sends only editor path when equal or only editor set', () => {
    expect(buildProgramReadParams('/same.ngc', '/same.ngc')).toEqual({ path: '/same.ngc' });
    expect(buildProgramReadParams('/only.ngc', null)).toEqual({ path: '/only.ngc' });
  });

  it('buildProgramReadParams falls back to status when editor missing', () => {
    expect(buildProgramReadParams(null, '/status.ngc')).toEqual({ path: '/status.ngc' });
  });

  it('programReadRequestKey distinguishes statusPath pairs', () => {
    const params = { path: '/a.ngc', statusPath: '/b.ngc' };
    expect(programReadRequestKey(params)).toBe('/a.ngc\0/b.ngc');
    expect(programReadRequestKey({ path: '/a.ngc' })).toBe('/a.ngc');
  });
});
