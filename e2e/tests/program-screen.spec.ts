import { expect, test } from '../fixtures/webTest';
import { attachOutgoingWebSocketTap, matchProgramRead } from '../helpers/outgoingWebSocketCommands';
import { Sidebar } from '../pages/Sidebar';
import { Screens } from '../pages/Screens';

test.describe('program-screen', () => {
  test('shows cycle start hint on program screen', async ({ appPage }) => {
    const sidebar = new Sidebar(appPage);
    await sidebar.clickByTitle('Program');
    await expect(new Screens(appPage).programMarker()).toBeVisible();

    const hint = appPage.locator('[data-e2e="program-cycle-start-hint"]');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Programmstart');
  });

  test('reload from disk sends program.read with logical editor path', async ({ appPage }) => {
    const tap = attachOutgoingWebSocketTap(appPage);
    try {
      const sidebar = new Sidebar(appPage);
      await sidebar.clickByTitle('Program');
      await expect(new Screens(appPage).programMarker()).toBeVisible();

      await appPage.getByRole('button', { name: 'Datei laden' }).click();
      const dialog = appPage.getByRole('dialog');
      await expect(
        dialog.getByRole('heading', { name: 'Programm vom Steuerrechner öffnen' }),
      ).toBeVisible({ timeout: 20_000 });

      const fileBtn = dialog.locator('ul li button').filter({
        has: appPage.locator('svg.text-muted-foreground'),
      }).first();

      const fileReady = await fileBtn
        .waitFor({ state: 'visible', timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      test.skip(!fileReady, 'No program file in browser list for this environment.');

      const loadRead = tap.waitForNextOutgoingCommand(matchProgramRead(), { timeoutMs: 25_000 });
      await fileBtn.click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      const loadedRead = await loadRead;
      const loadedPath = loadedRead.message.params?.path;
      expect(typeof loadedPath).toBe('string');
      expect((loadedPath as string).length).toBeGreaterThan(0);

      const reloadRead = tap.waitForNextOutgoingCommand(matchProgramRead(), { timeoutMs: 25_000 });
      await appPage.locator('[data-e2e="program-reload-from-disk"]').click();
      const reloaded = await reloadRead;
      expect(reloaded.message.params?.path).toBe(loadedPath);
    } finally {
      tap.dispose();
    }
  });
});
