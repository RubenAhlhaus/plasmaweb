import { expect, test } from '../fixtures/webTest';
import { E2E_SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY } from '../helpers/e2eVirtualSidebar';
import { Screens } from '../pages/Screens';

const JOG_INCREMENT_TABLIST = 'Jog-Inkrement';

test.describe('home-responsive-layout', () => {
  test.use({ skipVirtualSidebarMachineOn: true });

  test('shows full jog controls at 1920×1080 (E2E baseline with virtual sidebar)', async ({ appPage }) => {
    await appPage.setViewportSize({ width: 1920, height: 1080 });
    const screens = new Screens(appPage);

    await expect(screens.homeMarker()).toBeVisible({ timeout: 60_000 });
    await expect(appPage.getByRole('tablist', { name: JOG_INCREMENT_TABLIST })).toBeVisible();
    await expect(appPage.locator('[data-e2e="home-jog-controls"]')).toBeVisible();
    await expect(appPage.getByText('Active codes')).toBeVisible();

    await expect(appPage.locator('[data-e2e="home-jog-panel"]')).toHaveAttribute('data-jog-size', 'full');

    const incrementList = appPage.getByRole('tablist', { name: JOG_INCREMENT_TABLIST });
    const incrementBox = await incrementList.boundingBox();
    expect(incrementBox?.height ?? 0).toBeGreaterThan(300);
  });

  test('shows full jog controls at 1920×1080 without virtual sidebar', async ({ appPage }) => {
    await appPage.evaluate((storageKey) => {
      window.localStorage.setItem(storageKey, 'false');
    }, E2E_SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY);
    await appPage.reload();
    await appPage.setViewportSize({ width: 1920, height: 1080 });

    const screens = new Screens(appPage);
    await expect(screens.homeMarker()).toBeVisible({ timeout: 60_000 });
    await expect(appPage.locator('[data-e2e="home-jog-panel"]')).toHaveAttribute('data-jog-size', 'full');
  });

  test('shows compact jog controls at 1280×720', async ({ appPage }) => {
    await appPage.setViewportSize({ width: 1280, height: 720 });
    const screens = new Screens(appPage);

    await expect(screens.homeMarker()).toBeVisible({ timeout: 60_000 });
    await expect(appPage.getByRole('tablist', { name: JOG_INCREMENT_TABLIST })).toBeVisible();
    await expect(appPage.locator('[data-e2e="home-jog-controls"]')).toBeVisible();
    await expect(appPage.getByText('Active codes')).toBeVisible();

    await expect(appPage.locator('[data-e2e="home-jog-panel"]')).toHaveAttribute('data-jog-size', 'compact');

    const historyPanel = appPage.locator('[data-e2e="mdi-history"]');
    await expect(historyPanel).toBeVisible();
    const historyBox = await historyPanel.boundingBox();
    expect(historyBox?.height ?? 0).toBeGreaterThan(80);
  });
});
