import { parseJogIncrementLabelToMm } from '../../src/lib/jogIncrements';
import { expect, test } from '../fixtures/webTest';
import { headerTaskModeManualLocator } from '../helpers/headerBarStatusLocators';
import { Screens } from '../pages/Screens';
import type { Page } from 'playwright/test';

type Axis = 'x' | 'y' | 'z';

const COORD_TIMEOUT_MS = 45_000;

const axisNegButtonName: Record<Axis, string> = {
  x: 'X-Achse links',
  y: 'Y-Achse zurück',
  z: 'Z-Achse runter',
};

const axisPosButtonName: Record<Axis, string> = {
  x: 'X-Achse rechts',
  y: 'Y-Achse vor',
  z: 'Z-Achse hoch',
};

async function readCoord(page: Page, axis: Axis): Promise<number> {
  const locator = page.locator(`[data-e2e="coord-${axis}"]`);
  await expect(locator).toBeVisible({ timeout: 5_000 });
  const text = (await locator.innerText()).trim();
  const n = Number(text.replace(',', '.'));
  expect(Number.isFinite(n)).toBe(true);
  return n;
}

function coordExpectedDisplay(expectedValue: number): number {
  return Number(expectedValue.toFixed(3));
}

async function waitForCoordToBe(page: Page, axis: Axis, expectedValue: number): Promise<void> {
  const expectedDisplay = coordExpectedDisplay(expectedValue);
  await expect
    .poll(async () => await readCoord(page, axis))
    .toBeCloseTo(expectedDisplay, 3, { timeout: COORD_TIMEOUT_MS });
}

async function dismissErrorToasts(page: Page): Promise<void> {
  const closeButtons = page.getByRole('button', { name: 'Fehlermeldung schließen' });
  for (let i = 0; i < 5; i += 1) {
    const first = closeButtons.first();
    const visible = await first.isVisible().catch(() => false);
    if (!visible) break;
    await first.click().catch(() => undefined);
    await page.waitForTimeout(50);
  }
}

async function clickJogAndAssertDistance(opts: {
  page: Page;
  axis: Axis;
  baselineCoord: number;
  velocitySign: 1 | -1;
  expectedDistanceMm: number;
}): Promise<number> {
  const { page, axis, baselineCoord, velocitySign, expectedDistanceMm } = opts;
  const buttonName = velocitySign < 0 ? axisNegButtonName[axis] : axisPosButtonName[axis];

  await dismissErrorToasts(page);
  const confirmDialogButton = page.getByRole('button', { name: 'Verstanden, im Gelenkmodus joggen' });
  await page.getByRole('button', { name: buttonName }).click();

  // If axis is not homed, the first click opens a dialog and doesn't send the jog command.
  // Rendering of the dialog is async, so we best-effort poll for it for a short time.
  for (let i = 0; i < 20; i += 1) {
    await dismissErrorToasts(page);
    const visible = await confirmDialogButton.isVisible().catch(() => false);
    if (visible) {
      await confirmDialogButton.click();
      break;
    }
    await page.waitForTimeout(100);
  }

  const expectedNextCoord = baselineCoord + velocitySign * expectedDistanceMm;
  await waitForCoordToBe(page, axis, expectedNextCoord);
  const actualNextCoord = await readCoord(page, axis);

  const delta = actualNextCoord - baselineCoord;
  const distance = Math.abs(delta);

  // The UI-selected increment is the source of truth for expected jog distance (delta magnitude).
  expect(distance).toBeCloseTo(expectedDistanceMm, 3);

  return distance;
}

test.describe('jogging', () => {
  test('jogs axes in incremental mode with dynamic increments', async ({ appPage }) => {
    await expect(new Screens(appPage).homeMarker()).toBeVisible({ timeout: 60_000 });

    const manualMode = headerTaskModeManualLocator(appPage);
    await expect(manualMode).toBeVisible({
      timeout: 15_000,
    });

    const incRoot = appPage.locator('[aria-label="Jog-Inkrement"]');
    await expect(incRoot).toBeVisible({ timeout: 10_000 });
    const incTabs = incRoot.locator('[role="tab"]');

    const rawTabTexts = (await incTabs.allTextContents()).map((t) => t.trim());
    const nonContinuous = rawTabTexts
      .map((txt, idx) => ({ txt, idx }))
      .filter(({ txt }) => {
        const lower = txt.toLowerCase();
        return Boolean(txt) && lower !== 'continuous' && lower !== 'kontinuierlich';
      });

    expect(nonContinuous.length).toBeGreaterThanOrEqual(3);

    // X uses first non-continuous increment (expected to be 1mm on the default setup),
    // then Y uses the next increment, then Z.
    const xIncTab = nonContinuous[0];
    const yIncTab = nonContinuous[1];
    const zIncTab = nonContinuous[2];

    const xIncrementMm = parseJogIncrementLabelToMm(xIncTab.txt);
    const yIncrementMm = parseJogIncrementLabelToMm(yIncTab.txt);
    const zIncrementMm = parseJogIncrementLabelToMm(zIncTab.txt);

    // Requirement: first increment is the 1mm step.
    expect(xIncrementMm).toBeCloseTo(1, 6);

    const axisSequence: Array<{ axis: Axis; incrementMm: number; incTabIdx: number }> = [
      { axis: 'x', incrementMm: xIncrementMm, incTabIdx: xIncTab.idx },
      { axis: 'y', incrementMm: yIncrementMm, incTabIdx: yIncTab.idx },
      { axis: 'z', incrementMm: zIncrementMm, incTabIdx: zIncTab.idx },
    ];

    for (const step of axisSequence) {
      await incTabs.nth(step.incTabIdx).click();

      const baseline = await readCoord(appPage, step.axis);

      // -1 * increment
      const dist1 = await clickJogAndAssertDistance({
        page: appPage,
        axis: step.axis,
        baselineCoord: baseline,
        velocitySign: -1,
        expectedDistanceMm: step.incrementMm,
      });
      await waitForCoordToBe(appPage, step.axis, baseline - step.incrementMm);

      // -2 * increment
      const baselineAfter1 = await readCoord(appPage, step.axis);
      const dist2 = await clickJogAndAssertDistance({
        page: appPage,
        axis: step.axis,
        baselineCoord: baselineAfter1,
        velocitySign: -1,
        expectedDistanceMm: step.incrementMm,
      });
      expect(dist2).toBeCloseTo(dist1, 5);
      await waitForCoordToBe(appPage, step.axis, baseline - step.incrementMm * 2);

      // back to -1 * increment
      const baselineAfter2 = await readCoord(appPage, step.axis);
      const dist3 = await clickJogAndAssertDistance({
        page: appPage,
        axis: step.axis,
        baselineCoord: baselineAfter2,
        velocitySign: 1,
        expectedDistanceMm: step.incrementMm,
      });
      expect(dist3).toBeCloseTo(dist1, 5);
      await waitForCoordToBe(appPage, step.axis, baseline - step.incrementMm);
    }
  });
});

