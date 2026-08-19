import { expect, test } from '../fixtures/webTest';
import { FEED_OVERRIDE_HOTKEYS_STORAGE_KEY } from '../../src/lib/overridePresetHotkeysStorage';
import { attachOutgoingWebSocketTap } from '../helpers/outgoingWebSocketCommands';
import { Sidebar } from '../pages/Sidebar';

test.describe('override-preset-hotkeys', () => {
  test('assigns a feed override hotkey in Settings, persists it, and sends feed_override', async ({
    appPage,
  }) => {
    const sidebar = new Sidebar(appPage);
    await sidebar.clickByTitle('Settings');
    await expect(appPage.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();

    const group = appPage.locator('[data-e2e="settings-feed-override-hotkeys"]');
    await expect(group).toBeVisible();
    await group.locator('summary').click();

    const captureButton = appPage.locator('[data-e2e="settings-feed-override-hotkey-8"]');
    await expect(captureButton).toBeVisible();
    await captureButton.click();
    await expect(captureButton).toHaveAttribute('aria-pressed', 'true');

    await appPage.keyboard.press('F8');
    await expect(captureButton).toHaveAttribute('aria-pressed', 'false');
    await expect(captureButton).toHaveText('F8');

    const stored = await appPage.evaluate(
      (storageKey) => JSON.parse(window.localStorage.getItem(storageKey) ?? '{}'),
      FEED_OVERRIDE_HOTKEYS_STORAGE_KEY,
    );
    expect(stored['8']).toEqual({ key: 'F8' });

    const tap = attachOutgoingWebSocketTap(appPage);
    try {
      const nextCommand = tap.waitForNextOutgoingCommand(
        (msg) =>
          msg.category === 'machine' &&
          msg.action === 'feed_override' &&
          msg.params?.factor === 0.8,
        { timeoutMs: 15_000 },
      );

      await appPage.keyboard.press('F8');
      await nextCommand;
    } finally {
      tap.dispose();
    }
  });

  test('feed position 0 is labeled for pause hybrid and clamps to ~1% when idle', async ({
    appPage,
  }) => {
    const sidebar = new Sidebar(appPage);
    await sidebar.clickByTitle('Settings');
    await expect(appPage.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();

    const group = appPage.locator('[data-e2e="settings-feed-override-hotkeys"]');
    await group.locator('summary').click();

    const row = appPage.locator('[data-e2e="settings-row-feed-override-hotkey-0"]');
    await expect(row).toContainText('~1 % / Pause');

    const captureButton = appPage.locator('[data-e2e="settings-feed-override-hotkey-0"]');
    await captureButton.click();
    await appPage.keyboard.press('F7');
    await expect(captureButton).toHaveText('F7');

    const tap = attachOutgoingWebSocketTap(appPage);
    try {
      const clampCmd = tap.waitForNextOutgoingCommand(
        (msg) =>
          msg.category === 'machine' &&
          msg.action === 'feed_override' &&
          msg.params?.factor === 0.01,
        { timeoutMs: 15_000 },
      );
      await appPage.keyboard.press('F7');
      await clampCmd;
    } finally {
      tap.dispose();
    }
  });
});
