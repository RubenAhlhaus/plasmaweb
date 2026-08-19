import { expect, test } from '../fixtures/webTest';
import { Sidebar } from '../pages/Sidebar';

async function openSettingsDisplay(appPage: import('@playwright/test').Page) {
  const sidebar = new Sidebar(appPage);
  await sidebar.clickByTitle('Settings');
  await expect(appPage.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(appPage.locator('[data-e2e="settings-row-reload-tool-on-startup"]')).toBeVisible();
}

test.describe('settings-reload-tool-on-startup', () => {
  test.use({ skipVirtualSidebarMachineOn: true });

  test('toggles reload-last-tool via PUT /api/user-preferences/reload-tool-on-startup', async ({
    appPage,
  }) => {
    let putBody: { reloadToolOnStartup?: boolean } | null = null;

    await appPage.route('**/api/user-preferences/reload-tool-on-startup', async (route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON() as { reloadToolOnStartup?: boolean };
        await route.fulfill({
          status: 200,
          json: {
            kioskMode: null,
            runLinuxCncAtStartup: false,
            linuxCncIniPath: null,
            toolInSpindle: 0,
            reloadToolOnStartup: putBody?.reloadToolOnStartup ?? false,
          },
        });
        return;
      }
      await route.fallback();
    });

    await openSettingsDisplay(appPage);
    await appPage.locator('[data-e2e="settings-row-reload-tool-on-startup"] button').click();

    await expect.poll(() => putBody).toEqual({ reloadToolOnStartup: false });
  });

  test('shows toast when reload-tool preference save fails', async ({ appPage }) => {
    await appPage.route('**/api/user-preferences/reload-tool-on-startup', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 503, json: { detail: 'disk full' } });
        return;
      }
      await route.fallback();
    });

    await openSettingsDisplay(appPage);
    await appPage.locator('[data-e2e="settings-row-reload-tool-on-startup"] button').click();

    await expect(
      appPage.getByText('Einstellung „Letztes Werkzeug laden“ konnte nicht gespeichert werden.'),
    ).toBeVisible();
  });
});
