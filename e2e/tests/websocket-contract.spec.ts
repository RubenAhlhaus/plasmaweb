import { expect, test } from '../fixtures/webTest';
import { ensureVirtualSidebarMachineOn } from '../helpers/ensureVirtualSidebarMachineOn';
import {
  payloadIoFlood,
  payloadIoSlimChanged,
  payloadSpindle0Forward,
  payloadSpindle0Reverse,
  payloadSpindle0Stopped,
  payloadSpindleChanged,
  snapshotIoSlim,
  snapshotSpindle,
} from '../helpers/linuxCncStatusPredicates';

/** Set `E2E_LINUXCNC_STATUS=1` when `linuxcnc_status` reliably mirrors `spindle`/`io.flood` (real machine / full gateway). */
const ASSERT_STATUS_MIRROR = process.env.E2E_LINUXCNC_STATUS === '1';
import {
  attachOutgoingWebSocketTap,
  matchMachineFlood,
  matchMachineSpindle,
} from '../helpers/outgoingWebSocketCommands';
import { Screens } from '../pages/Screens';
import { Sidebar } from '../pages/Sidebar';
import {
  captureLinuxCncStatusFrames,
  createIncomingLinuxCncStatusSession,
  validateLinuxCncStatusEnvelopeStrict,
} from '../helpers/websocketContract';

const STATUS_FRAME_TIMEOUT_MS = 15_000;
const MIN_PERIODIC_GAP_MS = 10;
/** Status after a command may be delayed; delta catches setups without direction/speed filled yet. */
const STATUS_PREDICATE_TIMEOUT_MS = 45_000;

