import { describe, expect, it, vi } from 'vitest';
import { formatProgramPathError } from '../formatProgramPathError';

const t = vi.fn((key: string, opts?: { pathSuffix?: string }) => {
  if (key === 'programPathErrors.not_a_directory') {
    return `Localized not a directory${opts?.pathSuffix ?? ''}.`;
  }
  if (key === 'programPathErrors.outside_program_prefix') {
    return `Outside prefix${opts?.pathSuffix ?? ''}.`;
  }
  return key;
});

describe('formatProgramPathError', () => {
  it('returns localized text with structured error.path', () => {
    const msg = formatProgramPathError(
      {
        code: 'not_a_directory',
        message: 'NC program directory does not exist',
        path: '/home/user/nc_files',
      },
      'fallback',
      t as never,
    );
    expect(msg).toBe('Localized not a directory: /home/user/nc_files.');
  });

  it('falls back to path in legacy backend message text', () => {
    const msg = formatProgramPathError(
      {
        code: 'outside_program_prefix',
        message: 'Path outside PROGRAM_PREFIX (/legacy/path).',
      },
      'fallback',
      t as never,
    );
    expect(msg).toBe('Outside prefix: /legacy/path.');
  });

  it('omits path suffix when no path is available', () => {
    const msg = formatProgramPathError(
      { code: 'not_a_directory', message: 'NC program directory does not exist' },
      'fallback',
      t as never,
    );
    expect(msg).toBe('Localized not a directory.');
  });

  it('falls back to backend message for unknown codes', () => {
    const msg = formatProgramPathError(
      { code: 'list_failed', message: 'Cannot list directory: permission denied' },
      'fallback',
      t as never,
    );
    expect(msg).toBe('Cannot list directory: permission denied');
  });

  it('uses fallback when error is missing', () => {
    expect(formatProgramPathError(undefined, 'fallback', t as never)).toBe('fallback');
  });

  it('uses fallback for known code when translation key is missing', () => {
    const msg = formatProgramPathError(
      { code: 'invalid_params', message: 'Invalid path', path: '/x' },
      'fallback',
      t as never,
    );
    expect(msg).toBe('programPathErrors.invalid_params');
  });
});
