import { expect, test } from '../fixtures/webTest';
import type { Page } from 'playwright/test';
import { ensureAxesHomed } from '../helpers/ensureAxesHomed';
import {
  attachOutgoingWebSocketTap,
  matchProgramMdiWithText,
} from '../helpers/outgoingWebSocketCommands';
import { Screens } from '../pages/Screens';

const COORD_TIMEOUT_MS = 45_000;

async function readCoordX(page: Page): Promise<number> {
  const locator = page.locator('[data-e2e="coord-x"]');
  await expect(locator).toBeVisible({ timeout: 5_000 });
  const text = (await locator.innerText()).trim();
  const value = Number(text.replace(',', '.'));
  expect(Number.isFinite(value)).toBe(true);
  return value;
}

test.describe('mdi', () => {
  test('sends program.mdi G0 command and reaches target x coordinate', async ({ appPage }) => {
    const tap = attachOutgoingWebSocketTap(appPage);
    try {
      await expect(new Screens(appPage).homeMarker()).toBeVisible({ timeout: 60_000 });
      await ensureAxesHomed(appPage);

      const mdiInput = appPage.locator('#mdi-input');
      const mdiSend = appPage.locator('[data-e2e="mdi-send"]');
      await expect(mdiInput).toBeVisible({ timeout: 10_000 });
      await expect(mdiSend).toBeEnabled({ timeout: 10_000 });

      const baselineX = await readCoordX(appPage);
      const targetX = Number((baselineX + 1).toFixed(3));
      const mdiCommand = `G0 X${targetX.toFixed(3)}`;

      const nextCommand = tap.waitForNextOutgoingCommand(matchProgramMdiWithText(mdiCommand), {
        timeoutMs: 20_000,
      });

      await mdiInput.fill(mdiCommand);
      await mdiInput.press('Enter');
      await nextCommand;

      await expect
        .poll(async () => await readCoordX(appPage), { timeout: COORD_TIMEOUT_MS })
        .toBeCloseTo(targetX, 3);
    } finally {
      tap.dispose();
    }
  });
});
