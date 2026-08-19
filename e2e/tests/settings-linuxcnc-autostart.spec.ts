import { expect, test } from '../fixtures/webTest';
import { Sidebar } from '../pages/Sidebar';

const INI_UNAVAILABLE =
  'LinuxCNC-INI-Pfad ist nicht verfügbar. LinuxCNC einmal mit Ihrer Konfiguration starten, bevor Autostart aktiviert wird.';

async function openSettingsDisplay(appPage: import('@playwright/test').Page) {
  const sidebar = new Sidebar(appPage);
  await sidebar.clickByTitle('Settings');
  await expect(appPage.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(appPage.locator('[data-e2e="settings-row-linuxcnc-autostart"]')).toBeVisible();
}

test.describe('settings-linuxcnc-autostart', () => {
  test.use({ skipVirtualSidebarMachineOn: true });

  test('enables autostart via PUT /api/user-preferences/linuxcnc-autostart', async ({
    appPage,
  }) => {
    let putBody: { runLinuxCncAtStartup?: boolean } | null = null;

    await appPage.route('**/api/user-preferences/linuxcnc-autostart', async (route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON() as { runLinuxCncAtStartup?: boolean };
        await route.fulfill({
          status: 200,
          json: {
            kioskMode: null,
            runLinuxCncAtStartup: true,
            linuxCncIniPath: '/tmp/machine.ini',
            toolInSpindle: 0,
            reloadToolOnStartup: true,
          },
        });
        return;
      }
      await route.fallback();
    });

    await openSettingsDisplay(appPage);
    await appPage.locator('[data-e2e="settings-row-linuxcnc-autostart"] button').click();

    await expect.poll(() => putBody).toEqual({ runLinuxCncAtStartup: true });
    await expect(appPage.locator('[data-e2e="settings-linuxcnc-autostart-ini"]')).toContainText(
      '/tmp/machine.ini',
    );
  });

  test('shows localized toast when autostart save fails', async ({ appPage }) => {
    await appPage.route('**/api/user-preferences/linuxcnc-autostart', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 422,
          json: {
            detail: {
              code: 'ini_path_unavailable',
              message: 'LinuxCNC INI path is not available.',
            },
          },
        });
        return;
      }
      await route.fallback();
    });

    await openSettingsDisplay(appPage);
    await appPage.locator('[data-e2e="settings-row-linuxcnc-autostart"] button').click();

    await expect(appPage.getByText(INI_UNAVAILABLE)).toBeVisible();
  });
});
