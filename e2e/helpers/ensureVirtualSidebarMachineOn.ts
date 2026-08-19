import { expect, type Page } from 'playwright/test';
import {
  headerEstopActiveLocator,
  headerMachineOffLocator,
  headerTaskModeOnLocator,
} from './headerBarStatusLocators';
import type { OutgoingWebSocketTap } from './outgoingWebSocketCommands';

/**
 * Ensures LinuxCNC is ON (virtual sidebar Machine softkey) for IO/spindle commands.
 * Prefers header status over outgoing WS frame capture: linuxcnc sim can linger at
 * `task_state` 0 / ESTOP_RESET and the UI may send ESTOP before the store mirrors.
 */
export async function ensureVirtualSidebarMachineOn(
  page: Page,
  _tap: OutgoingWebSocketTap,
): Promise<void> {
  const softkey = (n: number) => page.locator(`[data-e2e="virtual-sidebar-button-${n}"]`);
  const statusNotaus = () => headerEstopActiveLocator(page);
  const statusMaschineAus = () => headerMachineOffLocator(page);
  const statusMachineOn = () => headerTaskModeOnLocator(page);

  await expect(softkey(4)).toBeVisible();
  await expect(softkey(1)).toBeVisible();

  if (await statusMachineOn().isVisible().catch(() => false)) return;

  // Clear ESTOP if needed (reset softkey 4).
  if (await statusNotaus().isVisible().catch(() => false)) {
    await softkey(4).click();
    await expect
      .poll(async () => {
        const aus = await statusMaschineAus().isVisible().catch(() => false);
        const on = await statusMachineOn().isVisible().catch(() => false);
        return aus || on;
      }, { timeout: 15_000 })
      .toBe(true);
    if (await statusMachineOn().isVisible().catch(() => false)) return;
  }

  // Machine softkey: works for OFF / ESTOP_RESET / normalized 0 (see useMachineEventBridge).
  await softkey(1).click();
  const turnedOn = await statusMachineOn()
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (turnedOn) return;

  // Ambiguous linuxcnc start: force ESTOP → reset → ON (same path as sidebar-navigation).
  await softkey(4).click();
  await expect(statusNotaus()).toBeVisible({ timeout: 15_000 });
  await softkey(4).click();
  await expect(statusMaschineAus()).toBeVisible({ timeout: 15_000 });
  await softkey(1).click();
  await expect(statusMachineOn()).toBeVisible({ timeout: 15_000 });
}
