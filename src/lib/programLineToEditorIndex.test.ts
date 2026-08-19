import { describe, it, expect } from 'vitest';
import { programLinesToEditorLineIndex } from './programLineToEditorIndex';

describe('programLinesToEditorLineIndex', () => {
  it('prefers motion_line when > 0', () => {
    expect(programLinesToEditorLineIndex(5, 10)).toBe(4);
  });

  it('falls back to current_line when motion is 0 or undefined', () => {
    expect(programLinesToEditorLineIndex(0, 3)).toBe(2);
    expect(programLinesToEditorLineIndex(undefined, 2)).toBe(1);
  });

  it('returns null when no positive line', () => {
    expect(programLinesToEditorLineIndex(0, 0)).toBe(null);
    expect(programLinesToEditorLineIndex(undefined, undefined)).toBe(null);
  });

  it('maps first line to index 0', () => {
    expect(programLinesToEditorLineIndex(1, undefined)).toBe(0);
  });
});
