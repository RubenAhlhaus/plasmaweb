/**
 * Maps LinuxCNC `stat.motion_line` / `stat.current_line` (1-based file line numbers)
 * to a 0-based editor row index for {@link ProgramEditor}.
 *
 * Prefer `motion_line` when > 0 (motion in progress / last motion line), else `current_line`.
 * Values ≤ 0 are treated as “no line” (LinuxCNC uses 0 when idle / undefined).
 */
export function programLinesToEditorLineIndex(
  motionLine: number | undefined,
  currentLine: number | undefined,
): number | null {
  const raw =
    motionLine != null && motionLine > 0
      ? motionLine
      : currentLine != null && currentLine > 0
        ? currentLine
        : null;
  if (raw == null) return null;
  return raw - 1;
}
