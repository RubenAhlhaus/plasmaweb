import { TaskState } from '../../src/store/types';
import { expect, test } from '../fixtures/webTest';

import {
  headerEstopActiveLocator,
  headerMachineOffLocator,
  headerTaskModeOnLocator,
} from '../helpers/headerBarStatusLocators';
import {
  attachOutgoingWebSocketTap,
  matchMachineSetTaskState,
  matchMachineSetTaskStateWithStatus,
} from '../helpers/outgoingWebSocketCommands';
import { Sidebar } from '../pages/Sidebar';
import { Screens } from '../pages/Screens';

test.describe('sidebar-navigation', () => {
  const titles = ['Home', 'Macros', 'Program', 'Tools', 'Probing', 'Settings'] as const;

  test('navigates all pages, virtual sidebar estop/machine flow, and websocket commands', async ({
    appPage,
  }) => {
    const tap = attachOutgoingWebSocketTap(appPage);
    try {
      await appPage.reload({ waitUntil: 'domcontentloaded' });

      const sidebar = new Sidebar(appPage);
      const screens = new Screens(appPage);

      await expect(sidebar.buttonByTitle('Home')).toBeVisible({ timeout: 60_000 });

      for (const title of titles) {
        await sidebar.clickByTitle(title);
        await expect(screens.markerFor(title)).toBeVisible();
      }

      const virtualSidebarSwitch = appPage
        .locator('[data-e2e="settings-row-virtual-sidebar"]')
        .getByRole('switch');
      await expect(virtualSidebarSwitch).toHaveAttribute('aria-checked', 'true');

      const softkey = (n: number) =>
        appPage.locator(`[data-e2e="virtual-sidebar-button-${n}"]`);
      const statusNotaus = () => headerEstopActiveLocator(appPage);
      const statusMaschineAus = () => headerMachineOffLocator(appPage);
      const statusMachineOn = () => headerTaskModeOnLocator(appPage);

      await expect(softkey(4)).toBeVisible();
      await expect(softkey(1)).toBeVisible();
      // Backend may not start in ESTOP; estop click forces STATE_ESTOP if needed.
      const alreadyNotaus = await statusNotaus().isVisible();
      if (!alreadyNotaus) {
        const establishEstop = tap.waitForNextOutgoingCommand(
          matchMachineSetTaskStateWithStatus(TaskState.STATE_ESTOP),
        );
        await softkey(4).click();
        await establishEstop;
        await expect(statusNotaus()).toBeVisible();
      }
      await expect(softkey(4)).toHaveAttribute('data-active', 'true');

      // 1 — estop released → ESTOP_RESET
      let nextCmd = tap.waitForNextOutgoingCommand(
        matchMachineSetTaskStateWithStatus(TaskState.STATE_ESTOP_RESET),
      );
      await softkey(4).click();
      await nextCmd;
      await expect(statusMaschineAus()).toBeVisible();
      await expect(softkey(4)).toHaveAttribute('data-active', 'false');
      await expect(softkey(1)).toHaveAttribute('data-active', 'false');

      // 2 — estop pressed → ESTOP
      nextCmd = tap.waitForNextOutgoingCommand(matchMachineSetTaskStateWithStatus(TaskState.STATE_ESTOP));
      await softkey(4).click();
      await nextCmd;
      await expect(statusNotaus()).toBeVisible();
      await expect(softkey(4)).toHaveAttribute('data-active', 'true');
      await expect(softkey(1)).toHaveAttribute('data-active', 'false');

      // 3 — machine on while estop active: no set_task_state, status stays estop
      const commandCountBeforeMachineWhileEstop = tap.commandCount;
      await softkey(1).click();
      await tap.assertNoOutgoingCommandSince(commandCountBeforeMachineWhileEstop, matchMachineSetTaskState, {
        timeoutMs: 1_000,
      });
      await expect(statusNotaus()).toBeVisible();

      // 4 — estop released → ESTOP_RESET
      nextCmd = tap.waitForNextOutgoingCommand(
        matchMachineSetTaskStateWithStatus(TaskState.STATE_ESTOP_RESET),
      );
      await softkey(4).click();
      await nextCmd;
      await expect(statusMaschineAus()).toBeVisible();
      await expect(softkey(4)).toHaveAttribute('data-active', 'false');

      // 5 — machine on → ON
      nextCmd = tap.waitForNextOutgoingCommand(matchMachineSetTaskStateWithStatus(TaskState.STATE_ON));
      await softkey(1).click();
      await nextCmd;
      await expect(statusMachineOn()).toBeVisible();
      await expect(softkey(1)).toHaveAttribute('data-active', 'true');

      // 6 — machine off → OFF
      nextCmd = tap.waitForNextOutgoingCommand(matchMachineSetTaskStateWithStatus(TaskState.STATE_OFF));
      await softkey(1).click();
      await nextCmd;
      await expect(statusMaschineAus()).toBeVisible();
      await expect(softkey(1)).toHaveAttribute('data-active', 'false');

      // 7 — machine on → ON
      nextCmd = tap.waitForNextOutgoingCommand(matchMachineSetTaskStateWithStatus(TaskState.STATE_ON));
      await softkey(1).click();
      await nextCmd;
      await expect(statusMachineOn()).toBeVisible();
      await expect(softkey(1)).toHaveAttribute('data-active', 'true');
    } finally {
      tap.dispose();
    }
  });
});
