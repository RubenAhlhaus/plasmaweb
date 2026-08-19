import { expect, test } from '../fixtures/webTest';
import { attachOutgoingWebSocketTap } from '../helpers/outgoingWebSocketCommands';
import { Screens } from '../pages/Screens';

test.describe('Coordinate systems dialog keyboard', () => {
  test('ArrowDown and Enter send set_active_coordinate_system from table', async ({
    appPage,
  }) => {
    const tap = attachOutgoingWebSocketTap(appPage);
    try {
      await expect(new Screens(appPage).homeMarker()).toBeVisible({ timeout: 60_000 });

      await appPage.locator('[data-e2e="coord-x"]').click();
      const coordinateDialog = appPage
        .getByRole('dialog')
        .filter({ hasText: 'Koordinatensysteme & Offsets' });
      await expect(coordinateDialog).toBeVisible();

      // Focus a control inside the table without opening the offset sub-dialog:
      // the active row shows the button label "Aktiv" (not "Aktiv setzen").
      await coordinateDialog.getByRole('button', { name: 'Aktiv', exact: true }).click();

      const activateCmd = tap.waitForNextOutgoingCommand(
        (msg) =>
          msg.category === 'motion' &&
          msg.action === 'set_active_coordinate_system' &&
          typeof msg.params?.systemId === 'string',
        { timeoutMs: 20_000 },
      );

      await appPage.keyboard.press('ArrowDown');
      await appPage.keyboard.press('Enter');
      await activateCmd;
    } finally {
      tap.dispose();
    }
  });
});
