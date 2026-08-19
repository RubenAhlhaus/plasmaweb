export type ProgramReadParams = {
  path: string;
  statusPath?: string;
};

/** Stable key for pending/failed program.read correlation maps. */
export function programReadRequestKey(params: ProgramReadParams): string {
  return params.statusPath != null ? `${params.path}\0${params.statusPath}` : params.path;
}

/** Whether a program.read request can be sent (editor path and/or LinuxCNC status path). */
export function hasPathForProgramRead(
  filePath: string | null | undefined,
  statusProgramFile: string | null,
): boolean {
  return Boolean(filePath?.trim() || statusProgramFile?.trim());
}

/**
 * Build `program.read` params. When both paths differ, send both so the backend can
 * prefer the logical editor path for symlinks but LinuxCNC status when files differ.
 */
export function buildProgramReadParams(
  filePath: string | null | undefined,
  statusProgramFile: string | null,
): ProgramReadParams | null {
  const editor = filePath?.trim() || null;
  const status = statusProgramFile?.trim() || null;
  if (!editor && !status) return null;
  if (editor && status && status !== editor) {
    return { path: editor, statusPath: status };
  }
  return { path: editor ?? status ?? '' };
}
