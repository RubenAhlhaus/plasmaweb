import { expect, test } from '../fixtures/webTest';
import {
  headerExitCloseWindowLocator,
  headerExitCloseWindowShutdownLocator,
  headerExitOpenLocator,
} from '../helpers/headerBarStatusLocators';
import { createOutgoingCommandSession } from '../helpers/outgoingWebSocketCommands';

test.describe('header-exit-dialog', () => {
  test.use({ skipVirtualSidebarMachineOn: true });

  test('power icon opens exit dialog with close and shutdown actions', async ({ appPage }) => {
    await headerExitOpenLocator(appPage).click();
    await expect(headerExitCloseWindowLocator(appPage)).toBeVisible();
    await expect(headerExitCloseWindowShutdownLocator(appPage)).toBeVisible();
  });

  test('shutdown button sends app.exit with shutdown true', async ({ appPage }) => {
    const session = await createOutgoingCommandSession(appPage);
    try {
      await headerExitOpenLocator(appPage).click();
      const captured = await session.waitForOutgoingCommand(
        {
          predicate: (msg) =>
            msg.category === 'app' &&
            msg.action === 'exit' &&
            msg.params?.shutdown === true,
        },
        async () => {
          await headerExitCloseWindowShutdownLocator(appPage).click();
        },
      );
      expect(captured.message.category).toBe('app');
      expect(captured.message.action).toBe('exit');
      expect(captured.message.params).toEqual({ shutdown: true });
    } finally {
      session.dispose();
    }
  });
});
