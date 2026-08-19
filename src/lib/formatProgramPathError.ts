import type { TFunction } from 'i18next';

export type ProgramPathError = {
  code?: string;
  message?: string;
  path?: string;
};

const PATH_ERROR_CODES = new Set([
  'not_a_directory',
  'outside_program_prefix',
  'file_not_found',
  'parent_not_found',
  'is_directory',
  'invalid_params',
]);

/** Legacy fallback when backend sent path only inside English message text. */
function pathFromBackendMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const match = message.match(/\(([^)]+)\)/);
  const candidate = match?.[1]?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
}

function resolvePath(error: ProgramPathError | undefined): string | undefined {
  const structured = error?.path?.trim();
  if (structured) return structured;
  return pathFromBackendMessage(error?.message);
}

/**
 * User-facing text for program.list / program.read / program.write path errors.
 * Prefers localized strings for known codes; falls back to backend message or generic text.
 */
export function formatProgramPathError(
  error: ProgramPathError | undefined,
  fallback: string,
  t: TFunction<'components'>,
): string {
  const code = error?.code?.trim();
  if (!code || !PATH_ERROR_CODES.has(code)) {
    return error?.message?.trim() || fallback;
  }

  const path = resolvePath(error);
  const pathSuffix = path ? `: ${path}` : '';

  return t(`programPathErrors.${code}`, { pathSuffix });
}
