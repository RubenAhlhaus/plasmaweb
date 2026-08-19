import { expect, test } from '../fixtures/webTest';
import { headerUnhomedAxesLocator } from '../helpers/headerBarStatusLocators';

test.describe('header-unhomed-axes', () => {
  test.use({ skipVirtualSidebarMachineOn: true });

  test('shows unhomed indicator and opens homing dialog on click', async ({ appPage }) => {
    await appPage.evaluate(() => {
      window.__LCNCGUI_E2E__?.setConnectionStatus?.('connected');
      window.__LCNCGUI_E2E__?.setHomedFlags?.([0, 1, 0]);
    });

    const indicator = headerUnhomedAxesLocator(appPage);
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText('Referenz fehlt (X, Z)');

    await indicator.click();
    await expect(appPage.locator('[data-e2e="homing-home-all"]')).toBeVisible();
  });
});
