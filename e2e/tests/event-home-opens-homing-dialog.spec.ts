import { expect, test } from '../fixtures/webTest';

import { Sidebar } from '../pages/Sidebar';

test.describe('event-home-opens-homing-dialog', () => {
  // Homing dialog is UI-only (eventBus); machine-on/ESTOP reset would only add time.
  test.use({ skipVirtualSidebarMachineOn: true });

  test('clicking virtual Home opens homing dialog', async ({ appPage }) => {
    const sidebar = new Sidebar(appPage);

    // 1) Open settings screen.
    await sidebar.clickByTitle('Settings');
    await expect(appPage.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();

    // 2) Enable virtual sidebar if it is currently disabled.
    const virtualSidebarSwitch = appPage
      .locator('[data-e2e="settings-row-virtual-sidebar"]')
      .getByRole('switch');

    const isEnabled = (await virtualSidebarSwitch.getAttribute('aria-checked')) === 'true';
    if (!isEnabled) {
      await virtualSidebarSwitch.click();
      await expect(virtualSidebarSwitch).toHaveAttribute('aria-checked', 'true');
    }

    // 3) Click the virtual "Home" button (left virtual sidebar, button #2).
    await appPage.locator('[data-e2e="virtual-sidebar-home"]').click();

    // 4) Assert homing dialog is visible => event was handled.
    await expect(appPage.getByRole('heading', { name: 'Home' })).toBeVisible();
    await expect(appPage.locator('[data-e2e="homing-home-all"]')).toBeVisible();
  });
});

