import { expect, test } from '../fixtures/webTest';
import { Sidebar } from '../pages/Sidebar';

const HAL_METER_LABEL = 'HAL Meter';
const HAL_METER_UNAVAILABLE =
  'HAL Meter ist nicht installiert oder nicht im PATH.';

async function openSettingsHalTools(appPage: import('@playwright/test').Page) {
  const sidebar = new Sidebar(appPage);
  await sidebar.clickByTitle('Settings');
  await expect(appPage.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(appPage.locator('[data-e2e="settings-hal-tool-halmeter"]')).toBeVisible();
}

test.describe('settings-hal-tools', () => {
  test.use({ skipVirtualSidebarMachineOn: true });

  test('shows HAL tool buttons on Settings screen', async ({ appPage }) => {
    await openSettingsHalTools(appPage);
    await expect(appPage.locator('[data-e2e="settings-hal-tool-halshow"]')).toBeVisible();
  });

  test('launches HAL tool via POST /api/hal-tools/launch', async ({ appPage }) => {
    let postBody: { tool?: string } | null = null;

    await appPage.route('**/api/hal-tools/launch', async (route) => {
      if (route.request().method() === 'POST') {
        postBody = route.request().postDataJSON() as { tool?: string };
        await route.fulfill({ status: 200, json: { ok: true } });
        return;
      }
      await route.fallback();
    });

    await openSettingsHalTools(appPage);
    await appPage.locator('[data-e2e="settings-hal-tool-halmeter"]').click();

    await expect.poll(() => postBody).toEqual({ tool: 'halmeter' });
  });

  test('shows localized toast when HAL tool launch fails', async ({ appPage }) => {
    await appPage.route('**/api/hal-tools/launch', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 422,
          json: {
            detail: {
              code: 'halmeter_unavailable',
              message: 'halmeter is not installed or not in PATH.',
            },
          },
        });
        return;
      }
      await route.fallback();
    });

    await openSettingsHalTools(appPage);
    await appPage.getByRole('button', { name: HAL_METER_LABEL }).click();

    await expect(appPage.getByText(HAL_METER_UNAVAILABLE)).toBeVisible();
  });
});
