import { describe, expect, it } from 'vitest';
import { editorLineToStartLine, startLineToEditorLine1Based } from '@/lib/editorLineToStartLine';

describe('editorLineToStartLine', () => {
  it('maps first line to 0', () => {
    expect(editorLineToStartLine(1)).toBe(0);
  });

  it('maps further lines to the same number', () => {
    expect(editorLineToStartLine(5)).toBe(5);
  });

  it('returns 0 for invalid input', () => {
    expect(editorLineToStartLine(0)).toBe(0);
    expect(editorLineToStartLine(-1)).toBe(0);
  });
});

describe('startLineToEditorLine1Based', () => {
  it('maps 0 to line 1', () => {
    expect(startLineToEditorLine1Based(0)).toBe(1);
  });

  it('maps further start lines to the same number', () => {
    expect(startLineToEditorLine1Based(5)).toBe(5);
  });

  it('returns 1 for invalid input', () => {
    expect(startLineToEditorLine1Based(-1)).toBe(1);
  });
});
