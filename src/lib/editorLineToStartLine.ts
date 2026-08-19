/**
 * Maps a 1-based editor line number to WebSocket `startLine` for `program.auto` / `run`
 * (LinuxCNC `command.auto(AUTO_RUN, program_start_line)`).
 * `0` = start at beginning of file; first display line uses `0` so it matches project docs.
 */
export function editorLineToStartLine(line1Based: number): number {
  if (!Number.isFinite(line1Based) || line1Based < 1) return 0;
  if (line1Based <= 1) return 0;
  return line1Based;
}

/** Inverse of {@link editorLineToStartLine} for UI display (`0` → line 1). */
export function startLineToEditorLine1Based(startLine: number): number {
  if (!Number.isFinite(startLine) || startLine <= 0) return 1;
  return startLine;
}
