import { expect, test } from '../fixtures/webTest';
import { VIRTUAL_SIDEBAR_HOTKEYS_STORAGE_KEY } from '../../src/lib/virtualSidebarHotkeysStorage';
import { Sidebar } from '../pages/Sidebar';

test.describe('virtual-sidebar-hotkeys', () => {
  test.use({ skipVirtualSidebarMachineOn: true });

  test('assigns a hotkey in Settings, persists it, and triggers the action globally', async ({
    appPage,
  }) => {
    const sidebar = new Sidebar(appPage);
    await sidebar.clickByTitle('Settings');
    await expect(appPage.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();

    const captureButton = appPage.locator('[data-e2e="settings-hotkey-button-2"]');
    await captureButton.click();
    await expect(captureButton).toHaveAttribute('aria-pressed', 'true');

    await appPage.keyboard.press('F9');
    await expect(captureButton).toHaveAttribute('aria-pressed', 'false');
    await expect(captureButton).toHaveText('F9');

    const stored = await appPage.evaluate(
      (storageKey) => JSON.parse(window.localStorage.getItem(storageKey) ?? '{}'),
      VIRTUAL_SIDEBAR_HOTKEYS_STORAGE_KEY,
    );
    expect(stored['2']).toEqual({ key: 'F9' });

    // Hotkey works on Settings screen (focus on body, not in a text field).
    await appPage.keyboard.press('F9');
    await expect(appPage.getByRole('heading', { name: 'Home' })).toBeVisible();
    await expect(appPage.locator('[data-e2e="homing-home-all"]')).toBeVisible();

    await appPage.keyboard.press('Escape');
    await expect(appPage.locator('[data-e2e="homing-home-all"]')).toBeHidden();

    await sidebar.clickByTitle('Home');
    await appPage.keyboard.press('F9');
    await expect(appPage.locator('[data-e2e="homing-home-all"]')).toBeVisible();
  });
});
