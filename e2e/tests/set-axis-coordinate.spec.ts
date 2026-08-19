import { expect, test } from '../fixtures/webTest';
import type { Page } from 'playwright/test';
import { attachOutgoingWebSocketTap } from '../helpers/outgoingWebSocketCommands';
import { Screens } from '../pages/Screens';

const COORD_TIMEOUT_MS = 45_000;

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

async function readCoordX(page: Page): Promise<number> {
  const locator = page.locator('[data-e2e="coord-x"]');
  await expect(locator).toBeVisible({ timeout: 5_000 });
  const text = (await locator.innerText()).trim();
  const value = Number(text.replace(',', '.'));
  expect(Number.isFinite(value)).toBe(true);
  return value;
}

test.describe('motion.set_axis_coordinate', () => {
  test('sets x coordinate from coordinates dialog and updates coordinate display', async ({
    appPage,
  }) => {
    const tap = attachOutgoingWebSocketTap(appPage);
    try {
      await expect(new Screens(appPage).homeMarker()).toBeVisible({ timeout: 60_000 });

      const baselineX = await readCoordX(appPage);
      const targetX = Number((baselineX + 1).toFixed(3));
      const targetInput = targetX.toFixed(3);

      await dismissErrorToasts(appPage);
      await appPage.locator('[data-e2e="coord-x"]').click();
      const coordinateDialog = appPage
        .getByRole('dialog')
        .filter({ hasText: 'Koordinatensysteme & Offsets' });
      await expect(coordinateDialog).toBeVisible();

      await dismissErrorToasts(appPage);
      await coordinateDialog.getByRole('button', { name: 'X Achse setzen…' }).click();

      const axisDialog = appPage
        .getByRole('dialog')
        .filter({ hasText: 'X-Achse auf Wert setzen' });
      await expect(axisDialog).toBeVisible();

      const setCommand = tap.waitForNextOutgoingCommand(
        (msg) =>
          msg.category === 'motion' &&
          msg.action === 'set_axis_coordinate' &&
          msg.params?.axis === 'x' &&
          Number(msg.params?.value) === targetX,
        { timeoutMs: 20_000 },
      );

      await axisDialog.locator('[data-e2e="axis-coordinate-input"]').fill(targetInput);
      await axisDialog.getByRole('button', { name: 'Bestätigen' }).click();
      await setCommand;
      await expect(axisDialog).toBeHidden();

      await expect
        .poll(async () => await readCoordX(appPage), { timeout: COORD_TIMEOUT_MS })
        .toBeCloseTo(targetX, 3);

      await coordinateDialog.getByRole('button', { name: 'Schließen' }).click();
      await expect(coordinateDialog).toBeHidden();
    } finally {
      tap.dispose();
    }
  });
});
