import { expect, test } from '../fixtures/webTest';
import { Sidebar } from '../pages/Sidebar';

const WINDOW_MODE_KIOSK = 'Vollbild (Kiosk)';
const WINDOW_MODE_WINDOWED = 'Fenster mit Titelleiste';
const WINDOW_MODE_TRIGGER = 'Fenstermodus beim Start';
const SAVE_FAILED_TOAST = 'Fenstermodus konnte nicht gespeichert werden.';

async function openSettingsWindowMode(appPage: import('@playwright/test').Page) {
  const sidebar = new Sidebar(appPage);
  await sidebar.clickByTitle('Settings');
  await expect(appPage.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();

  const row = appPage.locator('[data-e2e="settings-row-window-mode"]');
  await expect(row).toBeVisible();
  return row;
}

test.describe('settings-window-mode', () => {
  test.use({ skipVirtualSidebarMachineOn: true });

  test('shows window mode picker on Settings screen', async ({ appPage }) => {
    const row = await openSettingsWindowMode(appPage);
    await expect(row.getByRole('button', { name: WINDOW_MODE_TRIGGER })).toBeVisible();
  });

  test('saves window mode via PUT /api/user-preferences', async ({ appPage }) => {
    let putBody: { kioskMode?: boolean } | null = null;

    await appPage.route('**/api/user-preferences', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          json: {
            kioskMode: true,
            runLinuxCncAtStartup: false,
            linuxCncIniPath: null,
            toolInSpindle: 0,
            reloadToolOnStartup: true,
          },
        });
        return;
      }
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON() as { kioskMode?: boolean };
        await route.fulfill({
          status: 200,
          json: {
            kioskMode: putBody?.kioskMode ?? true,
            runLinuxCncAtStartup: false,
            linuxCncIniPath: null,
            toolInSpindle: 0,
            reloadToolOnStartup: true,
          },
        });
        return;
      }
      await route.fallback();
    });

    await appPage.reload();
    await expect(new Sidebar(appPage).buttonByTitle('Home')).toBeVisible({ timeout: 60_000 });

    const row = await openSettingsWindowMode(appPage);
    await expect(row.getByRole('button', { name: WINDOW_MODE_TRIGGER })).toContainText(
      WINDOW_MODE_KIOSK,
    );
    await row.getByRole('button', { name: WINDOW_MODE_TRIGGER }).click();
    await appPage.getByRole('option', { name: WINDOW_MODE_WINDOWED }).click();

    await expect.poll(() => putBody).toEqual({ kioskMode: false });
    await expect(row.getByRole('button', { name: WINDOW_MODE_TRIGGER })).toContainText(
      WINDOW_MODE_WINDOWED,
    );
  });

  test('shows toast when saving window mode fails', async ({ appPage }) => {
    await appPage.route('**/api/user-preferences', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          json: {
            kioskMode: true,
            runLinuxCncAtStartup: false,
            linuxCncIniPath: null,
            toolInSpindle: 0,
            reloadToolOnStartup: true,
          },
        });
        return;
      }
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 503, json: { detail: 'disk full' } });
        return;
      }
      await route.fallback();
    });

    await appPage.reload();
    await expect(new Sidebar(appPage).buttonByTitle('Home')).toBeVisible({ timeout: 60_000 });

    const row = await openSettingsWindowMode(appPage);
    await expect(row.getByRole('button', { name: WINDOW_MODE_TRIGGER })).toContainText(
      WINDOW_MODE_KIOSK,
    );
    await row.getByRole('button', { name: WINDOW_MODE_TRIGGER }).click();
    await appPage.getByRole('option', { name: WINDOW_MODE_WINDOWED }).click();

    await expect(appPage.getByText(SAVE_FAILED_TOAST)).toBeVisible();
    await expect(row.getByRole('button', { name: WINDOW_MODE_TRIGGER })).toContainText(
      WINDOW_MODE_KIOSK,
    );
  });

  test('shows hint when user preferences cannot be loaded', async ({ appPage }) => {
    await appPage.route('**/api/user-preferences', async (route) => {
      await route.fulfill({ status: 503, json: { detail: 'unavailable' } });
    });

    await appPage.reload();
    await expect(new Sidebar(appPage).buttonByTitle('Home')).toBeVisible({ timeout: 60_000 });

    await openSettingsWindowMode(appPage);
    await expect(appPage.locator('[data-e2e="settings-user-preferences-load-failed"]')).toBeVisible();
  });
});
