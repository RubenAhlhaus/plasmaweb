import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const subDir = join(repoRoot, 'resources/linuxcnc-subroutines');

/** Strip `;` comments and blank lines so motion order is easy to assert. */
function motionLines(source: string): string[] {
  return source
    .split('\n')
    .map((line) => {
      const cut = line.indexOf(';');
      return (cut >= 0 ? line.slice(0, cut) : line).trim();
    })
    .filter((line) => line.length > 0);
}

/**
 * First approach block: optional raise-if-below, then first XY rapid, then Z to safe.
 * Matches drill / helix (`#3`) and plan face (`#<_safez>`).
 */
function assertRaiseThenXyThenZ(lines: string[], safeZExpr: string): void {
  const raiseIf = lines.findIndex((l) => l.includes(`#<_z> LT ${safeZExpr}`));
  expect(raiseIf).toBeGreaterThanOrEqual(0);

  const raiseG0 = lines.findIndex((l, i) => i > raiseIf && l.startsWith('G0 Z'));
  expect(raiseG0).toBeGreaterThan(raiseIf);
  expect(lines[raiseG0]).toBe(`G0 Z${safeZExpr}`);

  const firstXy = lines.findIndex((l, i) => i > raiseG0 && l.startsWith('G0 X'));
  expect(firstXy).toBeGreaterThan(raiseG0);

  const afterXyZ = lines.findIndex((l, i) => i > firstXy && l.startsWith('G0 Z'));
  expect(afterXyZ).toBeGreaterThan(firstXy);
  expect(lines[afterXyZ]).toBe(`G0 Z${safeZExpr}`);

  for (let i = raiseG0 + 1; i < firstXy; i++) {
    expect(lines[i]).not.toMatch(/^G0\s+Z/);
  }
}

describe('linuxcnc subroutine initial approach order', () => {
  it.each([
    ['lcncgui_drill.ngc', '#3'],
    ['lcncgui_helix_bore.ngc', '#3'],
    ['lcncgui_plan_face.ngc', '#<_safez>'],
  ] as const)('%s raises if below, then XY, then Z', (file, safeZ) => {
    const lines = motionLines(readFileSync(join(subDir, file), 'utf8'));
    assertRaiseThenXyThenZ(lines, safeZ);
  });
});