test.describe('websocket-contract', () => {
  test('validates strict linuxcnc_status JSON contract', async ({ appPage }) => {
    // Listener first, then reload: new WebSocket handshake is observable (existing connection otherwise invisible).
    const frameCapturePromise = captureLinuxCncStatusFrames(appPage, 2, STATUS_FRAME_TIMEOUT_MS);
    await appPage.reload({ waitUntil: 'domcontentloaded' });

    const [first, second] = await frameCapturePromise;
    validateLinuxCncStatusEnvelopeStrict(first.message);
    validateLinuxCncStatusEnvelopeStrict(second.message);
    expect(
      second.receivedAt - first.receivedAt,
      `Expected periodic linuxcnc_status stream, but frame gap was ${
        second.receivedAt - first.receivedAt
      }ms`,
    ).toBeGreaterThanOrEqual(MIN_PERIODIC_GAP_MS);
  });

  test('virtual sidebar sends machine.spindle and machine.flood and status stream reflects IO/spindle', async ({
    appPage,
  }) => {
    const sidebar = new Sidebar(appPage);
    const screens = new Screens(appPage);
    const tap = attachOutgoingWebSocketTap(appPage);
    const incoming = ASSERT_STATUS_MIRROR ? await createIncomingLinuxCncStatusSession(appPage) : null;
    // `page.on('websocket')` only sees new connections — reload so tap/incoming can observe the stream.
    const wsOpened = appPage.waitForEvent('websocket', { timeout: 30_000 });
    await appPage.reload({ waitUntil: 'domcontentloaded' });
    await wsOpened;
    await expect(sidebar.buttonByTitle('Home')).toBeVisible({ timeout: 60_000 });

    try {
      await sidebar.clickByTitle('Home');
      await expect(screens.homeMarker()).toBeVisible();

      await sidebar.clickByTitle('Settings');
      await expect(appPage.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();

      const virtualSidebarSwitch = appPage
        .locator('[data-e2e="settings-row-virtual-sidebar"]')
        .getByRole('switch');
      const isEnabled = (await virtualSidebarSwitch.getAttribute('aria-checked')) === 'true';
      if (!isEnabled) {
        await virtualSidebarSwitch.click();
        await expect(virtualSidebarSwitch).toHaveAttribute('aria-checked', 'true');
      }

      await sidebar.clickByTitle('Home');
      await expect(screens.homeMarker()).toBeVisible();

      await ensureVirtualSidebarMachineOn(appPage, tap);

      const spindleLeft = appPage.locator('[data-e2e="virtual-sidebar-spindle-left"]');
      await expect(spindleLeft).toBeVisible();

      let beforeSpindle = '';
      if (incoming && ASSERT_STATUS_MIRROR) {
        const b = await incoming.waitForLinuxCncStatusPayload({
          predicate: () => true,
          timeoutMs: 10_000,
        });
        beforeSpindle = snapshotSpindle(b.message.payload as Record<string, unknown>);
      }
      let nextCmd = tap.waitForNextOutgoingCommand(matchMachineSpindle('reverse'));
      await spindleLeft.click();
      await nextCmd;
      if (incoming && ASSERT_STATUS_MIRROR) {
        await incoming.waitForLinuxCncStatusPayload({
          predicate: (p) =>
            payloadSpindle0Reverse(p) || payloadSpindleChanged(beforeSpindle)(p),
          timeoutMs: STATUS_PREDICATE_TIMEOUT_MS,
        });
      }

      if (incoming && ASSERT_STATUS_MIRROR) {
        const b = await incoming.waitForLinuxCncStatusPayload({
          predicate: () => true,
          timeoutMs: 10_000,
        });
        beforeSpindle = snapshotSpindle(b.message.payload as Record<string, unknown>);
      }
      nextCmd = tap.waitForNextOutgoingCommand(matchMachineSpindle('stop'));
      await appPage.locator('[data-e2e="virtual-sidebar-spindle-stop"]').click();
      await nextCmd;
      if (incoming && ASSERT_STATUS_MIRROR) {
        await incoming.waitForLinuxCncStatusPayload({
          predicate: (p) =>
            payloadSpindle0Stopped(p) || payloadSpindleChanged(beforeSpindle)(p),
          timeoutMs: STATUS_PREDICATE_TIMEOUT_MS,
        });
      }

      if (incoming && ASSERT_STATUS_MIRROR) {
        const b = await incoming.waitForLinuxCncStatusPayload({
          predicate: () => true,
          timeoutMs: 10_000,
        });
        beforeSpindle = snapshotSpindle(b.message.payload as Record<string, unknown>);
      }
      nextCmd = tap.waitForNextOutgoingCommand(matchMachineSpindle('forward'));
      await appPage.locator('[data-e2e="virtual-sidebar-spindle-right"]').click();
      await nextCmd;
      if (incoming && ASSERT_STATUS_MIRROR) {
        await incoming.waitForLinuxCncStatusPayload({
          predicate: (p) =>
            payloadSpindle0Forward(p) || payloadSpindleChanged(beforeSpindle)(p),
          timeoutMs: STATUS_PREDICATE_TIMEOUT_MS,
        });
      }

      if (incoming && ASSERT_STATUS_MIRROR) {
        const b = await incoming.waitForLinuxCncStatusPayload({
          predicate: () => true,
          timeoutMs: 10_000,
        });
        beforeSpindle = snapshotSpindle(b.message.payload as Record<string, unknown>);
      }
      nextCmd = tap.waitForNextOutgoingCommand(matchMachineSpindle('stop'));
      await appPage.locator('[data-e2e="virtual-sidebar-spindle-stop"]').click();
      await nextCmd;
      if (incoming && ASSERT_STATUS_MIRROR) {
        await incoming.waitForLinuxCncStatusPayload({
          predicate: (p) =>
            payloadSpindle0Stopped(p) || payloadSpindleChanged(beforeSpindle)(p),
          timeoutMs: STATUS_PREDICATE_TIMEOUT_MS,
        });
      }

      const coolant = appPage.locator('[data-e2e="virtual-sidebar-coolant"]');
      await expect(coolant).toBeVisible();

      let beforeIoSlim = '';
      if (incoming && ASSERT_STATUS_MIRROR) {
        const b = await incoming.waitForLinuxCncStatusPayload({
          predicate: () => true,
          timeoutMs: 10_000,
        });
        beforeIoSlim = snapshotIoSlim(b.message.payload as Record<string, unknown>);
      }
      nextCmd = tap.waitForNextOutgoingCommand(matchMachineFlood(true));
      await coolant.click();
      await nextCmd;
      await expect(coolant).toHaveAttribute('data-active', 'true', { timeout: 10_000 });
      if (incoming && ASSERT_STATUS_MIRROR) {
        await incoming.waitForLinuxCncStatusPayload({
          predicate: (p) =>
            payloadIoFlood(true)(p) || payloadIoSlimChanged(beforeIoSlim)(p),
          timeoutMs: STATUS_PREDICATE_TIMEOUT_MS,
        });
      }

      if (incoming && ASSERT_STATUS_MIRROR) {
        const b = await incoming.waitForLinuxCncStatusPayload({
          predicate: () => true,
          timeoutMs: 10_000,
        });
        beforeIoSlim = snapshotIoSlim(b.message.payload as Record<string, unknown>);
      }
      nextCmd = tap.waitForNextOutgoingCommand(matchMachineFlood(false));
      await coolant.click();
      await nextCmd;
      await expect(coolant).toHaveAttribute('data-active', 'false', { timeout: 10_000 });
      if (incoming && ASSERT_STATUS_MIRROR) {
        await incoming.waitForLinuxCncStatusPayload({
          predicate: (p) =>
            payloadIoFlood(false)(p) || payloadIoSlimChanged(beforeIoSlim)(p),
          timeoutMs: STATUS_PREDICATE_TIMEOUT_MS,
        });
      }
    } finally {
      incoming?.dispose();
      tap.dispose();
    }
  });
});
